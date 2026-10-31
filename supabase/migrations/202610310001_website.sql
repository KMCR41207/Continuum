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
