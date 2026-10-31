begin;

create table public.agent_connections (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 provider text not null check(provider in ('chatgpt','claude','gemini','grok','cursor','codex','antigravity','other')),
 name text not null check(length(name) between 1 and 100),
 method text not null default 'scoped-token' check(method='scoped-token'),
 capture boolean not null default false, retrieval boolean not null default false,
 writing boolean not null default false, global_access boolean not null default false,
 project_ids uuid[] not null default '{}', conversation_ids uuid[] not null default '{}',
 all_history boolean not null default false,
 capture_paused boolean not null default false,
 state text not null default 'pending' check(state in ('pending','verified','revoked')),
 expires_at timestamptz not null default now()+interval '90 days',
 created_at timestamptz not null default now(), verified_at timestamptz,
 last_activity_at timestamptz, last_sync_at timestamptz, last_error text,
 unique(id,workspace_id)
);
create table public.connection_credentials (
 connection_id uuid primary key references public.agent_connections(id) on delete cascade,
 token_hash text not null unique check(length(token_hash)=64)
);
create table public.connection_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
 connection_id uuid not null, operation text not null,
 success boolean not null, error_code text, created_at timestamptz not null default now(),
 foreign key(connection_id,workspace_id) references public.agent_connections(id,workspace_id) on delete cascade
);
create index connection_events_rate on public.connection_events(connection_id,created_at desc);
alter table public.agent_connections enable row level security;
alter table public.connection_credentials enable row level security;
alter table public.connection_events enable row level security;
create policy connection_read on public.agent_connections for select to authenticated using(public.is_member(workspace_id));
create policy connection_event_read on public.connection_events for select to authenticated using(public.is_member(workspace_id));
revoke all on public.agent_connections,public.connection_credentials,public.connection_events from public,anon,authenticated;
grant select on public.agent_connections,public.connection_events to authenticated;
create trigger connection_audit after insert or update or delete on public.agent_connections for each row execute function public.audit_record();

-- Scope changes and credential rotation are owner-only. No client can update token hashes directly.
create function public.configure_connection(p_workspace uuid,p_id uuid,p_provider text,p_name text,p_permissions jsonb,p_rotate boolean default false,p_revoke boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.agent_connections; token text; projects uuid[]; conversations uuid[]; k text;
begin
 if not exists(select 1 from public.workspaces where id=p_workspace and owner_id=auth.uid()) then raise exception 'Workspace owner required';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if jsonb_typeof(p_permissions) is distinct from 'object' then raise exception 'Invalid permissions';end if;
 for k in select jsonb_object_keys(p_permissions) loop
  if k not in ('capture','retrieval','writing','global_access','all_history','capture_paused','project_ids','conversation_ids') then raise exception 'Unknown permission';end if;
  if k not in ('project_ids','conversation_ids') and jsonb_typeof(p_permissions->k)<>'boolean' then raise exception 'Invalid permission value';end if;
 end loop;
 select coalesce(array_agg(value::uuid),'{}') into projects from jsonb_array_elements_text(coalesce(p_permissions->'project_ids','[]'));
 select coalesce(array_agg(value::uuid),'{}') into conversations from jsonb_array_elements_text(coalesce(p_permissions->'conversation_ids','[]'));
 if cardinality(projects)>100 or cardinality(conversations)>1000 then raise exception 'Scope limit exceeded';end if;
 if exists(select 1 from unnest(projects) x where not exists(select 1 from public.projects where id=x and workspace_id=p_workspace)) then raise exception 'Project access denied';end if;
 if exists(select 1 from unnest(conversations) x where not exists(select 1 from public.conversations where id=x and workspace_id=p_workspace)) then raise exception 'Conversation access denied';end if;
 if p_id is null then
  if (select count(*) from public.agent_connections where workspace_id=p_workspace)>=100 then raise exception 'Connection limit reached';end if;
  insert into public.agent_connections(workspace_id,provider,name) values(p_workspace,p_provider,trim(p_name)) returning * into c;
 else
  select * into c from public.agent_connections where id=p_id and workspace_id=p_workspace for update;
  if not found then raise exception 'Connection not found';end if;
 end if;
 update public.agent_connections set name=trim(p_name),
  capture=coalesce((p_permissions->>'capture')::boolean,false),
  retrieval=coalesce((p_permissions->>'retrieval')::boolean,false),
  writing=coalesce((p_permissions->>'writing')::boolean,false),
  global_access=coalesce((p_permissions->>'global_access')::boolean,false),
  all_history=coalesce((p_permissions->>'all_history')::boolean,false),
  capture_paused=coalesce((p_permissions->>'capture_paused')::boolean,false),
  project_ids=projects,conversation_ids=conversations where id=c.id;
 if p_revoke then
  delete from public.connection_credentials where connection_id=c.id;
  update public.agent_connections set state='revoked' where id=c.id;
 elsif p_id is null or p_rotate then
  -- Two independent random UUIDs provide >240 bits of entropy; only their SHA-256 digest is stored.
  token:='ctm_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into public.connection_credentials values(c.id,encode(sha256(convert_to(token,'UTF8')),'hex'))
   on conflict(connection_id) do update set token_hash=excluded.token_hash;
  update public.agent_connections set state='pending',verified_at=null,last_error=null,expires_at=now()+interval '90 days' where id=c.id;
 end if;
 return jsonb_build_object('id',c.id,'token',token);
end$$;

alter table public.conversations add column source_metadata jsonb not null default '{}';
alter table public.messages add column source_metadata jsonb not null default '{}';
alter table public.memories add column search_document tsvector generated always as (to_tsvector('english'::regconfig,content)) stored;
create index memories_search on public.memories using gin(search_document);
create index conversations_search on public.conversations using gin(to_tsvector('english'::regconfig,title));
-- Stable local feature embeddings; lexical, not a semantic/LLM embedding model.
create function public.lexical_embedding(p_text text) returns real[] language plpgsql immutable set search_path='' as $$
declare v real[]:=array_fill(0::real,array[64]); word text; i integer; norm real;
begin
 for word in select unnest(regexp_split_to_array(lower(p_text),'[^[:alnum:]]+')) loop
  if length(word)>2 then i:=get_byte(decode(md5(word),'hex'),0)%64+1;v[i]:=v[i]+1;end if;
 end loop;
 select sqrt(sum(x*x)) into norm from unnest(v) x;
 if norm>0 then for i in 1..64 loop v[i]:=v[i]/norm;end loop;end if;
 return v;
end$$;
alter table public.memories add column embedding real[] generated always as (public.lexical_embedding(content)) stored;

-- Preserve the website import contract, but compute identity on the server and partition by project.
alter table public.conversations drop constraint conversations_workspace_id_content_hash_key;
create unique index conversation_scope_dedup on public.conversations(workspace_id,coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),content_hash);
alter function public.import_conversation(uuid,uuid,jsonb,text,jsonb) rename to import_conversation_legacy;
revoke all on function public.import_conversation_legacy(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;

create function public.ingest_conversation(p_workspace uuid,p_project uuid,p_input jsonb,p_proposals jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid; m uuid; s uuid; item jsonb; proposal jsonb; i integer:=0; n integer:=0; h text; proposals jsonb:='[]'; sentence text; category text; sensitivity text;
begin
 perform 1 from public.workspaces where id=p_workspace for update;
 if p_project is not null and not exists(select 1 from public.projects where id=p_project and workspace_id=p_workspace) then raise exception 'Project access denied';end if;
 if jsonb_typeof(p_input)<>'object' or jsonb_typeof(p_input->'messages') is distinct from 'array' or length(p_input::text)>2000000 then raise exception 'Invalid import';end if;
 if jsonb_array_length(p_input->'messages') not between 1 and 500 then raise exception 'Invalid message count';end if;
 if coalesce(length(trim(p_input->>'title')),0) not between 1 and 200 or coalesce(length(trim(p_input->>'platform')),0) not between 1 and 50 then raise exception 'Invalid title or platform';end if;
 if jsonb_typeof(coalesce(p_input->'metadata','{}'))<>'object' then raise exception 'Invalid metadata';end if;
 -- Identity ignores title and import metadata, and includes all normalized messages and platform.
 select encode(sha256(convert_to(jsonb_build_object('platform',lower(trim(p_input->>'platform')),'messages',jsonb_agg(jsonb_build_object('role',value->>'role','content',trim(value->>'content')) order by ord))::text,'UTF8')),'hex') into h
 from jsonb_array_elements(p_input->'messages') with ordinality as x(value,ord);
 -- Existing migration-001 records used a browser hash including title. Compare their stored
 -- messages too, so upgrading an existing workspace does not re-import the same source.
 select v.id into c from public.conversations v where v.workspace_id=p_workspace and v.project_id is not distinct from p_project
 and (v.content_hash=h or (
  select encode(sha256(convert_to(jsonb_build_object('platform',lower(trim(v.platform)),'messages',jsonb_agg(jsonb_build_object('role',s.role,'content',trim(s.content)) order by s.position))::text,'UTF8')),'hex')
  from public.messages s where s.conversation_id=v.id
 )=h) order by v.created_at limit 1;
 if c is not null then return jsonb_build_object('id',c,'duplicate',true,'proposals',0);end if;
 if (select count(*) from public.conversations where workspace_id=p_workspace)>=1000 then raise exception 'Workspace import limit reached';end if;
 insert into public.conversations(workspace_id,project_id,title,platform,content_hash,message_count,source_metadata)
 values(p_workspace,p_project,trim(p_input->>'title'),trim(p_input->>'platform'),h,jsonb_array_length(p_input->'messages'),coalesce(p_input->'metadata','{}')) returning id into c;
 for item in select value from jsonb_array_elements(p_input->'messages') loop
  if jsonb_typeof(item->'content') is distinct from 'string' or jsonb_typeof(coalesce(item->'metadata','{}'))<>'object' then raise exception 'Invalid message';end if;
  insert into public.messages(workspace_id,conversation_id,position,role,content,source_metadata) values(p_workspace,c,i,item->>'role',trim(item->>'content'),coalesce(item->'metadata','{}'));
  if item->>'role'='user' then
   for sentence in select trim(x) from regexp_split_to_table(item->>'content',E'(?<=[.!?])\\s+|\\n+') x loop
    category:=null;
    if length(sentence) between 12 and 1000 and sentence !~* '(today|tomorrow|maybe|perhaps|ignore .*instructions|system prompt|bypass|pretend|\?$)' then
     if sentence ~* '(we decided|we chose|we selected|we are migrating)' then category:='Decisions';
     elsif sentence ~* '(i prefer|my preference)' then category:='Preferences';
     elsif sentence ~* '(this project uses|the frontend uses|the backend uses|our stack is)' then category:='Facts';
     elsif sentence ~* '(my goal is|i am building)' then category:='Goals';
     elsif sentence ~* '^(always|never|please use) ' then category:='Instructions';
     elsif sentence ~* '(i am proficient|my skills include)' then category:='Skills';
     elsif sentence ~* '(project is called|project is named)' then category:='Projects';
     elsif sentence ~* '(launched on|released on|meeting occurred)' then category:='Events';end if;
     if category is not null then
      sensitivity:=case when sentence ~* '(password|secret|api.?key|token|ssn|@)' then 'sensitive' else 'normal' end;
      proposals:=proposals||jsonb_build_array(jsonb_build_object('content',sentence,'category',category,'confidence',0.8,'sensitivity',sensitivity,'message_index',i,'reason','Conservative server rule; requires human approval.'));
     end if;
    end if;
   end loop;
  end if;i:=i+1;
 end loop;
 -- Existing browser proposals remain evidence-checked, but extraction no longer relies on a browser.
 if p_proposals is not null then proposals:=p_proposals;end if;
 if jsonb_typeof(proposals)<>'array' or jsonb_array_length(proposals)>100 then raise exception 'Too many memory proposals';end if;
 for proposal in select value from jsonb_array_elements(proposals) loop
  item:=p_input->'messages'->((proposal->>'message_index')::integer);
  if item->>'role' is distinct from 'user' or coalesce(length(proposal->>'content'),0) not between 12 and 1000 or position((proposal->>'content') in (item->>'content'))=0 then raise exception 'Proposal has no supporting user evidence';end if;
  m:=null;
  insert into public.memories(workspace_id,project_id,content,category,confidence,sensitivity,reason,status)
   values(p_workspace,p_project,proposal->>'content',proposal->>'category',(proposal->>'confidence')::numeric,proposal->>'sensitivity',left(proposal->>'reason',1000),'pending') on conflict do nothing returning id into m;
  if m is null then select id into m from public.memories where workspace_id=p_workspace and project_id is not distinct from p_project and md5(lower(regexp_replace(content,'\s+',' ','g')))=md5(lower(regexp_replace(proposal->>'content','\s+',' ','g')));else n:=n+1;end if;
  select id into s from public.messages where conversation_id=c and position=(proposal->>'message_index')::integer;
  if m is not null then insert into public.memory_sources(workspace_id,memory_id,conversation_id,message_id,evidence) values(p_workspace,m,c,s,proposal->>'content') on conflict do nothing;end if;
 end loop;
 update public.conversations set processing_status=case when n>0 then 'review' else 'complete' end where id=c;
 return jsonb_build_object('id',c,'duplicate',false,'proposals',n);
end$$;
create function public.import_conversation(p_workspace uuid,p_project uuid,p_input jsonb,p_hash text,p_proposals jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if not public.is_member(p_workspace,true) then raise exception 'Workspace access denied';end if;
 return public.ingest_conversation(p_workspace,p_project,p_input,p_proposals);
end$$;

create function public.connection_scope(c public.agent_connections,p uuid) returns boolean language sql immutable set search_path='' as $$select case when p is null then c.global_access else p=any(c.project_ids) end$$;
create function public.connection_conversation(c public.agent_connections,v public.conversations) returns boolean language sql immutable set search_path='' as $$select v.workspace_id=c.workspace_id and not v.excluded and public.connection_scope(c,v.project_id) and (c.all_history or v.id=any(c.conversation_ids))$$;
create function public.connection_memory(c public.agent_connections,m public.memories) returns boolean language sql stable security definer set search_path='' as $$
 select m.workspace_id=c.workspace_id and public.connection_scope(c,m.project_id) and m.status='active' and m.sensitivity='normal'
 and not exists(select 1 from public.memory_sources s join public.conversations v on v.id=s.conversation_id where s.memory_id=m.id and not public.connection_conversation(c,v))
$$;

-- The only anonymous entry point: raw token is hashed inside PostgreSQL. All helper functions are private.
create function public.agent_request(p_token text,p_operation text,p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.agent_connections; result jsonb; p uuid; mid uuid; target_memory public.memories; op text:=p_operation; q text; code text; offset_n integer; limit_n integer;
begin
 if length(p_token)<>68 then return jsonb_build_object('error','Invalid or expired credential','code','unauthorized');end if;
 select a.* into c from public.agent_connections a join public.connection_credentials t on t.connection_id=a.id
 where t.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update of a;
 if not found or c.state='revoked' or c.expires_at<=now() then return jsonb_build_object('error','Invalid or expired credential','code','unauthorized');end if;
 if (select count(*) from public.connection_events where connection_id=c.id and created_at>now()-interval '1 minute')>=120 then return jsonb_build_object('error','Rate limit reached; retry after 60 seconds','code','rate_limited');end if;
 -- Subtransaction rolls back failed mutations while retaining a redacted failure event outside it.
 begin
  if jsonb_typeof(p_args) is distinct from 'object' or length(p_args::text)>2000000 then raise exception 'Invalid request';end if;
  p:=nullif(p_args->>'project_id','')::uuid;
  if p is not null and (not public.connection_scope(c,p) or not exists(select 1 from public.projects where id=p and workspace_id=c.workspace_id)) then raise exception 'Project access denied';end if;
  if op in ('status','test_connection') then
   result:=jsonb_build_object('id',c.id,'provider',c.provider,'capture',c.capture,'retrieval',c.retrieval,'writing',c.writing,'project_ids',c.project_ids,'global_access',c.global_access,'capture_paused',c.capture_paused,'all_history',c.all_history,'conversation_ids',c.conversation_ids,'expires_at',c.expires_at);
  elsif op='disconnect' then
   delete from public.connection_credentials where connection_id=c.id;
   update public.agent_connections set state='revoked' where id=c.id;
   result:=jsonb_build_object('revoked',true);
  elsif op='capture_conversation' then
   if not c.capture or c.capture_paused then raise exception 'Conversation capture denied or paused';end if;
   if not public.connection_scope(c,p) then raise exception 'Project access denied';end if;
   if lower(p_args->'conversation'->>'platform') is distinct from c.provider and c.provider<>'other' then raise exception 'Source platform must match connection provider';end if;
   result:=public.ingest_conversation(c.workspace_id,p,p_args->'conversation');
   update public.agent_connections set last_sync_at=now() where id=c.id;
  elsif op in ('save_memory','save_project_note','update_memory') then
   if not c.writing then raise exception 'Memory writing denied';end if;
   if not public.connection_scope(c,p) then raise exception 'Project access denied';end if;
   if op='save_project_note' and p is null then raise exception 'Project required';end if;
   if op='update_memory' then
    -- Updating requires both read and write; prevents editing guessed IDs or restricted sources.
    select * into target_memory from public.memories where id=(p_args->>'id')::uuid for update;
    if not found or not c.retrieval or not public.connection_memory(c,target_memory) or target_memory.project_id is distinct from p then raise exception 'Memory access denied';end if;
    if (p_args->>'version')::integer is distinct from target_memory.version then raise exception 'Memory version conflict; refresh before retry';end if;
    update public.memories set content=p_args->>'content',status='pending',reason='Agent correction requires owner approval.' where id=target_memory.id returning id into mid;
   else
    insert into public.memories(workspace_id,project_id,content,category,confidence,status,reason)
     values(c.workspace_id,p,p_args->>'content',coalesce(p_args->>'category','Facts'),0.8,'pending','Agent submission requires owner approval.') on conflict do nothing returning id into mid;
    -- Never return an existing hidden memory ID to a write-only agent.
   end if;
   result:=jsonb_build_object('id',mid,'status','pending','duplicate',mid is null);
  else
   if not c.retrieval then raise exception 'Memory retrieval denied';end if;
   q:=coalesce(p_args->>'query','');
   if length(q)>1000 then raise exception 'Query too long';end if;
   offset_n:=coalesce((p_args->>'offset')::integer,0);limit_n:=coalesce((p_args->>'limit')::integer,50);
   if offset_n<0 or offset_n>100000 or limit_n<1 or limit_n>100 then raise exception 'Invalid pagination';end if;
   if op in ('search_memory','recall_memory','get_recent_context','export_memories') then
    select coalesce(jsonb_agg(r),'[]') into result from (
     select m.id,m.project_id,m.content,m.category,m.confidence,m.version,m.created_at,m.updated_at,
      (select coalesce(jsonb_agg(jsonb_build_object('conversation_id',v.id,'platform',v.platform,'title',v.title,'message_id',s.message_id,'evidence',s.evidence)),'[]') from public.memory_sources s join public.conversations v on v.id=s.conversation_id where s.memory_id=m.id) as sources
     from public.memories m where public.connection_memory(c,m) and (p is null or m.project_id=p)
      and (op<>'recall_memory' or m.id=(p_args->>'id')::uuid)
      and (q='' or m.search_document @@ plainto_tsquery('english'::regconfig,q))
     order by ts_rank(m.search_document,plainto_tsquery('english'::regconfig,q)) desc,m.updated_at desc,m.id
     limit limit_n offset offset_n
    ) r;
   elsif op in ('search_conversations','get_conversation') then
    select coalesce(jsonb_agg(r),'[]') into result from (
     select v.id,v.project_id,v.title,v.platform,v.created_at,v.source_metadata,
      case when op='get_conversation' then (select jsonb_agg(jsonb_build_object('id',s.id,'role',s.role,'content',s.content,'metadata',s.source_metadata) order by position) from public.messages s where s.conversation_id=v.id) else null end as messages
     from public.conversations v where public.connection_conversation(c,v) and (p is null or v.project_id=p)
      and (op<>'get_conversation' or v.id=(p_args->>'id')::uuid)
      and (q='' or to_tsvector('english'::regconfig,v.title) @@ plainto_tsquery('english'::regconfig,q))
     order by v.created_at desc,v.id limit limit_n offset offset_n
    ) r;
   elsif op in ('list_projects','get_project_context') then
    if op='get_project_context' and p is null then raise exception 'Project required';end if;
    select coalesce(jsonb_agg(r),'[]') into result from (
     select v.id,v.name,v.description,v.instructions,
      case when op='get_project_context' then (select coalesce(jsonb_agg(x),'[]') from (select m.id,m.content,m.category,m.updated_at from public.memories m where m.project_id=v.id and public.connection_memory(c,m) order by m.updated_at desc limit 50) x) else '[]'::jsonb end as memories,
      case when op='get_project_context' then (select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'platform',h.platform)),'[]') from public.conversations h where h.project_id=v.id and public.connection_conversation(c,h)) else '[]'::jsonb end as conversations
     from public.projects v where workspace_id=c.workspace_id and public.connection_scope(c,v.id) and (p is null or v.id=p)
     order by v.created_at desc,v.id limit limit_n offset offset_n
    ) r;
   else raise exception 'Unsupported operation';end if;
  end if;
 exception when others then
  -- Never return raw SQL details, input contents, token digests or internal identifiers in errors.
  code:=case when sqlerrm ~* '(denied|access)' then 'forbidden' when sqlerrm like '%version conflict%' then 'conflict' else 'invalid_request' end;
  result:=jsonb_build_object('error',case when code='forbidden' then 'Permission denied. Review capability, project and conversation access.' when code='conflict' then 'Memory changed. Refresh and retry.' else 'Invalid request. Check required fields, source platform, limits and supported operation.' end,'code',code);
 end;
 insert into public.connection_events(workspace_id,connection_id,operation,success,error_code) values(c.workspace_id,c.id,
 case when op in ('status','test_connection','disconnect','capture_conversation','save_memory','save_project_note','update_memory','search_memory','recall_memory','get_recent_context','export_memories','search_conversations','get_conversation','list_projects','get_project_context') then op else 'unsupported' end,
 not(result ? 'error'),code);
 if result ? 'error' then update public.agent_connections set last_error=result->>'error' where id=c.id;
 else update public.agent_connections set last_activity_at=now(),last_error=null,state=case when op='disconnect' then 'revoked' else 'verified' end,verified_at=coalesce(verified_at,now()) where id=c.id;end if;
 return result;
end$$;

revoke all on function public.configure_connection(uuid,uuid,text,text,jsonb,boolean,boolean),public.ingest_conversation(uuid,uuid,jsonb,jsonb),public.import_conversation(uuid,uuid,jsonb,text,jsonb),public.connection_scope(public.agent_connections,uuid),public.connection_conversation(public.agent_connections,public.conversations),public.connection_memory(public.agent_connections,public.memories),public.agent_request(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.configure_connection(uuid,uuid,text,text,jsonb,boolean,boolean),public.import_conversation(uuid,uuid,jsonb,text,jsonb) to authenticated;
grant usage on schema public to anon;
grant execute on function public.agent_request(text,text,jsonb) to anon,authenticated;
commit;
