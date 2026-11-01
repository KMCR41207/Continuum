import hashlib
import json
import re
from datetime import datetime, timezone
from sqlalchemy import select, text
from fastapi import HTTPException
from .database import Memory, Source, Message, Conversation, MemoryVersion, Job, AuditEvent, Workspace, serialize, now
from .schemas import CATEGORIES, ConversationInput
from .security import authorize, deny


def hash_text(value):
    return hashlib.sha256(re.sub(r"\s+", " ", value.strip().lower()).encode()).hexdigest()


def audit(db, identity, workspace, event, entity, identifier=None):
    db.add(AuditEvent(workspace_id=workspace, actor_id=identity.user_id or (identity.connection.id if identity.connection else None), event=event, entity_type=entity, entity_id=identifier))


def enqueue(db, workspace, project, kind, payload, key):
    job = db.scalar(select(Job).where(Job.workspace_id == workspace, Job.kind == kind, Job.idempotency_key == key))
    if not job:
        job = Job(workspace_id=workspace, project_id=project, kind=kind, payload=payload, idempotency_key=key)
        db.add(job)
        db.flush()
    return job


def extraction(messages):
    rules = [
        (r"\b(we decided|we chose|let[’']s use|we selected)\b", "Decisions"),
        (r"\b(i prefer|my preference|i like .* explanations)\b", "Preferences"),
        (r"\b(this project uses|our stack is|the frontend uses|the backend uses)\b", "Technical architecture"),
        (r"\b(my goal is|i am building|i'm building)\b", "Goals"),
        (r"^(always|never|please use)\s", "Instructions"),
        (r"\b(coding convention|code style)\b", "Coding conventions"),
        (r"\b(i can|i am skilled in)\b", "Skills"),
        (r"\b(our project is|this project is)\b", "Projects"),
        (r"\b(we launched|we completed)\b", "Events"),
    ]
    seen = set()
    for index, message in enumerate(messages):
        if message.role != "user":
            continue
        for content in re.split(r"(?<=[.!?])\s+|\n+", message.content):
            content = content.strip()
            if not 12 <= len(content) <= 1000 or content.endswith("?") or re.search(r"\b(today|tonight|tomorrow|maybe|perhaps|might|could|ignore .*instructions|system prompt|bypass|pretend)\b", content, re.I):
                continue
            category = next((category for pattern, category in rules if re.search(pattern, content, re.I)), None)
            key = hash_text(content)
            if category and key not in seen:
                seen.add(key)
                sensitivity = "sensitive" if re.search(r"password|secret|api.?key|token|ssn|[\w.+-]+@[\w.-]+\.\w+", content, re.I) else "normal"
                yield index, content, category, sensitivity
                if len(seen) >= 100:
                    return


def propose(db, workspace, project, content, category="Facts", tags=None, sensitivity="normal"):
    if category not in CATEGORIES or not 12 <= len(content) <= 4000:
        deny("Invalid memory category or content", 422)
    key = hash_text(content)
    memory = db.scalar(select(Memory).where(Memory.workspace_id == workspace, Memory.scope == (project or "global"), Memory.content_hash == key))
    if not memory:
        memory = Memory(workspace_id=workspace, project_id=project, scope=project or "global", content=content, content_hash=key, category=category, tags=tags or [], sensitivity=sensitivity, confidence=0.9 if category == "Decisions" else 0.8)
        db.add(memory)
        db.flush()
    return memory


def ingest(db, identity, workspace, project, raw):
    authorize(db, identity, workspace, "capture", project)
    data = ConversationInput.model_validate(raw)
    content_hash = hashlib.sha256(json.dumps(data.model_dump(), sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    key = hash_text((project or "global") + content_hash)
    existing = db.scalar(select(Conversation).where(Conversation.workspace_id == workspace, Conversation.scope_hash == key))
    if existing:
        return {"id": existing.id, "duplicate": True, "proposals": 0}
    conversation = Conversation(workspace_id=workspace, project_id=project, title=data.title, platform=data.platform, scope_hash=key, message_count=len(data.messages), source_metadata=data.metadata)
    db.add(conversation)
    db.flush()
    messages = []
    for i, message in enumerate(data.messages):
        saved = Message(workspace_id=workspace, conversation_id=conversation.id, position=i, role=message.role, content=message.content, source_metadata=message.metadata)
        db.add(saved)
        messages.append(saved)
    db.flush()
    count = 0
    for index, content, category, sensitivity in extraction(data.messages):
        memory = propose(db, workspace, project, content, category, sensitivity=sensitivity)
        db.add(Source(workspace_id=workspace, memory_id=memory.id, conversation_id=conversation.id, message_id=messages[index].id, evidence=content, source_reference=str(data.metadata.get("url", ""))))
        count += 1
    conversation.processing_status = "review" if count else "complete"
    audit(db, identity, workspace, "Conversation imported", "conversation", conversation.id)
    return {"id": conversation.id, "duplicate": False, "proposals": count}


def permitted_conversation(db, identity, conversation):
    if conversation.excluded:
        return False
    try:
        authorize(db, identity, conversation.workspace_id, "history", conversation.project_id)
        if identity.connection:
            p = identity.connection.permissions
            return bool(p.get("all_history") or conversation.id in p.get("conversation_ids", []))
        return True
    except HTTPException:
        return False


def permitted_memory(db, identity, memory):
    try:
        authorize(db, identity, memory.workspace_id, "read", memory.project_id)
    except HTTPException:
        return False
    if memory.status != "active" or memory.sensitivity != "normal":
        return False
    for source in db.scalars(select(Source).where(Source.memory_id == memory.id)):
        if source.conversation_id:
            conversation = db.get(Conversation, source.conversation_id)
            if not conversation or not permitted_conversation(db, identity, conversation):
                return False
        if source.file_id and identity.connection and not identity.connection.permissions.get("files_read"):
            return False
    return True


def change_memory(db, identity, memory, changes):
    authorize(db, identity, memory.workspace_id, "write", memory.project_id)
    if changes.pop("version", None) != memory.version:
        deny("Memory changed; refresh before saving", 409)
    if identity.connection:
        if not permitted_memory(db, identity, memory):
            deny()
        changes["status"] = "pending"
    if changes.get("category", memory.category) not in CATEGORIES:
        deny("Invalid category", 422)
    db.add(MemoryVersion(workspace_id=memory.workspace_id, memory_id=memory.id, content=memory.content, category=memory.category, status=memory.status, version=memory.version))
    for key, value in changes.items():
        if value is not None and key in ("content", "category", "status", "sensitivity", "importance"):
            setattr(memory, key, value)
    memory.version += 1
    memory.updated_at = now()
    memory.content_hash = hash_text(memory.content)
    if memory.status == "active" and memory.sensitivity == "normal":
        enqueue(db, memory.workspace_id, memory.project_id, "embedding", {"memory_id": memory.id, "version": memory.version}, f"{memory.id}:{memory.version}")
    audit(db, identity, memory.workspace_id, "Memory updated", "memory", memory.id)
    db.flush()
    return serialize(memory)


def query_memories(db, identity, query, vectors=None):
    workspace = identity.connection.workspace_id if identity.connection else query.workspace_id
    if not workspace:
        deny("Select a workspace", 422)
    if identity.connection and not identity.connection.permissions.get("retrieval"):
        deny("Retrieval permission required")
    if not identity.connection:
        authorize(db, identity, workspace)
    candidates = list(db.scalars(select(Memory).where(Memory.workspace_id == workspace)))
    if query.project_id:
        authorize(db, identity, workspace, "read", query.project_id)
        candidates = [m for m in candidates if m.project_id == query.project_id]
    candidates = [m for m in candidates if permitted_memory(db, identity, m) and (not query.category or m.category == query.category) and (not query.tags or set(query.tags).issubset(m.tags))]
    semantic, mode = {}, "full_text"
    workspace_record = db.get(Workspace, workspace)
    if vectors and query.query and workspace_record.preferences.get("semantic_enabled"):
        try:
            semantic = vectors.search(workspace, query.project_id, query.query)
            mode = "hybrid"
        except Exception:
            mode = "full_text_fallback"
    words = re.findall(r"\w+", query.query.lower())
    lexical = set()
    if words:
        match = " OR ".join('"' + word + '"' for word in words)
        lexical = set(db.execute(text("SELECT id FROM memories_fts WHERE memories_fts MATCH :q"), {"q": match}).scalars())
    ranked = []
    for memory in candidates:
        sources = list(db.scalars(select(Source).where(Source.memory_id == memory.id)))
        providers = [db.get(Conversation, s.conversation_id).platform for s in sources if s.conversation_id]
        if query.source and query.source not in providers:
            continue
        vector_score, version = semantic.get(memory.id, (0, None))
        if version != memory.version:
            vector_score = 0
        keyword_score = sum(word in memory.content.lower() for word in words) / max(1, len(words)) if memory.id in lexical else 0
        if words and not keyword_score and vector_score < 0.35:
            continue
        age = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(memory.updated_at)).total_seconds() / 86400)
        score = .65 * vector_score + .25 * keyword_score + .05 * memory.confidence + .05 / (1 + age / 30)
        if score < query.relevance_threshold:
            continue
        record = serialize(memory)
        record.update(score=round(score, 6), sources=[serialize(s) for s in sources], source_provider=providers)
        ranked.append(record)
    ranked.sort(key=lambda m: (-m["score"], m["id"]))
    # One UTF-8 byte per estimated token, including metadata, is deliberately conservative.
    selected, used, seen = [], 2, set()
    for record in ranked:
        key = hash_text(record["content"])
        size = len(json.dumps(record, ensure_ascii=False).encode("utf-8")) + 1
        if key not in seen and used + size <= query.max_context_tokens and len(selected) < query.top_k:
            seen.add(key)
            selected.append(record)
            used += size
    audit(db, identity, workspace, "Context retrieved", "retrieval")
    return {"items": selected, "search_mode": mode, "estimated_context_tokens": used, "budget_method": "conservative UTF-8 byte upper bound of items JSON", "trust": "untrusted_source_data"}


def delete_conversation(db, identity, conversation):
    authorize(db, identity, conversation.workspace_id, "write", conversation.project_id)
    if identity.connection:
        deny("Only workspace editors may delete sources")
    ids = list(db.scalars(select(Source.memory_id).where(Source.conversation_id == conversation.id)))
    for identifier in set(ids):
        memory = db.get(Memory, identifier)
        if memory:
            db.delete(memory)
    db.flush()
    audit(db, identity, conversation.workspace_id, "Conversation and derived memories deleted", "conversation", conversation.id)
    db.delete(conversation)
