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
