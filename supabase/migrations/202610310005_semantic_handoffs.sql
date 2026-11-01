begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create table public.semantic_embeddings(memory_id uuid primary key,workspace_id uuid not null,version integer not null,model text not null,embedding extensions.vector(384) not null,created_at timestamptz not null default now(),foreign key(memory_id,workspace_id) references public.memories(id,workspace_id) on delete cascade);
alter table public.semantic_embeddings enable row level security;
revoke all on public.semantic_embeddings from anon,authenticated;
create index semantic_embeddings_hnsw on public.semantic_embeddings using hnsw(embedding extensions.vector_cosine_ops);
create function public.queue_memory_embedding() returns trigger language plpgsql security definer set search_path='' as $$begin
 delete from public.semantic_embeddings where memory_id=new.id;
 if new.status='active' and new.sensitivity='normal' and exists(select 1 from public.workspaces where id=new.workspace_id and preferences->>'semantic_enabled'='true') then
  insert into public.sync_jobs(workspace_id,project_id,created_by,kind,payload,idempotency_key) values(new.workspace_id,new.project_id,auth.uid(),'embedding',jsonb_build_object('memory_id',new.id,'version',new.version),new.id::text||':'||new.version) on conflict do nothing;
 end if;return new;
end$$;
create trigger queue_embedding after insert or update on public.memories for each row execute function public.queue_memory_embedding();
create function public.configure_semantic(p_workspace uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_owner(p_workspace) then raise exception 'Workspace owner required';end if;
 update public.workspaces set preferences=preferences||jsonb_build_object('semantic_enabled',p_enabled) where id=p_workspace;
 if p_enabled then
  insert into public.sync_jobs(workspace_id,project_id,created_by,kind,payload,idempotency_key) select workspace_id,project_id,auth.uid(),'embedding',jsonb_build_object('memory_id',id,'version',version),id::text||':'||version from public.memories where workspace_id=p_workspace and status='active' and sensitivity='normal'
  on conflict(workspace_id,kind,idempotency_key) do update set status='queued',attempts=0,available_at=now(),lease_id=null,lease_until=null;
 else
  update public.sync_jobs set status='paused',lease_id=null,lease_until=null where workspace_id=p_workspace and kind='embedding' and status in ('queued','running');
  delete from public.semantic_embeddings where workspace_id=p_workspace;
 end if;
end$$;
create function public.embedding_job_input(p_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 select jsonb_build_object('id',m.id,'content',m.content,'version',m.version) into result from public.sync_jobs j join public.memories m on m.id=(j.payload->>'memory_id')::uuid join public.workspaces w on w.id=j.workspace_id
 where j.id=p_id and j.lease_id=p_lease and j.status='running' and j.lease_until>now() and j.kind='embedding' and m.workspace_id=j.workspace_id and m.version=(j.payload->>'version')::integer and m.status='active' and m.sensitivity='normal' and w.preferences->>'semantic_enabled'='true'
 and not exists(select 1 from public.memory_sources s join public.conversations c on c.id=s.conversation_id where s.memory_id=m.id and c.excluded);
 if result is null then raise exception 'Embedding job expired, excluded, changed or consent withdrawn';end if;return result;
end$$;
create function public.complete_embedding_job(p_id uuid,p_lease uuid,p_model text,p_vector text) returns void language plpgsql security definer set search_path='' as $$declare m jsonb;j public.sync_jobs;v extensions.vector(384);begin
 select * into j from public.sync_jobs where id=p_id for update;
 m:=public.embedding_job_input(p_id,p_lease);
 if length(p_model) not between 1 and 200 then raise exception 'Invalid model';end if;
 v:=p_vector::extensions.vector(384);
 if extensions.vector_norm(v)=0 then raise exception 'Invalid zero embedding';end if;
 insert into public.semantic_embeddings(memory_id,workspace_id,version,model,embedding) values((m->>'id')::uuid,j.workspace_id,(m->>'version')::integer,p_model,v) on conflict(memory_id) do update set version=excluded.version,model=excluded.model,embedding=excluded.embedding,created_at=now();
 perform public.finish_job(p_id,p_lease,null,jsonb_build_object('memory_id',m->>'id','model',p_model));
end$$;
create function public.semantic_search(p_token text,p_query text,p_vector text,p_model text,p_project uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare checked jsonb;c public.agent_connections;result jsonb;v extensions.vector(384);begin
 checked:=public.agent_request(p_token,'search_memory',jsonb_build_object('query',p_query,'project_id',p_project));
 if checked ? 'error' then return checked;end if;
 select a.* into c from public.agent_connections a join public.connection_credentials t on t.connection_id=a.id where t.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not exists(select 1 from public.workspaces where id=c.workspace_id and preferences->>'semantic_enabled'='true') then return checked;end if;
 v:=p_vector::extensions.vector(384);
 select coalesce(jsonb_agg(r order by r.score desc),'[]') into result from (
 select m.id,m.project_id,m.content,m.category,m.version,m.confidence,m.updated_at,
  (case when e.embedding is null then 0 else 0.65*(1-(e.embedding operator(extensions.<=>) v)) end)+0.25*ts_rank(m.search_document,plainto_tsquery('english'::regconfig,p_query))+0.05*m.confidence+0.05/(1+extract(epoch from (now()-m.updated_at))/86400/30) as score,
  (select coalesce(jsonb_agg(jsonb_build_object('conversation_id',s.conversation_id,'message_id',s.message_id,'evidence',s.evidence,'platform',sc.platform)),'[]') from public.memory_sources s join public.conversations sc on sc.id=s.conversation_id where s.memory_id=m.id) as sources
 from public.memories m left join public.semantic_embeddings e on e.memory_id=m.id and e.version=m.version and e.model=p_model
 where public.connection_memory(c,m) and (p_project is null or m.project_id=p_project)
 and (m.search_document @@ plainto_tsquery('english'::regconfig,p_query) or (e.embedding is not null and e.embedding operator(extensions.<=>) v<0.6))
 order by score desc,m.updated_at desc limit 50) r;
 return result;
end$$;

alter table public.project_handoffs add column destination_connection_id uuid references public.agent_connections(id) on delete cascade;
alter table public.project_handoffs add column shared_by uuid references auth.users(id) on delete set null;
alter table public.project_handoffs add column package jsonb;
create function public.prepare_handoff(p_project uuid,p_conversation uuid,p_destination uuid,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$declare c public.agent_connections;v public.conversations;r jsonb;begin
 select * into c from public.agent_connections where id=p_destination;
 select * into v from public.conversations where id=p_conversation;
 if not found or not public.is_member(v.workspace_id,true) or v.project_id is distinct from p_project then raise exception 'Source project access denied';end if;
 if c.id is null or c.state='revoked' or c.expires_at<=now() or not c.retrieval or not public.connection_conversation(c,v) then raise exception 'Destination lacks current project or source history access';end if;
 if coalesce(length(trim(p_note)),0) not between 1 and 4000 then raise exception 'Handoff note required';end if;
 select jsonb_build_object('project_id',p_project,'conversation_id',v.id,'title',v.title,'platform',v.platform,'destination_connection_id',c.id,'destination_name',c.name,'note',trim(p_note),
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role,'content',content) order by position),'[]') from public.messages where conversation_id=v.id),
 'memories',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'version',m.version,'content',m.content)),'[]') from public.memories m where public.connection_memory(c,m) and exists(select 1 from public.memory_sources s where s.memory_id=m.id and s.conversation_id=v.id))) into r;
 return r;
end$$;
create function public.confirm_handoff(p_project uuid,p_conversation uuid,p_destination uuid,p_note text,p_reviewed jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare r jsonb;i uuid;w uuid;begin
 -- Lock the destination while verifying the exact package the user reviewed.
 perform 1 from public.agent_connections where id=p_destination for update;
 r:=public.prepare_handoff(p_project,p_conversation,p_destination,p_note);
 if r is distinct from p_reviewed then raise exception 'Handoff context changed; preview and confirm again';end if;
 select workspace_id into w from public.projects where id=p_project;
 insert into public.project_handoffs(workspace_id,project_id,conversation_id,target_provider,note,destination_connection_id,shared_by,package) values(w,p_project,p_conversation,(select provider from public.agent_connections where id=p_destination),trim(p_note),p_destination,auth.uid(),r) returning id into i;return i;
end$$;
create function public.get_agent_handoffs(p_token text,p_project uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare checked jsonb;c public.agent_connections;r jsonb;begin
 checked:=public.agent_request(p_token,'search_conversations',jsonb_build_object('project_id',p_project));if checked ? 'error' then return checked;end if;
 select a.* into c from public.agent_connections a join public.connection_credentials t on t.connection_id=a.id where t.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'created_at',h.created_at,'conversation_id',v.id,'target_provider',h.target_provider,'note',h.note,'context',
  jsonb_build_object('project_id',h.project_id,'conversation_id',v.id,'title',v.title,'platform',v.platform,'note',h.note,
   'messages',(select jsonb_agg(jsonb_build_object('id',id,'role',role,'content',content) order by position) from public.messages where conversation_id=v.id),
   'memories',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'version',m.version,'content',m.content)),'[]') from public.memories m where public.connection_memory(c,m) and exists(select 1 from public.memory_sources s where s.memory_id=m.id and s.conversation_id=v.id))
  ))),'[]') into r from public.project_handoffs h join public.conversations v on v.id=h.conversation_id where h.destination_connection_id=c.id and public.connection_conversation(c,v) and (p_project is null or h.project_id=p_project);
 return r;
end$$;
-- Existing context summaries must not expose a destination-specific note to other agents.
alter function public.agent_request(text,text,jsonb) rename to agent_request_context;
revoke all on function public.agent_request_context(text,text,jsonb) from public,anon,authenticated;
create function public.agent_request(p_token text,p_operation text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 r:=public.agent_request_context(p_token,p_operation,p_args);
 if p_operation='get_project_context' and not(r ? 'error') and jsonb_array_length(r)>0 then
  r:=jsonb_build_array((r->0)||jsonb_build_object('handoffs',public.get_agent_handoffs(p_token,(p_args->>'project_id')::uuid)));
 end if;return r;
end$$;
revoke all on function public.configure_semantic(uuid,boolean),public.queue_memory_embedding(),public.embedding_job_input(uuid,uuid),public.complete_embedding_job(uuid,uuid,text,text),public.semantic_search(text,text,text,text,uuid),public.prepare_handoff(uuid,uuid,uuid,text),public.confirm_handoff(uuid,uuid,uuid,text,jsonb),public.get_agent_handoffs(text,uuid),public.agent_request(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.configure_semantic(uuid,boolean),public.prepare_handoff(uuid,uuid,uuid,text),public.confirm_handoff(uuid,uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.embedding_job_input(uuid,uuid),public.complete_embedding_job(uuid,uuid,text,text) to service_role;
grant execute on function public.semantic_search(text,text,text,text,uuid),public.get_agent_handoffs(text,uuid),public.agent_request(text,text,jsonb) to anon,authenticated;
commit;
