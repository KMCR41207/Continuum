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
