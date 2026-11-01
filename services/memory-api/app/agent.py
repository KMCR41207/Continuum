from sqlalchemy import select
from .database import Project, Conversation, Message, Memory, Source, State, serialize, now
from .schemas import Query, MemoryPatch
from .security import authorize, deny
from .engine import query_memories, propose, ingest, change_memory, permitted_memory, permitted_conversation, audit


def agent_call(db, identity, settings, vectors, operation, args):
    if not identity.connection:
        deny("Scoped agent credential required")
    c = identity.connection
    workspace, project = c.workspace_id, args.get("project_id")
    if operation in ("test_connection", "status"):
        return {"id": c.id, "connection_id": c.id, "workspace_id": workspace, "permissions": c.permissions, "provider_session_verified": False}
    if operation == "disconnect":
        c.state = "revoked"
        return {"revoked": True}
    if operation in ("search_memory", "get_recent_context", "export_memories", "recall_context"):
        if not c.permissions.get("retrieval"):
            deny("Retrieval permission required")
        result = query_memories(db, identity, Query(workspace_id=workspace, project_id=project, query=args.get("query", ""), tags=args.get("tags", []), category=args.get("category"), source=args.get("source"), top_k=min(50, args.get("limit", args.get("top_k", 8))), max_context_tokens=args.get("max_context_tokens", 2500)), vectors)
        return result if operation == "recall_context" else result["items"]
    if operation == "recall_memory":
        memory = db.get(Memory, args.get("id"))
        if not memory or not permitted_memory(db, identity, memory):
            deny("Memory not found", 404)
        result = serialize(memory)
        result["sources"] = [serialize(s) for s in db.scalars(select(Source).where(Source.memory_id == memory.id))]
        return result
    if operation in ("save_fact", "save_memory", "save_project_note"):
        authorize(db, identity, workspace, "write", project)
        content = args.get("fact_text", args.get("content", ""))
        memory = propose(db, workspace, project, content, args.get("category", "Facts"), args.get("tags", []))
        if not list(db.scalars(select(Source).where(Source.memory_id == memory.id))):
            db.add(Source(workspace_id=workspace, memory_id=memory.id, evidence=content, source_reference=str(args.get("source_reference") or "agent:" + c.id)))
        audit(db, identity, workspace, "Agent proposed memory for review", "memory", memory.id)
        return serialize(memory)
    if operation == "update_memory":
        memory = db.get(Memory, args.get("id"))
        if not memory:
            deny("Memory not found", 404)
        return change_memory(db, identity, memory, MemoryPatch.model_validate({k: v for k, v in args.items() if k in MemoryPatch.model_fields}).model_dump(exclude_none=True))
    if operation == "capture_conversation":
        result = ingest(db, identity, workspace, project, args.get("conversation"))
        c.last_sync_at = now()
        return result
    if operation == "list_projects":
        if not c.permissions.get("retrieval"):
            deny()
        return [serialize(p) for p in db.scalars(select(Project).where(Project.workspace_id == workspace)) if p.id in c.permissions.get("project_ids", [])]
    if operation in ("search_conversations", "get_conversation"):
        records = [v for v in db.scalars(select(Conversation).where(Conversation.workspace_id == workspace)) if permitted_conversation(db, identity, v) and (not project or v.project_id == project)]
        if operation == "search_conversations":
            return [serialize(v) for v in records if args.get("query", "").lower() in v.title.lower()][:50]
        record = next((v for v in records if v.id == args.get("id")), None)
        if not record:
            deny("Conversation not found", 404)
        return {**serialize(record), "messages": [serialize(m) for m in db.scalars(select(Message).where(Message.conversation_id == record.id).order_by(Message.position))]}
    if operation == "get_project_context":
        authorize(db, identity, workspace, "read", project)
        if not project:
            deny("Project required", 422)
        import json
        budget = Query(max_context_tokens=args.get("max_context_tokens", 2500)).max_context_tokens
        p = db.get(Project, project)
        result = {"id": p.id, "name": p.name, "instructions": p.instructions, "memories": []}
        base = len(json.dumps(result, ensure_ascii=False).encode())
        if base > budget:
            result["instructions"] = ""
            result["instructions_omitted_for_budget"] = True
            base = len(json.dumps(result, ensure_ascii=False).encode())
        remaining = budget - base - 16
        if remaining >= 32:
            result["memories"] = query_memories(db, identity, Query(workspace_id=workspace, project_id=project, max_context_tokens=remaining), vectors)["items"]
        if len(json.dumps(result, ensure_ascii=False).encode()) > budget:
            return []
        return [result]
    if operation == "get_handoffs":
        result = []
        for handoff in db.scalars(select(State).where(State.workspace_id == workspace, State.kind == "handoff")):
            data = handoff.data
            conversation = db.get(Conversation, data["conversation_id"])
            if data["destination_connection_id"] == c.id and conversation and permitted_conversation(db, identity, conversation) and (not project or conversation.project_id == project):
                result.append({"id": handoff.id, "note": data["note"], "conversation_id": conversation.id, "context": agent_call(db, identity, settings, vectors, "get_conversation", {"id": conversation.id})})
        return result
    deny("Unknown operation", 404)
