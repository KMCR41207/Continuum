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
