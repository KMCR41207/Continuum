begin;
-- Conservative conflict candidates, never automatic truth arbitration.
create function public.memory_subject(p_content text) returns text language sql immutable set search_path='' as $$
 select substring(lower(trim(p_content)) from '^(this project uses|the frontend uses|the backend uses|our stack is|my goal is|i prefer|my preference is)')
$$;
create function public.memory_conflict_candidates(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.memories; result jsonb;
begin
 select * into m from public.memories where id=p_id;
 if not found or not public.is_member(m.workspace_id) then raise exception 'Memory access denied';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'content',x.content,'status',x.status,'updated_at',x.updated_at)),'[]') into result
 from public.memories x where x.workspace_id=m.workspace_id and x.project_id is not distinct from m.project_id
  and x.id<>m.id and x.category=m.category and x.status in ('active','pending')
  and public.memory_subject(x.content)=public.memory_subject(m.content) and lower(x.content)<>lower(m.content);
 return result;
end$$;
create table public.project_handoffs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,
 project_id uuid not null,conversation_id uuid not null,
 target_provider text not null check(length(target_provider) between 1 and 50),
 note text not null check(length(note) between 1 and 4000),created_at timestamptz not null default now(),
 foreign key(project_id,workspace_id) references public.projects(id,workspace_id) on delete cascade,
 foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id) on delete cascade
);
alter table public.project_handoffs enable row level security;
create policy handoffs_read on public.project_handoffs for select to authenticated using(public.is_member(workspace_id));
revoke all on public.project_handoffs from public,anon,authenticated;
grant select on public.project_handoffs to authenticated;
create trigger handoff_audit after insert or update or delete on public.project_handoffs for each row execute function public.audit_record();
create function public.create_handoff(p_project uuid,p_conversation uuid,p_target text,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; result uuid;
begin
 select workspace_id into w from public.projects where id=p_project;
 if w is null or not public.is_member(w,true) then raise exception 'Project access denied';end if;
 if not exists(select 1 from public.conversations where id=p_conversation and workspace_id=w and project_id=p_project and not excluded) then raise exception 'Conversation access denied';end if;
 insert into public.project_handoffs(workspace_id,project_id,conversation_id,target_provider,note) values(w,p_project,p_conversation,p_target,p_note) returning id into result;
 return result;
end$$;
-- Extend the central gateway without duplicating its permission logic or exporting its implementation.
alter function public.agent_request(text,text,jsonb) rename to agent_request_core;
revoke all on function public.agent_request_core(text,text,jsonb) from public,anon,authenticated;
create function public.agent_request(p_token text,p_operation text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; c public.agent_connections; p uuid; extra jsonb;
begin
 result:=public.agent_request_core(p_token,p_operation,p_args);
 if result ? 'error' or p_operation<>'get_project_context' then return result;end if;
 -- The core holds the connection lock until this transaction completes.
 select a.* into c from public.agent_connections a join public.connection_credentials t on t.connection_id=a.id where t.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 p:=(p_args->>'project_id')::uuid;
 select jsonb_build_object(
  'connected_agents',(select coalesce(jsonb_agg(jsonb_build_object('name',a.name,'provider',a.provider,'state',a.state)),'[]') from public.agent_connections a where a.workspace_id=c.workspace_id and p=any(a.project_ids) and a.state<>'revoked' and a.expires_at>now()),
  'handoffs',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'conversation_id',h.conversation_id,'target_provider',h.target_provider,'note',h.note,'created_at',h.created_at)),'[]') from public.project_handoffs h join public.conversations v on v.id=h.conversation_id where h.project_id=p and public.connection_conversation(c,v)),
  'source_memories',(select coalesce(jsonb_agg(x),'[]') from (
   select m.id,m.content,m.updated_at,(select coalesce(jsonb_agg(jsonb_build_object('conversation_id',s.conversation_id,'message_id',s.message_id,'evidence',s.evidence)),'[]') from public.memory_sources s where s.memory_id=m.id) sources
   from public.memories m where m.project_id=p and public.connection_memory(c,m) order by m.updated_at desc limit 50
  ) x)
 ) into extra;
 if jsonb_array_length(result)>0 then result:=jsonb_build_array((result->0)||extra);end if;
 return result;
end$$;
-- Include new user-owned records in exports, never credential hashes.
alter function public.export_workspace(uuid) rename to export_workspace_core;
revoke all on function public.export_workspace_core(uuid) from public,anon,authenticated;
create function public.export_workspace(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.export_workspace_core(p_workspace);
 return result||jsonb_build_object(
 'connections',(select coalesce(jsonb_agg(c),'[]') from public.agent_connections c where workspace_id=p_workspace),
 'connection_events',(select coalesce(jsonb_agg(e),'[]') from public.connection_events e where workspace_id=p_workspace),
 'handoffs',(select coalesce(jsonb_agg(h),'[]') from public.project_handoffs h where workspace_id=p_workspace));
end$$;
revoke all on function public.memory_conflict_candidates(uuid),public.create_handoff(uuid,uuid,text,text),public.agent_request(text,text,jsonb),public.export_workspace(uuid) from public,anon,authenticated;
grant execute on function public.memory_conflict_candidates(uuid),public.create_handoff(uuid,uuid,text,text),public.export_workspace(uuid) to authenticated;
grant execute on function public.agent_request(text,text,jsonb) to anon,authenticated;
commit;
