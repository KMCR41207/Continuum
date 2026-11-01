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
