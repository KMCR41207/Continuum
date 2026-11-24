-- APPLY-001-009.sql: All Continuum migrations bundled for the Supabase SQL editor
-- Generated 2026-11-22
-- Apply to a fresh project to get the full schema.

-- ============================================================
-- Migration: 202610310001_website.sql
-- ============================================================
-- Website foundation. Run through Supabase SQL editor or versioned CLI migrations.
begin;
create table public.workspaces(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,name text not null check(length(name) between 1 and 100),preferences jsonb not null default '{}',created_at timestamptz not null default now());
create table public.workspace_members(workspace_id uuid references public.workspaces(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,role text not null default 'owner' check(role in ('owner','editor','viewer')),primary key(workspace_id,user_id));
create table public.projects(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,name text not null check(length(name) between 1 and 100),description text not null default '' check(length(description)<=2000),instructions text not null default '' check(length(instructions)<=10000),status text not null default 'active' check(status in ('active','archived')),created_at timestamptz not null default now(),unique(id,workspace_id));
create table public.conversations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,project_id uuid,title text not null check(length(title) between 1 and 200),platform text not null check(length(platform) between 1 and 50),content_hash text not null,message_count integer not null,processing_status text not null default 'review' check(processing_status in ('review','complete','failed')),excluded boolean not null default false,created_at timestamptz not null default now(),unique(id,workspace_id),foreign key(project_id,workspace_id) references public.projects(id,workspace_id),unique(workspace_id,content_hash));
create table public.messages(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,conversation_id uuid not null,position integer not null,role text not null check(role in ('user','assistant')),content text not null check(length(content) between 1 and 20000),created_at timestamptz not null default now(),foreign key(conversation_id,workspace_id) references public.conversations(id,workspace_id) on delete cascade,unique(conversation_id,position),unique(id,conversation_id,workspace_id));
create table public.memories(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,project_id uuid,content text not null check(length(content) between 1 and 4000),category text not null check(category in ('Facts','Preferences','Decisions','Projects','Goals','Skills','Instructions','Events','Summaries')),confidence numeric not null check(confidence between 0 and 1),importance numeric not null default 0.5 check(importance between 0 and 1),sensitivity text not null default 'normal' check(sensitivity in ('normal','sensitive')),status text not null default 'pending' check(status in ('pending','active','archived','rejected')),reason text not null default '',version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,workspace_id),foreign key(project_id,workspace_id) references public.projects(id,workspace_id));
create unique index memory_content_dedup on public.memories(workspace_id,coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),md5(lower(regexp_replace(content,'\s+',' ','g'))));
create table public.memory_sources(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,memory_id uuid not null,conversation_id uuid not null,message_id uuid not null,evidence text not null,foreign key(memory_id,workspace_id) references public.memories(id,workspace_id) on delete cascade,foreign key(message_id,conversation_id,workspace_id) references public.messages(id,conversation_id,workspace_id) on delete cascade,unique(memory_id,message_id));
create table public.memory_versions(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,memory_id uuid not null,content text not null,category text not null,status text not null,version integer not null,created_at timestamptz not null default now(),foreign key(memory_id,workspace_id) references public.memories(id,workspace_id) on delete cascade,unique(memory_id,version));
create table public.audit_logs(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,actor_id uuid references auth.users(id) on delete set null,event text not null,entity_type text not null,entity_id uuid,created_at timestamptz not null default now());
create index memories_scope on public.memories(workspace_id,status,project_id,created_at desc);
create index conversations_scope on public.conversations(workspace_id,created_at desc);
create index audit_scope on public.audit_logs(workspace_id,created_at desc);
create index sources_conversation on public.memory_sources(conversation_id);
create index members_user on public.workspace_members(user_id,workspace_id);

create function public.is_member(w uuid,write_access boolean default false) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.workspace_members where workspace_id=w and user_id=auth.uid() and (not write_access or role in ('owner','editor')))$$;
revoke all on function public.is_member(uuid,boolean) from public;
grant execute on function public.is_member(uuid,boolean) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
create policy workspace_select on public.workspaces for select to authenticated using(public.is_member(id));
create policy workspace_update on public.workspaces for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy member_select on public.workspace_members for select to authenticated using(public.is_member(workspace_id));
do $$declare t text; begin foreach t in array array['projects','conversations','messages','memories','memory_sources','memory_versions','audit_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy tenant_select on public.%I for select to authenticated using(public.is_member(workspace_id))',t);
 end loop;
 foreach t in array array['projects','memories'] loop
 execute format('create policy tenant_insert on public.%I for insert to authenticated with check(public.is_member(workspace_id,true))',t);
 execute format('create policy tenant_update on public.%I for update to authenticated using(public.is_member(workspace_id,true)) with check(public.is_member(workspace_id,true))',t);
 execute format('create policy tenant_delete on public.%I for delete to authenticated using(public.is_member(workspace_id,true))',t);
 end loop; end $$;
create policy conversation_delete on public.conversations for delete to authenticated using(public.is_member(workspace_id,true));
create policy conversation_update on public.conversations for update to authenticated using(public.is_member(workspace_id,true)) with check(public.is_member(workspace_id,true));
revoke all on public.workspaces,public.workspace_members,public.projects,public.conversations,public.messages,public.memories,public.memory_sources,public.memory_versions,public.audit_logs from anon,authenticated;
grant usage on schema public to authenticated;
grant select on public.workspaces,public.workspace_members,public.projects,public.conversations,public.messages,public.memories,public.memory_sources,public.memory_versions,public.audit_logs to authenticated;
grant update(name,preferences) on public.workspaces to authenticated;
grant insert(workspace_id,name,description,instructions,status),update(name,description,instructions,status),delete on public.projects to authenticated;
grant update(excluded),delete on public.conversations to authenticated;
grant update(content,category,importance,sensitivity,status),delete on public.memories to authenticated;

create function public.create_workspace(p_name text) returns uuid language plpgsql security definer set search_path='' as $$declare w uuid;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if length(trim(p_name)) not between 1 and 100 then raise exception 'Invalid workspace name';end if;
 if (select count(*) from public.workspaces where owner_id=auth.uid())>=5 then raise exception 'Workspace limit reached';end if;
 insert into public.workspaces(owner_id,name) values(auth.uid(),trim(p_name)) returning id into w;
 insert into public.workspace_members values(w,auth.uid(),'owner');
 insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id) values(w,auth.uid(),'Workspace created','workspace',w);
 return w;end$$;

create function public.version_memory() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.memory_versions(workspace_id,memory_id,content,category,status,version) values(old.workspace_id,old.id,old.content,old.category,old.status,old.version);
 new.version:=old.version+1;new.updated_at:=now();return new;end$$;
create trigger preserve_memory_version before update on public.memories for each row execute function public.version_memory();
create function public.audit_record() returns trigger language plpgsql security definer set search_path='' as $$declare r record;begin
 if tg_op='DELETE' then r:=old;else r:=new;end if;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id) values(r.workspace_id,auth.uid(),tg_op,tg_table_name,r.id);
 if tg_op='DELETE' then return old;else return new;end if;end$$;
create trigger memory_audit after insert or update or delete on public.memories for each row execute function public.audit_record();
create trigger project_audit after insert or update or delete on public.projects for each row execute function public.audit_record();
create trigger conversation_audit after insert or update or delete on public.conversations for each row execute function public.audit_record();
create function public.delete_derived_memories() returns trigger language plpgsql security definer set search_path='' as $$begin
 delete from public.memories where id in(select memory_id from public.memory_sources where conversation_id=old.id);
 return old;end$$;
create trigger delete_source_memories before delete on public.conversations for each row execute function public.delete_derived_memories();

create function public.import_conversation(p_workspace uuid,p_project uuid,p_input jsonb,p_hash text,p_proposals jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid;m uuid;s uuid;item jsonb;proposal jsonb;i integer:=0;n integer:=0;msg jsonb;
begin
 if not public.is_member(p_workspace,true) then raise exception 'Workspace access denied';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if p_project is not null and not exists(select 1 from public.projects where id=p_project and workspace_id=p_workspace) then raise exception 'Project access denied';end if;
 if jsonb_typeof(p_input->'messages') is distinct from 'array' or jsonb_typeof(p_proposals) is distinct from 'array' then raise exception 'Invalid import';end if;
 if jsonb_array_length(p_input->'messages') not between 1 and 500 or jsonb_array_length(p_proposals)>100 or length(p_hash)<>64 then raise exception 'Import exceeds limits';end if;
 select id into c from public.conversations where workspace_id=p_workspace and content_hash=p_hash;
 if c is not null then return jsonb_build_object('id',c,'duplicate',true,'proposals',0);end if;
 if (select count(*) from public.conversations where workspace_id=p_workspace)>=1000 then raise exception 'Development workspace import limit reached';end if;
 insert into public.conversations(workspace_id,project_id,title,platform,content_hash,message_count) values(p_workspace,p_project,p_input->>'title',p_input->>'platform',p_hash,jsonb_array_length(p_input->'messages')) returning id into c;
 for item in select value from jsonb_array_elements(p_input->'messages') loop
 insert into public.messages(workspace_id,conversation_id,position,role,content) values(p_workspace,c,i,item->>'role',item->>'content');i:=i+1;end loop;
 for proposal in select value from jsonb_array_elements(p_proposals) loop
 msg:=p_input->'messages'->((proposal->>'message_index')::integer);
 if msg->>'role' is distinct from 'user' or length(proposal->>'content') not between 12 and 1000 or position((proposal->>'content') in (msg->>'content'))=0 then raise exception 'Proposal has no supporting user evidence';end if;
 m:=null;
 insert into public.memories(workspace_id,project_id,content,category,confidence,sensitivity,reason,status) values(p_workspace,p_project,proposal->>'content',proposal->>'category',(proposal->>'confidence')::numeric,proposal->>'sensitivity',left(proposal->>'reason',1000),'pending') on conflict do nothing returning id into m;
 if m is null then select id into m from public.memories where workspace_id=p_workspace and project_id is not distinct from p_project and md5(lower(regexp_replace(content,'\s+',' ','g')))=md5(lower(regexp_replace(proposal->>'content','\s+',' ','g')));else n:=n+1;end if;
 select id into s from public.messages where conversation_id=c and position=(proposal->>'message_index')::integer;
 if m is not null then insert into public.memory_sources(workspace_id,memory_id,conversation_id,message_id,evidence) values(p_workspace,m,c,s,proposal->>'content') on conflict do nothing;end if;
 end loop;
 update public.conversations set processing_status=case when n>0 then 'review' else 'complete' end where id=c;
 return jsonb_build_object('id',c,'duplicate',false,'proposals',n);end$$;

create function public.export_workspace(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not public.is_member(p_workspace) then raise exception 'Workspace access denied';end if;
 select jsonb_build_object('exported_at',now(),'workspace',(select to_jsonb(w) from public.workspaces w where id=p_workspace),'projects',(select coalesce(jsonb_agg(p),'[]') from public.projects p where workspace_id=p_workspace),'conversations',(select coalesce(jsonb_agg(c),'[]') from public.conversations c where workspace_id=p_workspace),'messages',(select coalesce(jsonb_agg(m),'[]') from public.messages m where workspace_id=p_workspace),'memories',(select coalesce(jsonb_agg(m),'[]') from public.memories m where workspace_id=p_workspace),'sources',(select coalesce(jsonb_agg(s),'[]') from public.memory_sources s where workspace_id=p_workspace),'versions',(select coalesce(jsonb_agg(v),'[]') from public.memory_versions v where workspace_id=p_workspace),'activity',(select coalesce(jsonb_agg(a),'[]') from public.audit_logs a where workspace_id=p_workspace)) into result;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id) values(p_workspace,auth.uid(),'Workspace exported','workspace',p_workspace);return result;end$$;
revoke all on function public.create_workspace(text),public.import_conversation(uuid,uuid,jsonb,text,jsonb),public.export_workspace(uuid),public.version_memory(),public.audit_record(),public.delete_derived_memories() from public;
grant execute on function public.create_workspace(text),public.import_conversation(uuid,uuid,jsonb,text,jsonb),public.export_workspace(uuid) to authenticated;
commit;


-- ============================================================
-- Migration: 202610310002_connections.sql
-- ============================================================
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


-- ============================================================
-- Migration: 202610310003_context_review.sql
-- ============================================================
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


-- ============================================================
-- Migration: 202610310004_product.sql
-- ============================================================
begin;
create function public.is_owner(w uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.workspaces where id=w and owner_id=auth.uid())$$;
revoke all on function public.is_owner(uuid) from public;grant execute on function public.is_owner(uuid) to authenticated;

create table public.onboarding_progress(user_id uuid references auth.users(id) on delete cascade,workspace_id uuid references public.workspaces(id) on delete cascade,step integer not null default 0 check(step between 0 and 7),completed boolean not null default false,updated_at timestamptz not null default now(),primary key(user_id,workspace_id));
alter table public.onboarding_progress enable row level security;
create policy onboarding_own on public.onboarding_progress for all to authenticated using(user_id=auth.uid() and public.is_member(workspace_id)) with check(user_id=auth.uid() and public.is_member(workspace_id));
grant select,insert,update on public.onboarding_progress to authenticated;

create table public.workspace_invitations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,email text not null check(length(email) between 3 and 254),role text not null check(role in ('editor','viewer')),token_hash text not null unique,expires_at timestamptz not null default now()+interval '7 days',accepted_at timestamptz,revoked_at timestamptz,created_at timestamptz not null default now());
alter table public.workspace_invitations enable row level security;
create policy invites_owner on public.workspace_invitations for select to authenticated using(public.is_owner(workspace_id));
revoke all on public.workspace_invitations from anon,authenticated;
grant select(id,workspace_id,email,role,expires_at,accepted_at,revoked_at,created_at) on public.workspace_invitations to authenticated;
create function public.invite_member(p_workspace uuid,p_email text,p_role text) returns jsonb language plpgsql security definer set search_path='' as $$declare token text; i uuid;begin
 perform 1 from public.workspaces where id=p_workspace for update;
 if not public.is_owner(p_workspace) then raise exception 'Workspace owner required';end if;
 if trim(p_email)!~'^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Valid email required';end if;
 if (select count(*) from public.workspace_invitations where workspace_id=p_workspace and created_at>now()-interval '1 day')>=100 then raise exception 'Invitation rate limit reached';end if;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.workspace_invitations(workspace_id,email,role,token_hash) values(p_workspace,lower(trim(p_email)),p_role,encode(sha256(convert_to(token,'UTF8')),'hex')) returning id into i;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id) values(p_workspace,auth.uid(),'Invitation created; delivery not sent','invitation',i);
 return jsonb_build_object('id',i,'token',token,'delivery','manual_link');end$$;
create function public.accept_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$declare i public.workspace_invitations; email text;begin
 select u.email into email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
 if email is null then raise exception 'Verified email required';end if;
 select * into i from public.workspace_invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or i.revoked_at is not null or i.accepted_at is not null or i.expires_at<=now() or lower(email)<>i.email then raise exception 'Invitation invalid, expired, or for another verified email';end if;
 insert into public.workspace_members(workspace_id,user_id,role) values(i.workspace_id,auth.uid(),i.role) on conflict do nothing;
 update public.workspace_invitations set accepted_at=now() where id=i.id;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id) values(i.workspace_id,auth.uid(),'Invitation accepted','invitation',i.id);
 return i.workspace_id;end$$;
create function public.manage_member(p_workspace uuid,p_action text,p_id uuid,p_role text default null) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.workspaces where id=p_workspace for update;
 if not public.is_owner(p_workspace) then raise exception 'Workspace owner required';end if;
 if p_action='revoke_invite' then update public.workspace_invitations set revoked_at=now() where id=p_id and workspace_id=p_workspace and accepted_at is null;
 else
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_id) then raise exception 'Member not found';end if;
  if p_id=auth.uid() then raise exception 'Cannot remove or demote the current owner';end if;
  if p_action='remove' then delete from public.workspace_members where workspace_id=p_workspace and user_id=p_id;
  elsif p_action='role' and p_role in ('editor','viewer') then update public.workspace_members set role=p_role where workspace_id=p_workspace and user_id=p_id;
  elsif p_action='transfer' then
   update public.workspace_members set role='editor' where workspace_id=p_workspace and user_id=auth.uid();
   update public.workspace_members set role='owner' where workspace_id=p_workspace and user_id=p_id;
   update public.workspaces set owner_id=p_id where id=p_workspace;
   -- Tokens were issued under the former owner's consent; the new owner must reissue them.
   delete from public.connection_credentials where connection_id in(select id from public.agent_connections where workspace_id=p_workspace);
   update public.agent_connections set state='revoked' where workspace_id=p_workspace;
  else raise exception 'Invalid member action';end if;
 end if;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id) values(p_workspace,auth.uid(),'Member action: '||p_action,'membership',p_id);
end$$;
create function public.list_members(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 if not public.is_member(p_workspace) then raise exception 'Workspace access denied';end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'email',u.email)),'[]') into r from public.workspace_members m join auth.users u on u.id=m.user_id where workspace_id=p_workspace;return r;end$$;

-- Commercial terms are deliberately unset. These are configurable operational ceilings, not advertised paid entitlements.
create table public.plan_catalog(id text primary key check(id in ('free','pro','max','teams')),name text not null,limits jsonb not null default '{}',stripe_price_id text unique,enabled boolean not null default false);
insert into public.plan_catalog values('free','Free','{"memories":100000,"conversations":1000,"connections":100,"projects":1000}',null,true),('pro','Pro','{}',null,false),('max','Max','{}',null,false),('teams','Teams','{}',null,false);
create table public.workspace_billing(workspace_id uuid primary key references public.workspaces(id) on delete cascade,plan_id text not null default 'free' references public.plan_catalog(id),customer_id text unique,subscription_id text unique,status text not null default 'unconfigured',cancel_at_period_end boolean not null default false,current_period_end timestamptz,last_event_at bigint not null default 0,updated_at timestamptz not null default now());
create table public.billing_events(event_id text primary key,workspace_id uuid references public.workspaces(id) on delete cascade,event_type text not null,created_at timestamptz not null default now());
alter table public.plan_catalog enable row level security;alter table public.workspace_billing enable row level security;alter table public.billing_events enable row level security;
create policy plans_read on public.plan_catalog for select to authenticated using(true);
create policy billing_read on public.workspace_billing for select to authenticated using(public.is_member(workspace_id));
grant select on public.plan_catalog,public.workspace_billing to authenticated;

create table public.sync_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,project_id uuid,created_by uuid references auth.users(id) on delete set null,kind text not null check(kind in ('import','embedding')),payload jsonb not null,idempotency_key text not null,status text not null default 'queued' check(status in ('queued','running','paused','succeeded','failed')),attempts integer not null default 0,max_attempts integer not null default 5,available_at timestamptz not null default now(),lease_id uuid,lease_until timestamptz,last_error text,result jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(project_id,workspace_id) references public.projects(id,workspace_id) on delete cascade,unique(workspace_id,kind,idempotency_key));
alter table public.sync_jobs enable row level security;
create policy jobs_read on public.sync_jobs for select to authenticated using(public.is_member(workspace_id));
grant select(id,workspace_id,project_id,kind,status,attempts,max_attempts,available_at,last_error,result,created_at,updated_at) on public.sync_jobs to authenticated;
create index jobs_ready on public.sync_jobs(status,available_at);
create function public.enqueue_import(p_workspace uuid,p_project uuid,p_input jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare i uuid;h text;begin
 if not public.is_member(p_workspace,true) then raise exception 'Workspace editor required';end if;
 if length(p_input::text)>2000000 or jsonb_typeof(p_input->'messages') is distinct from 'array' then raise exception 'Invalid import';end if;
 if p_project is not null and not exists(select 1 from public.projects where id=p_project and workspace_id=p_workspace) then raise exception 'Project access denied';end if;
 h:=encode(sha256(convert_to(coalesce(p_project::text,'global')||p_input::text,'UTF8')),'hex');
 insert into public.sync_jobs(workspace_id,project_id,created_by,kind,payload,idempotency_key) values(p_workspace,p_project,auth.uid(),'import',p_input,h) on conflict(workspace_id,kind,idempotency_key) do update set id=public.sync_jobs.id returning id into i;return i;
end$$;
create function public.control_job(p_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$declare j public.sync_jobs;begin
 select * into j from public.sync_jobs where id=p_id for update;
 if not found or not public.is_member(j.workspace_id,true) then raise exception 'Job access denied';end if;
 if p_action='pause' and j.status in ('queued','running') then update public.sync_jobs set status='paused',lease_id=null,lease_until=null,updated_at=now() where id=p_id;
 elsif p_action in ('resume','retry') and j.status in ('paused','failed') then update public.sync_jobs set status='queued',available_at=now(),attempts=0,last_error=null,updated_at=now() where id=p_id;
 else raise exception 'Invalid job transition';end if;
end$$;
create function public.claim_jobs(p_limit integer default 5) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 update public.sync_jobs set status='failed',last_error='Worker lease expired after maximum attempts',lease_id=null,lease_until=null where status='running' and lease_until<now() and attempts>=max_attempts;
 with picked as(select id from public.sync_jobs where ((status='queued' and available_at<=now()) or (status='running' and lease_until<now())) and attempts<max_attempts order by available_at for update skip locked limit least(greatest(p_limit,1),20)), claimed as(update public.sync_jobs j set status='running',attempts=j.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() from picked p where j.id=p.id returning j.id,j.lease_id,j.kind,j.payload,j.workspace_id,j.project_id)
 select coalesce(jsonb_agg(claimed),'[]') into result from claimed;return result;
end$$;
create function public.finish_job(p_id uuid,p_lease uuid,p_error text default null,p_result jsonb default null) returns void language plpgsql security definer set search_path='' as $$declare j public.sync_jobs;begin
 select * into j from public.sync_jobs where id=p_id and lease_id=p_lease and status='running' and lease_until>now() for update;
 if not found then raise exception 'Job lease expired or revoked';end if;
 update public.sync_jobs set status=case when p_error is null then 'succeeded' when attempts>=max_attempts then 'failed' else 'queued' end,
 last_error=case when p_error is null then null else 'Processing failed; check worker configuration or input and retry.' end,result=p_result,
 available_at=now()+make_interval(secs=>least(3600,5*power(2,attempts)::integer)),lease_id=null,lease_until=null,updated_at=now() where id=p_id;
end$$;
create function public.run_import_job(p_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare j public.sync_jobs;r jsonb;begin
 select * into j from public.sync_jobs where id=p_id and lease_id=p_lease and status='running' and lease_until>now() and kind='import' for update;
 if not found then raise exception 'Job lease expired or revoked';end if;
 begin
  if not exists(select 1 from public.workspace_members where workspace_id=j.workspace_id and user_id=j.created_by and role in ('owner','editor')) then raise exception 'Import authorization revoked';end if;
  r:=public.ingest_conversation(j.workspace_id,j.project_id,j.payload);
 exception when others then perform public.finish_job(p_id,p_lease,'failed',null);return jsonb_build_object('error','Import failed; check source and current workspace permissions');end;
 perform public.finish_job(p_id,p_lease,null,r);return r;
end$$;
create function public.workspace_usage(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not public.is_member(p_workspace) then raise exception 'Workspace access denied';end if;
 select jsonb_build_object('plan',coalesce((select plan_id from public.workspace_billing where workspace_id=p_workspace),'free'),'billing_status',coalesce((select status from public.workspace_billing where workspace_id=p_workspace),'unconfigured'),
 'limits',(select limits from public.plan_catalog where id=coalesce((select plan_id from public.workspace_billing where workspace_id=p_workspace),'free')),
 'memories',(select count(*) from public.memories where workspace_id=p_workspace),'pending',(select count(*) from public.memories where workspace_id=p_workspace and status='pending'),
 'conversations',(select count(*) from public.conversations where workspace_id=p_workspace),'projects',(select count(*) from public.projects where workspace_id=p_workspace),
 'connections',(select count(*) from public.agent_connections where workspace_id=p_workspace and state<>'revoked' and expires_at>now()),
 'verified_agents',(select count(*) from public.agent_connections where workspace_id=p_workspace and state='verified' and expires_at>now()),
 'requests_30d',(select count(*) from public.connection_events where workspace_id=p_workspace and created_at>now()-interval '30 days'),
 'jobs',(select count(*) from public.sync_jobs where workspace_id=p_workspace),
 'stored_text_bytes',(select coalesce(sum(octet_length(content)),0) from public.messages where workspace_id=p_workspace)+(select coalesce(sum(octet_length(content)),0) from public.memories where workspace_id=p_workspace),
 'last_successful_sync',(select max(updated_at) from public.sync_jobs where workspace_id=p_workspace and status='succeeded' and kind='import')) into result;return result;
end$$;
create function public.enforce_plan_limit() returns trigger language plpgsql security definer set search_path='' as $$declare ceiling bigint;n bigint;resource text;begin
 perform 1 from public.workspaces where id=new.workspace_id for update;
 resource:=case when tg_table_name='agent_connections' then 'connections' else tg_table_name end;
 select (limits->>resource)::bigint into ceiling from public.plan_catalog where id=coalesce((select plan_id from public.workspace_billing where workspace_id=new.workspace_id),'free');
 if ceiling is not null then
  execute format('select count(*) from public.%I where workspace_id=$1',tg_table_name) into n using new.workspace_id;
  if n>=ceiling then raise exception 'Workspace % limit reached',resource;end if;
 end if;return new;
end$$;
create trigger memories_quota before insert on public.memories for each row execute function public.enforce_plan_limit();
create trigger conversations_quota before insert on public.conversations for each row execute function public.enforce_plan_limit();
create trigger projects_quota before insert on public.projects for each row execute function public.enforce_plan_limit();
create trigger connections_quota before insert on public.agent_connections for each row execute function public.enforce_plan_limit();

create function public.search_memories(p_workspace uuid,p_query text default '',p_status text default 'active',p_category text default null,p_project text default null,p_platform text default null,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 if not public.is_member(p_workspace) then raise exception 'Workspace access denied';end if;
 if length(p_query)>1000 or p_offset<0 then raise exception 'Invalid search';end if;
 with matches as(select m.* from public.memories m where workspace_id=p_workspace and (p_status='all' or status=p_status) and (p_category is null or category=p_category) and (p_project is null or (p_project='global' and project_id is null) or project_id::text=p_project)
 and (p_query='' or search_document @@ plainto_tsquery('english'::regconfig,p_query))
 and (p_platform is null or exists(select 1 from public.memory_sources s join public.conversations c on c.id=s.conversation_id where s.memory_id=m.id and c.platform=p_platform)))
 select jsonb_build_object('total',(select count(*) from matches),'items',(select coalesce(jsonb_agg(x),'[]') from (select id,workspace_id,project_id,content,category,confidence,importance,sensitivity,status,reason,version,created_at,updated_at from matches order by updated_at desc,id limit 15 offset p_offset) x)) into r;return r;
end$$;

-- Service-only billing update; verified events are idempotent and ordered.
create function public.apply_billing_event(p_event text,p_workspace uuid,p_type text,p_created bigint,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.workspaces where id=p_workspace for update;
 insert into public.billing_events values(p_event,p_workspace,p_type,now()) on conflict do nothing;if not found then return;end if;
 insert into public.workspace_billing(workspace_id,plan_id,customer_id,subscription_id,status,cancel_at_period_end,current_period_end,last_event_at)
 values(p_workspace,p_data->>'plan',p_data->>'customer_id',p_data->>'subscription_id',p_data->>'status',coalesce((p_data->>'cancel_at_period_end')::boolean,false),(p_data->>'current_period_end')::timestamptz,p_created)
 on conflict(workspace_id) do update set plan_id=excluded.plan_id,customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,current_period_end=excluded.current_period_end,last_event_at=excluded.last_event_at,updated_at=now() where public.workspace_billing.last_event_at<=excluded.last_event_at;
end$$;
create function public.delete_account_data(p_user uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.workspaces where owner_id=p_user for update;
 if exists(select 1 from public.workspaces w join public.workspace_members m on m.workspace_id=w.id where w.owner_id=p_user and m.user_id<>p_user) then raise exception 'Transfer shared workspace ownership before deleting account';end if;
 if exists(select 1 from public.workspaces w join public.workspace_billing b on b.workspace_id=w.id where w.owner_id=p_user and b.subscription_id is not null and b.status not in ('canceled','incomplete_expired')) then raise exception 'Cancel subscriptions before deleting account';end if;
 delete from auth.users where id=p_user;if not found then raise exception 'Account not found';end if;
end$$;
-- Cascading workspace deletion must not recreate audit rows for an already deleted parent.
create or replace function public.audit_record() returns trigger language plpgsql security definer set search_path='' as $$declare r record;begin
 if tg_op='DELETE' then r:=old;else r:=new;end if;
 if exists(select 1 from public.workspaces where id=r.workspace_id) then insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id) values(r.workspace_id,auth.uid(),tg_op,tg_table_name,r.id);end if;
 if tg_op='DELETE' then return old;else return new;end if;end$$;

revoke all on function public.invite_member(uuid,text,text),public.accept_invitation(text),public.manage_member(uuid,text,uuid,text),public.list_members(uuid),public.enqueue_import(uuid,uuid,jsonb),public.control_job(uuid,text),public.workspace_usage(uuid),public.search_memories(uuid,text,text,text,text,text,integer),public.claim_jobs(integer),public.finish_job(uuid,uuid,text,jsonb),public.run_import_job(uuid,uuid),public.apply_billing_event(text,uuid,text,bigint,jsonb),public.delete_account_data(uuid),public.enforce_plan_limit() from public,anon,authenticated;
grant execute on function public.invite_member(uuid,text,text),public.accept_invitation(text),public.manage_member(uuid,text,uuid,text),public.list_members(uuid),public.enqueue_import(uuid,uuid,jsonb),public.control_job(uuid,text),public.workspace_usage(uuid),public.search_memories(uuid,text,text,text,text,text,integer) to authenticated;
grant execute on function public.claim_jobs(integer),public.finish_job(uuid,uuid,text,jsonb),public.run_import_job(uuid,uuid),public.apply_billing_event(text,uuid,text,bigint,jsonb),public.delete_account_data(uuid) to service_role;
grant select,insert,update on public.workspace_billing to service_role;
grant select on public.plan_catalog to service_role;
commit;


-- ============================================================
-- Migration: 202610310005_semantic_handoffs.sql
-- ============================================================
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


-- ============================================================
-- Migration: 202610310006_product_hardening.sql
-- ============================================================
begin;
-- Replace old development-only ceilings with the central plan catalog, retaining all other validation.
do $$declare definition text;begin
 select pg_get_functiondef('public.configure_connection(uuid,uuid,text,text,jsonb,boolean,boolean)'::regprocedure) into definition;
 definition:=replace(definition,'if (select count(*) from public.agent_connections where workspace_id=p_workspace)>=100 then raise exception ''Connection limit reached'';end if;','');execute definition;
 select pg_get_functiondef('public.ingest_conversation(uuid,uuid,jsonb,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if (select count(*) from public.conversations where workspace_id=p_workspace)>=1000 then raise exception ''Workspace import limit reached'';end if;','');execute definition;
end$$;
create or replace function public.enforce_plan_limit() returns trigger language plpgsql security definer set search_path='' as $$declare ceiling bigint;n bigint;resource text;begin
 perform 1 from public.workspaces where id=new.workspace_id for update;
 resource:=case when tg_table_name='agent_connections' then 'connections' else tg_table_name end;
 if tg_table_name='memories' then
  if exists(select 1 from public.memories where workspace_id=new.workspace_id and project_id is not distinct from new.project_id and md5(lower(regexp_replace(content,'\s+',' ','g')))=md5(lower(regexp_replace(new.content,'\s+',' ','g')))) then return new;end if;
 end if;
 select (limits->>resource)::bigint into ceiling from public.plan_catalog where id=coalesce((select plan_id from public.workspace_billing where workspace_id=new.workspace_id),'free');
 if ceiling is not null then
  if tg_table_name='agent_connections' then select count(*) into n from public.agent_connections where workspace_id=new.workspace_id and state<>'revoked' and expires_at>now();
  else execute format('select count(*) from public.%I where workspace_id=$1',tg_table_name) into n using new.workspace_id;end if;
  if n>=ceiling then raise exception 'Workspace % limit reached',resource;end if;
 end if;return new;
end$$;
-- Keep only references in the stored handoff package. Retrieval always rebuilds current authorized content.
create function public.handoff_references() returns trigger language plpgsql set search_path='' as $$begin
 new.package:=new.package-'messages'-'memories';return new;
end$$;
create trigger handoff_references before insert or update on public.project_handoffs for each row execute function public.handoff_references();

alter function public.export_workspace(uuid) rename to export_workspace_connections;
revoke all on function public.export_workspace_connections(uuid) from public,anon,authenticated;
create function public.export_workspace(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 r:=public.export_workspace_connections(p_workspace);
 return r||jsonb_build_object(
 'members',(select coalesce(jsonb_agg(m),'[]') from public.workspace_members m where workspace_id=p_workspace),
 'onboarding',(select coalesce(jsonb_agg(o),'[]') from public.onboarding_progress o where workspace_id=p_workspace and user_id=auth.uid()),
 'invitations',case when public.is_owner(p_workspace) then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'expires_at',expires_at,'accepted_at',accepted_at,'revoked_at',revoked_at)),'[]') from public.workspace_invitations where workspace_id=p_workspace) else '[]'::jsonb end,
 'billing',(select to_jsonb(b) from public.workspace_billing b where workspace_id=p_workspace),
 'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'status',status,'attempts',attempts,'last_error',last_error,'result',result,'created_at',created_at,'payload',case when created_by=auth.uid() or public.is_owner(p_workspace) then payload else null end)),'[]') from public.sync_jobs where workspace_id=p_workspace));
end$$;
create function public.export_account() returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select jsonb_build_object('exported_at',now(),'account',(select jsonb_build_object('id',id,'email',email) from auth.users where id=auth.uid()),'workspaces',(select coalesce(jsonb_agg(public.export_workspace(workspace_id)),'[]') from public.workspace_members where user_id=auth.uid())) into r;return r;
end$$;
-- Retention is explicit and owner-controlled. Captured content is deleted only through existing source controls.
create function public.prune_operational_history(p_workspace uuid,p_before timestamptz) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_owner(p_workspace) then raise exception 'Workspace owner required';end if;
 if p_before>now()-interval '30 days' then raise exception 'Keep at least 30 days of operational history';end if;
 delete from public.connection_events where workspace_id=p_workspace and created_at<p_before;
 delete from public.sync_jobs where workspace_id=p_workspace and status in ('succeeded','failed') and updated_at<p_before;
 insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id) values(p_workspace,auth.uid(),'Operational history pruned','workspace',p_workspace);
end$$;
create function public.memory_platforms(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 if not public.is_member(p_workspace) then raise exception 'Workspace access denied';end if;
 select coalesce(jsonb_agg(platform order by platform),'[]') into r from(select distinct platform from public.conversations where workspace_id=p_workspace) p;return r;
end$$;
revoke all on function public.export_workspace(uuid),public.export_account(),public.prune_operational_history(uuid,timestamptz),public.handoff_references(),public.memory_platforms(uuid) from public,anon,authenticated;
grant execute on function public.export_workspace(uuid),public.export_account(),public.prune_operational_history(uuid,timestamptz) to authenticated;
grant execute on function public.memory_platforms(uuid) to authenticated;
commit;


-- ============================================================
-- Migration: 202610310007_worker_reindex.sql
-- ============================================================
begin;

-- Reindexing is explicit, owner-controlled, and only queues data already covered
-- by the workspace's semantic-processing consent.
create function public.reindex_semantic(p_workspace uuid) returns integer language plpgsql security definer set search_path='' as $$
declare queued integer;
begin
 if not public.is_owner(p_workspace) then raise exception 'Workspace owner required'; end if;
 if not exists(select 1 from public.workspaces where id=p_workspace and preferences->>'semantic_enabled'='true') then
  raise exception 'Semantic processing consent is required before reindexing';
 end if;
 delete from public.semantic_embeddings where workspace_id=p_workspace;
 select count(*) into queued from public.memories m
 where m.workspace_id=p_workspace and m.status='active' and m.sensitivity='normal'
  and not exists(
   select 1 from public.memory_sources s
   join public.conversations c on c.id=s.conversation_id
   where s.memory_id=m.id and c.excluded
  );
 insert into public.sync_jobs(workspace_id,project_id,created_by,kind,payload,idempotency_key)
 select m.workspace_id,m.project_id,auth.uid(),'embedding',jsonb_build_object('memory_id',m.id,'version',m.version),m.id::text||':'||m.version
 from public.memories m
 where m.workspace_id=p_workspace and m.status='active' and m.sensitivity='normal'
  and not exists(
   select 1 from public.memory_sources s
   join public.conversations c on c.id=s.conversation_id
   where s.memory_id=m.id and c.excluded
  )
 on conflict(workspace_id,kind,idempotency_key) do update
  set status='queued',attempts=0,available_at=now(),lease_id=null,lease_until=null,last_error=null,updated_at=now();
 insert into public.audit_logs(workspace_id,actor_id,event,entity_type,entity_id)
 values(p_workspace,auth.uid(),'Semantic reindex queued','workspace',p_workspace);
 return queued;
end$$;

-- Worker heartbeats carry no workspace data, source text, credentials, or job payloads.
create table public.worker_heartbeats(
 worker_id text primary key check(length(worker_id) between 1 and 100),
 state text not null check(state in ('healthy','degraded','stopped')),
 last_seen_at timestamptz not null default now(),
 last_success_at timestamptz,
 last_error text,
 updated_at timestamptz not null default now()
);
alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from anon,authenticated;

create function public.heartbeat_worker(p_worker_id text,p_state text,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if length(trim(p_worker_id)) not between 1 and 100 then raise exception 'Invalid worker identifier'; end if;
 if p_state not in ('healthy','degraded','stopped') then raise exception 'Invalid worker state'; end if;
 if p_error is not null and length(p_error)>500 then raise exception 'Worker error exceeds limit'; end if;
 insert into public.worker_heartbeats(worker_id,state,last_seen_at,last_success_at,last_error,updated_at)
 values(trim(p_worker_id),p_state,now(),case when p_state='healthy' then now() else null end,p_error,now())
 on conflict(worker_id) do update set
  state=excluded.state,last_seen_at=excluded.last_seen_at,
  last_success_at=case when excluded.state='healthy' then excluded.last_success_at else public.worker_heartbeats.last_success_at end,
  last_error=excluded.last_error,updated_at=excluded.updated_at;
end$$;

create function public.worker_health() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'worker_id',worker_id,
   'state',case when last_seen_at<now()-interval '2 minutes' then 'stale' else state end,
   'last_seen_at',last_seen_at,'last_success_at',last_success_at,
   'last_error',last_error
  ) order by last_seen_at desc) from public.worker_heartbeats
 ),'[]'::jsonb);
end$$;

revoke all on function public.reindex_semantic(uuid),public.heartbeat_worker(text,text,text),public.worker_health() from public,anon,authenticated;
grant execute on function public.reindex_semantic(uuid),public.worker_health() to authenticated;
grant execute on function public.heartbeat_worker(text,text,text) to service_role;
commit;


-- ============================================================
-- Migration: 202610310008_llm_extraction.sql
-- ============================================================
begin;

-- Add 'extraction' as a valid job kind alongside 'import' and 'embedding'.
-- Uses ALTER to avoid rewriting the check constraint on the whole table.
alter table public.sync_jobs drop constraint sync_jobs_kind_check;
alter table public.sync_jobs add constraint sync_jobs_kind_check
  check(kind in ('import','embedding','extraction'));

-- ── enqueue_extraction ────────────────────────────────────────────────────────
-- Enqueues an LLM extraction job for a conversation that has already been
-- imported (processing_status = 'review' means proposals are waiting).
-- Idempotent: a second call for the same conversation returns the existing job ID.
create function public.enqueue_extraction(p_workspace uuid, p_conversation uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare j uuid; h text;
begin
  if not public.is_member(p_workspace, true) then
    raise exception 'Workspace editor required';
  end if;
  if not exists(
    select 1 from public.conversations
    where id = p_conversation and workspace_id = p_workspace
  ) then
    raise exception 'Conversation not found';
  end if;
  h := encode(sha256(convert_to('extraction:'||p_conversation::text, 'UTF8')), 'hex');
  insert into public.sync_jobs(
    workspace_id, project_id, created_by, kind, payload, idempotency_key
  )
  select
    p_workspace,
    project_id,
    auth.uid(),
    'extraction',
    jsonb_build_object('conversation_id', p_conversation),
    h
  from public.conversations where id = p_conversation
  on conflict(workspace_id, kind, idempotency_key) do update
    set id = public.sync_jobs.id
  returning id into j;
  return j;
end$$;

-- ── extraction_job_input ──────────────────────────────────────────────────────
-- Returns the conversation payload needed to run an extraction job.
-- Validates lease, checks conversation still exists and is accessible.
create function public.extraction_job_input(p_id uuid, p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'id',          j.id,
    'conversation_id', (j.payload->>'conversation_id')::uuid,
    'workspace_id',    j.workspace_id,
    'project_id',      j.project_id,
    'title',           c.title,
    'platform',        c.platform,
    'messages',        (
      select coalesce(jsonb_agg(
        jsonb_build_object('role', role, 'content', content)
        order by position
      ), '[]')
      from public.messages
      where conversation_id = c.id
    )
  ) into result
  from public.sync_jobs j
  join public.conversations c on c.id = (j.payload->>'conversation_id')::uuid
  where j.id = p_id
    and j.lease_id = p_lease
    and j.status = 'running'
    and j.lease_until > now()
    and j.kind = 'extraction'
    and c.workspace_id = j.workspace_id
    and not c.excluded
    and ((j.created_by is null and exists (select 1 from public.workspaces w where w.id=j.workspace_id and w.preferences->>'llm_extraction_enabled'='true'))
      or (j.created_by is not null and exists (select 1 from public.workspace_members wm where wm.workspace_id=j.workspace_id and wm.user_id=j.created_by and wm.role in ('owner','editor'))));

  if result is null then
    raise exception 'Extraction job expired, revoked, or conversation removed';
  end if;
  return result;
end$$;

-- ── complete_extraction_job ───────────────────────────────────────────────────
-- Stores LLM-extracted proposals as pending memories and marks the job done.
-- Exactly mirrors the proposal-storage logic in ingest_conversation but
-- applied after the fact to an already-imported conversation.
create function public.complete_extraction_job(
  p_id      uuid,
  p_lease   uuid,
  p_model   text,
  p_proposals jsonb   -- array of {content,category,confidence,sensitivity,message_index,reason}
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  j        public.sync_jobs;
  inp      jsonb;
  proposal jsonb;
  conv_id  uuid;
  wid      uuid;
  pid      uuid;
  msg_id   uuid;
  mem_id   uuid;
  n        integer := 0;
begin
  -- Validate lease
  select * into j from public.sync_jobs
  where id = p_id and lease_id = p_lease and status = 'running'
    and lease_until > now() and kind = 'extraction' for update;
  if not found then raise exception 'Job lease expired or revoked'; end if;

  inp     := public.extraction_job_input(p_id, p_lease);
  conv_id := (inp->>'conversation_id')::uuid;
  wid     := (inp->>'workspace_id')::uuid;
  pid     := (inp->>'project_id')::uuid;

  if length(p_model) not between 1 and 200 then
    raise exception 'Invalid model name';
  end if;
  if jsonb_typeof(p_proposals) is distinct from 'array' or
     jsonb_array_length(p_proposals) > 20 then
    raise exception 'Invalid proposals';
  end if;

  for proposal in select value from jsonb_array_elements(p_proposals) loop
    declare
      msg_index integer := (proposal->>'message_index')::integer;
      content   text    := proposal->>'content';
      evidence  text    := proposal->>'evidence';
      src_msg   jsonb;
    begin
      -- Validate evidence exists in the source message
      src_msg := inp->'messages'->msg_index;
      if src_msg is null or src_msg->>'role' is distinct from 'user' then continue; end if;
      if coalesce(length(evidence), 0) = 0 or position(evidence in (src_msg->>'content')) = 0 then continue; end if;
      if coalesce(length(content), 0) not between 12 and 1000 then continue; end if;

      mem_id := null;
      insert into public.memories(
        workspace_id, project_id, content, category,
        confidence, sensitivity, reason, status
      ) values(
        wid, pid,
        content,
        proposal->>'category',
        (proposal->>'confidence')::numeric,
        coalesce(proposal->>'sensitivity', 'normal'),
        left(coalesce(proposal->>'reason',
          'LLM-extracted by model '||p_model||'. Human review required.'), 1000),
        'pending'
      )
      on conflict do nothing
      returning id into mem_id;

      if mem_id is null then
        -- Deduplicated — find existing
        select m.id into mem_id from public.memories m
        where m.workspace_id = wid
          and m.project_id is not distinct from pid
          and md5(lower(regexp_replace(m.content, '\s+', ' ', 'g'))) =
              md5(lower(regexp_replace(proposal->>'content', '\s+', ' ', 'g')));
      else
        n := n + 1;
      end if;

      -- Link memory to the source message
      select id into msg_id from public.messages
      where conversation_id = conv_id and position = msg_index;

      if mem_id is not null and msg_id is not null then
        insert into public.memory_sources(workspace_id, memory_id, conversation_id, message_id, evidence)
        values(wid, mem_id, conv_id, msg_id, evidence)
        on conflict do nothing;
      end if;
    end;
  end loop;

  -- Update conversation processing status
  update public.conversations
  set processing_status = case when exists (select 1 from public.memory_sources s join public.memories m on m.id=s.memory_id where s.conversation_id=conv_id and m.status='pending') then 'review' else 'complete' end
  where id = conv_id;

  -- Mark extraction model used on the conversation for observability
  update public.conversations
  set source_metadata = source_metadata || jsonb_build_object(
    'extraction_model', p_model,
    'extraction_at', now()::text,
    'llm_proposals', n
  )
  where id = conv_id;

  perform public.finish_job(p_id, p_lease, null,
    jsonb_build_object('conversation_id', conv_id, 'model', p_model, 'proposals', n));

  return jsonb_build_object('conversation_id', conv_id, 'model', p_model, 'proposals', n);
end$$;

-- ── auto-enqueue extraction after import ─────────────────────────────────────
-- When a conversation is imported (import job succeeds, processing_status set),
-- automatically enqueue an extraction job if the workspace has LLM extraction
-- enabled. The preference key 'llm_extraction_enabled' controls opt-in.
create function public.queue_llm_extraction() returns trigger language plpgsql
security definer set search_path='' as $$
begin
  if new.processing_status in ('review', 'complete') and
     exists(
       select 1 from public.workspaces
       where id = new.workspace_id
         and preferences->>'llm_extraction_enabled' = 'true'
     ) then
    insert into public.sync_jobs(
      workspace_id, project_id, created_by, kind, payload, idempotency_key
    ) values(
      new.workspace_id, new.project_id, null, 'extraction',
      jsonb_build_object('conversation_id', new.id),
      encode(sha256(convert_to('extraction:'||new.id::text, 'UTF8')), 'hex')
    ) on conflict do nothing;
  end if;
  return new;
end$$;

create trigger auto_queue_extraction
  after update of processing_status on public.conversations
  for each row execute function public.queue_llm_extraction();

-- ── configure_llm_extraction ──────────────────────────────────────────────────
-- Owner opt-in/out of LLM extraction for their workspace.
create function public.configure_llm_extraction(p_workspace uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_owner(p_workspace) then
    raise exception 'Workspace owner required';
  end if;
  update public.workspaces
  set preferences = preferences || jsonb_build_object('llm_extraction_enabled', p_enabled)
  where id = p_workspace;
end$$;

-- Grants
revoke all on function
  public.enqueue_extraction(uuid, uuid),
  public.extraction_job_input(uuid, uuid),
  public.complete_extraction_job(uuid, uuid, text, jsonb),
  public.queue_llm_extraction(),
  public.configure_llm_extraction(uuid, boolean)
from public, anon, authenticated;

grant execute on function public.enqueue_extraction(uuid, uuid) to authenticated;
grant execute on function public.configure_llm_extraction(uuid, boolean) to authenticated;
grant execute on function public.extraction_job_input(uuid, uuid) to service_role;
grant execute on function public.complete_extraction_job(uuid, uuid, text, jsonb) to service_role;

commit;


-- ============================================================
-- Migration: 202610310009_llm_extraction_replace.sql
-- ============================================================
-- Fix complete_extraction_job: accept JSON string payloads, replace unreviewed
-- regex proposals, validate category/confidence, and return 'replaced' count.
begin;

create or replace function public.complete_extraction_job(
  p_id      uuid,
  p_lease   uuid,
  p_model   text,
  p_proposals jsonb   -- array of {content,category,confidence,sensitivity,message_index,evidence,reason}
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  j        public.sync_jobs;
  inp      jsonb;
  proposal jsonb;
  conv_id  uuid;
  wid      uuid;
  pid      uuid;
  msg_id   uuid;
  mem_id   uuid;
  n        integer := 0;
  replaced_count integer := 0;
  valid_categories text[] := array['Facts','Preferences','Decisions','Projects','Goals','Skills','Instructions','Events','Summaries'];
  raw_text text;
begin
  -- Validate lease
  select * into j from public.sync_jobs
  where id = p_id and lease_id = p_lease and status = 'running'
    and lease_until > now() and kind = 'extraction' for update;
  if not found then raise exception 'Job lease expired or revoked'; end if;

  inp     := public.extraction_job_input(p_id, p_lease);
  conv_id := (inp->>'conversation_id')::uuid;
  wid     := (inp->>'workspace_id')::uuid;
  pid     := (inp->>'project_id')::uuid;

  if length(p_model) not between 1 and 200 then
    raise exception 'Invalid model name';
  end if;

  -- Accept JSON string payload: if p_proposals is a string, parse it as JSON
  if jsonb_typeof(p_proposals) = 'string' then
    raw_text := p_proposals #>> '{}';
    p_proposals := raw_text::jsonb;
  end if;

  if jsonb_typeof(p_proposals) is distinct from 'array' or
     jsonb_array_length(p_proposals) > 20 then
    raise exception 'Invalid proposals';
  end if;

  -- Remove unreviewed (pending) regex-based proposals for this conversation
  -- so LLM proposals replace them. Only remove proposals whose reason starts
  -- with "Conservative server rule" (the regex-based marker).
  -- First, find the memory IDs to remove (only those linked solely to
  -- this conversation, so we don't break other source links).
  -- Then delete source links and memories in the right order.

  -- Step 1: Identify memories to remove
  create temp table _to_remove as
  select m.id from public.memories m
  where m.workspace_id = wid
    and m.status = 'pending'
    and m.reason like 'Conservative server rule%'
    and m.id in (select s.memory_id from public.memory_sources s where s.conversation_id = conv_id)
    and m.id not in (
      select s2.memory_id from public.memory_sources s2
      where s2.conversation_id <> conv_id
    );

  -- Step 2: Count how many we will remove
  select count(*) into replaced_count from _to_remove;

  -- Step 3: Delete source links for this conversation pointing to those memories
  delete from public.memory_sources
  where conversation_id = conv_id
    and memory_id in (select id from _to_remove);

  -- Step 4: Delete the orphaned memories
  delete from public.memories
  where id in (select id from _to_remove);

  -- Clean up temp table
  drop table _to_remove;

  for proposal in select value from jsonb_array_elements(p_proposals) loop
    declare
      msg_index integer;
      content   text;
      evidence  text;
      category  text;
      src_msg   jsonb;
    begin
      -- Skip non-object entries
      if jsonb_typeof(proposal) <> 'object' then continue; end if;

      msg_index := (proposal->>'message_index')::integer;
      content   := proposal->>'content';
      evidence  := proposal->>'evidence';
      category  := proposal->>'category';

      -- Validate evidence exists in the source message
      src_msg := inp->'messages'->msg_index;
      if src_msg is null or src_msg->>'role' is distinct from 'user' then continue; end if;
      if coalesce(length(evidence), 0) = 0 or position(evidence in (src_msg->>'content')) = 0 then continue; end if;
      if coalesce(length(content), 0) not between 12 and 1000 then continue; end if;

      -- Validate category is one of the allowed values
      if category is null or not (category = any(valid_categories)) then continue; end if;

      -- Validate confidence is a numeric value between 0 and 1
      begin
        if (proposal->>'confidence') is null then continue; end if;
        if not ((proposal->>'confidence')::numeric between 0 and 1) then continue; end if;
      exception when others then
        continue;
      end;

      mem_id := null;
      insert into public.memories(
        workspace_id, project_id, content, category,
        confidence, sensitivity, reason, status
      ) values(
        wid, pid,
        content,
        category,
        (proposal->>'confidence')::numeric,
        coalesce(proposal->>'sensitivity', 'normal'),
        left(coalesce(proposal->>'reason',
          'LLM-extracted by model '||p_model||'. Human review required.'), 1000),
        'pending'
      )
      on conflict do nothing
      returning id into mem_id;

      if mem_id is null then
        -- Deduplicated — find existing
        select m.id into mem_id from public.memories m
        where m.workspace_id = wid
          and m.project_id is not distinct from pid
          and md5(lower(regexp_replace(m.content, '\s+', ' ', 'g'))) =
              md5(lower(regexp_replace(content, '\s+', ' ', 'g')));
      else
        n := n + 1;
      end if;

      -- Link memory to the source message
      select id into msg_id from public.messages
      where conversation_id = conv_id and position = msg_index;

      if mem_id is not null and msg_id is not null then
        insert into public.memory_sources(workspace_id, memory_id, conversation_id, message_id, evidence)
        values(wid, mem_id, conv_id, msg_id, evidence)
        on conflict do nothing;
      end if;
    end;
  end loop;

  -- Update conversation processing status
  update public.conversations
  set processing_status = case when exists (select 1 from public.memory_sources s join public.memories m on m.id=s.memory_id where s.conversation_id=conv_id and m.status='pending') then 'review' else 'complete' end
  where id = conv_id;

  -- Mark extraction model used on the conversation for observability
  update public.conversations
  set source_metadata = source_metadata || jsonb_build_object(
    'extraction_model', p_model,
    'extraction_at', now()::text,
    'llm_proposals', n
  )
  where id = conv_id;

  perform public.finish_job(p_id, p_lease, null,
    jsonb_build_object('conversation_id', conv_id, 'model', p_model, 'proposals', n, 'replaced', replaced_count));

  return jsonb_build_object('conversation_id', conv_id, 'model', p_model, 'proposals', n, 'replaced', replaced_count);
end$$;

commit;



