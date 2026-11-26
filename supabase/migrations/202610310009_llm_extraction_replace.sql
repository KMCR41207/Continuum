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
      msg_index  integer;
      mem_content text;
      evidence   text;
      category   text;
      src_msg    jsonb;
    begin
      -- Skip non-object entries
      if jsonb_typeof(proposal) <> 'object' then continue; end if;

      msg_index   := (proposal->>'message_index')::integer;
      mem_content := proposal->>'content';
      evidence    := proposal->>'evidence';
      category    := proposal->>'category';

      -- Validate evidence exists in the source message
      src_msg := inp->'messages'->msg_index;
      if src_msg is null or src_msg->>'role' is distinct from 'user' then continue; end if;
      if coalesce(length(evidence), 0) = 0 or position(evidence in (src_msg->>'content')) = 0 then continue; end if;
      if coalesce(length(mem_content), 0) not between 12 and 1000 then continue; end if;

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
        mem_content,
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
              md5(lower(regexp_replace(mem_content, '\s+', ' ', 'g')));
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
