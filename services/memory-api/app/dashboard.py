"""Compatibility contract for existing React pages; all operations use local services."""
import secrets
from sqlalchemy import select
from .database import *
from .security import authorize, deny, digest, later, Identity
from .engine import ingest, audit, change_memory, enqueue, permitted_memory, permitted_conversation
from .connections import configure

TABLES = {m.__tablename__: m for m in (Workspace, Member, Project, Conversation, Message, Memory, Source, MemoryVersion, Connection, Job, ProjectFile, FileChunk, AuditEvent, Invitation)}
TABLES.update(onboarding_progress=State, project_handoffs=State, connection_events=AuditEvent)


def data_rows(db, identity, table, filters=None):
    if identity.connection:
        deny("Dashboard requires a member session")
    if table == "plan_catalog":
        return [{"id": "selfhosted", "name": "Self-hosted", "enabled": False, "stripe_price_id": None}]
    if table == "workspace_billing":
        return []
    model = TABLES.get(table)
    if not model:
        deny("Unknown table", 404)
    memberships = {m.workspace_id: m.role for m in db.scalars(select(Member).where(Member.user_id == identity.user_id))}
    result = []
    for row in db.scalars(select(model)):
        workspace = row.id if model is Workspace else row.workspace_id
        if workspace not in memberships:
            continue
        if model is Invitation and memberships[workspace] != "owner":
            continue
        if model is State:
            kind = "onboarding:" + identity.user_id if table == "onboarding_progress" else "handoff"
            if row.kind != kind:
                continue
            value = {**serialize(row), **row.data}
        else:
            value = serialize(row)
        if table == "connection_events":
            if value["entity_type"] != "connection":
                continue
            value.update(connection_id=value["entity_id"], operation=value["event"], success=True, error_code=None)
        if all(value.get(k) in v if isinstance(v, list) else value.get(k) == v for k, v in (filters or {}).items()):
            result.append(value)
    return result


def mutate_data(db, identity, table, body):
    action, payload, filters = body.get("action"), body.get("values") or {}, body.get("filters") or {}
    if identity.connection:
        deny()
    if table == "onboarding_progress":
        workspace = payload.get("workspace_id")
        authorize(db, identity, workspace)
        if payload.get("user_id") != identity.user_id or not 0 <= payload.get("step", 0) <= 7:
            deny("Invalid onboarding state", 422)
        row = db.scalar(select(State).where(State.workspace_id == workspace, State.kind == "onboarding:" + identity.user_id))
        if not row:
            row = State(workspace_id=workspace, kind="onboarding:" + identity.user_id, data={})
            db.add(row)
        row.data = payload
        return [payload]
    if table not in ("projects", "workspaces", "conversations", "memories"):
        deny("Table is read-only")
    model = TABLES[table]
    if action == "insert":
        if table != "projects":
            deny()
        workspace = payload.get("workspace_id")
        authorize(db, identity, workspace, "write")
        name = payload.get("name", "").strip()
        if not 1 <= len(name) <= 100:
            deny("Project name required", 422)
        row = Project(workspace_id=workspace, name=name, description=payload.get("description", ""), instructions=payload.get("instructions", ""))
        db.add(row)
        db.flush()
        audit(db, identity, workspace, "Project created", "project", row.id)
        return [serialize(row)]
    records = data_rows(db, identity, table, filters)
    result = []
    for record in records:
        row = db.get(model, record["id"])
        workspace = row.id if table == "workspaces" else row.workspace_id
        authorize(db, identity, workspace, "owner" if table == "workspaces" else "write", getattr(row, "project_id", None))
        if action == "delete":
            if table == "conversations":
                from .engine import delete_conversation
                delete_conversation(db, identity, row)
            elif table in ("projects", "memories"):
                db.delete(row)
            else:
                deny()
        elif table == "memories":
            result.append(change_memory(db, identity, row, {**payload, "version": filters.get("version", row.version)}))
        else:
            allowed = {"projects": {"name", "description", "instructions", "status", "compaction_excluded"}, "workspaces": {"name", "preferences"}, "conversations": {"excluded", "compaction_excluded"}}[table]
            if set(payload) - allowed:
                deny("Unknown field", 422)
            for key, value in payload.items():
                setattr(row, key, value)
            result.append(serialize(row))
            audit(db, identity, workspace, "Record updated", table, row.id)
    return result


def rpc(db, identity, settings, vectors, name, a):
    workspace = a.get("p_workspace")
    if name == "agent_request":
        from .security import authenticate
        from .agent import agent_call
        agent = authenticate(db, settings, a.get("p_token"))
        return agent_call(db, agent, settings, vectors, a["p_operation"], a.get("p_args") or {})
    if identity.connection:
        deny()
    if name == "create_workspace":
        title = a.get("p_name", "").strip()
        if not 1 <= len(title) <= 100:
            deny("Workspace name required", 422)
        w = Workspace(owner_id=identity.user_id, name=title)
        db.add(w)
        db.flush()
        db.add(Member(workspace_id=w.id, user_id=identity.user_id, role="owner"))
        audit(db, identity, w.id, "Workspace created", "workspace", w.id)
        return w.id
    if name == "configure_connection":
        return configure(db, identity, workspace, a.get("p_id"), a["p_name"], a["p_provider"], a["p_permissions"], a.get("p_rotate", False), a.get("p_revoke", False))
    if name in ("import_conversation", "enqueue_import"):
        if name == "import_conversation":
            return ingest(db, identity, workspace, a.get("p_project"), a["p_input"])
        authorize(db, identity, workspace, "capture", a.get("p_project"))
        from .engine import hash_text
        import json
        job = enqueue(db, workspace, a.get("p_project"), "import", {"input": a["p_input"], "user_id": identity.user_id}, hash_text(str(a.get("p_project")) + json.dumps(a["p_input"], sort_keys=True)))
        return job.id
    if name == "control_job":
        job = db.get(Job, a["p_id"])
        if not job:
            deny("Job not found", 404)
        authorize(db, identity, job.workspace_id, "write", job.project_id)
        action = a["p_action"]
        if action == "pause" and job.status in ("running", "queued"):
            job.status = "paused"
        elif action in ("retry", "resume") and job.status in ("failed", "paused"):
            job.status, job.available_at, job.attempts, job.last_error = "queued", now(), 0, None
        else:
            deny("Invalid job transition", 409)
        job.lease_id, job.lease_until = None, None
        return None
    if name == "memory_conflict_candidates":
        memory = db.get(Memory, a["p_id"])
        if not memory:
            deny("Memory not found", 404)
        authorize(db, identity, memory.workspace_id)
        # Conservative candidates share category and initial subject; never resolve truth.
        subject = memory.content.lower().split()[:3]
        return [serialize(m) for m in db.scalars(select(Memory).where(Memory.workspace_id == memory.workspace_id, Memory.project_id == memory.project_id, Memory.category == memory.category)) if m.id != memory.id and m.content.lower().split()[:3] == subject and m.status in ("active", "pending")]
    if name == "accept_invitation":
        invitation = db.scalar(select(Invitation).where(Invitation.token_hash == digest(a["p_token"])))
        user = db.get(User, identity.user_id)
        if not invitation or invitation.revoked_at or invitation.accepted_at or invitation.expires_at <= now() or invitation.email != user.email:
            deny("Invitation invalid, expired or for another email")
        if not db.get(Member, (invitation.workspace_id, user.id)):
            db.add(Member(workspace_id=invitation.workspace_id, user_id=user.id, role=invitation.role))
        invitation.accepted_at = now()
        return invitation.workspace_id
    if name == "export_account":
        return {"account": {"id": identity.user_id, "email": db.get(User, identity.user_id).email}, "workspaces": [rpc(db, identity, settings, vectors, "export_workspace", {"p_workspace": w.id}) for w in db.scalars(select(Workspace).join(Member, Member.workspace_id == Workspace.id).where(Member.user_id == identity.user_id))]}
    if name == "worker_health":
        workspaces = list(db.scalars(select(Member.workspace_id).where(Member.user_id == identity.user_id)))
        return [s.data for s in db.scalars(select(State).where(State.kind == "worker", State.workspace_id.in_(workspaces)))][:20]
    if name in ("prepare_handoff", "confirm_handoff"):
        conversation = db.get(Conversation, a["p_conversation"])
        destination = db.get(Connection, a["p_destination"])
        if not conversation or not destination or conversation.project_id != a["p_project"] or conversation.workspace_id != destination.workspace_id:
            deny("Invalid source/destination")
        authorize(db, identity, conversation.workspace_id, "write", conversation.project_id)
        if destination.state == "revoked" or destination.expires_at <= now() or not permitted_conversation(db, Identity(connection=destination), conversation):
            deny("Destination lacks current source permissions")
        note = a.get("p_note", "").strip()
        if not 1 <= len(note) <= 4000:
            deny("Handoff note required", 422)
        package = {"project_id": conversation.project_id, "conversation_id": conversation.id, "destination_connection_id": destination.id, "note": note, "title": conversation.title, "messages": [serialize(m) for m in db.scalars(select(Message).where(Message.conversation_id == conversation.id))], "memories": [serialize(m) for m in db.scalars(select(Memory).where(Memory.workspace_id == conversation.workspace_id)) if permitted_memory(db, Identity(connection=destination), m)]}
        if name == "prepare_handoff":
            return package
        if package != a.get("p_reviewed"):
            deny("Handoff changed; preview again", 409)
        state = State(workspace_id=conversation.workspace_id, kind="handoff", data={"project_id": conversation.project_id, "conversation_id": conversation.id, "destination_connection_id": destination.id, "note": note, "target_provider": destination.provider})
        db.add(state)
        db.flush()
        audit(db, identity, state.workspace_id, "Handoff confirmed", "handoff", state.id)
        return state.id
    authorize(db, identity, workspace)
    if name == "search_memories":
        records = data_rows(db, identity, "memories", {"workspace_id": workspace})
        query = a.get("p_query", "").lower()
        records = [m for m in records if (a.get("p_status", "active") == "all" or m["status"] == a.get("p_status", "active")) and (not a.get("p_category") or m["category"] == a["p_category"]) and (not a.get("p_project") or (m["project_id"] or "global") == a["p_project"]) and (not query or query in m["content"].lower())]
        if a.get("p_platform"):
            ids = set(db.scalars(select(Source.memory_id).join(Conversation, Source.conversation_id == Conversation.id).where(Conversation.workspace_id == workspace, Conversation.platform == a["p_platform"])))
            records = [m for m in records if m["id"] in ids]
        offset = max(0, int(a.get("p_offset", 0)))
        return {"total": len(records), "items": sorted(records, key=lambda m: m["updated_at"], reverse=True)[offset:offset + 15]}
    if name == "memory_platforms":
        return sorted(set(db.scalars(select(Conversation.platform).where(Conversation.workspace_id == workspace))))
    if name == "workspace_usage":
        rows = {table: data_rows(db, identity, table, {"workspace_id": workspace}) for table in ("memories", "conversations", "projects", "agent_connections", "sync_jobs")}
        events = list(db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace, AuditEvent.entity_type == "retrieval")))
        from datetime import datetime, timezone, timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        messages = list(db.scalars(select(Message).where(Message.workspace_id == workspace)))
        succeeded = [j["updated_at"] for j in rows["sync_jobs"] if j["kind"] == "import" and j["status"] == "succeeded"]
        return {"plan": "selfhosted", "billing_status": "selfhosted", "limits": {}, "memories": len(rows["memories"]), "pending": sum(m["status"] == "pending" for m in rows["memories"]), "conversations": len(rows["conversations"]), "projects": len(rows["projects"]), "connections": len(rows["agent_connections"]), "verified_agents": sum(c["state"] == "verified" for c in rows["agent_connections"]), "jobs": len(rows["sync_jobs"]), "requests_30d": sum(event.created_at >= cutoff for event in events), "stored_text_bytes": sum(len(m["content"].encode()) for m in rows["memories"]) + sum(len(m.content.encode()) for m in messages), "last_successful_sync": max(succeeded) if succeeded else None}
    if name == "list_members":
        return [{"user_id": m.user_id, "role": m.role, "email": db.get(User, m.user_id).email} for m in db.scalars(select(Member).where(Member.workspace_id == workspace))]
    if name == "export_workspace":
        return {"workspace": serialize(db.get(Workspace, workspace)), **{table: data_rows(db, identity, table, {"workspace_id": workspace}) for table in TABLES if table != "workspaces"}}
    authorize(db, identity, workspace, "owner")
    if name in ("configure_semantic", "reindex_semantic"):
        w = db.get(Workspace, workspace)
        enabled = a.get("p_enabled", True)
        if name == "configure_semantic":
            w.preferences = {**w.preferences, "semantic_enabled": enabled}
        elif not w.preferences.get("semantic_enabled"):
            deny("Semantic processing consent required")
        memories = list(db.scalars(select(Memory).where(Memory.workspace_id == workspace)))
        if vectors:
            vectors.delete([m.id for m in memories]) if memories else None
        count = 0
        for memory in memories:
            if enabled and permitted_memory(db, identity, memory):
                job = enqueue(db, workspace, memory.project_id, "embedding", {"memory_id": memory.id, "version": memory.version}, f"{memory.id}:{memory.version}")
                job.status, job.lease_id, job.lease_until, job.attempts, job.available_at = "queued", None, None, 0, now()
                count += 1
        if not enabled:
            for job in db.scalars(select(Job).where(Job.workspace_id == workspace, Job.kind == "embedding", Job.status.in_(["queued", "running"]))):
                job.status, job.lease_id = "paused", None
        return count
    if name == "invite_member":
        role, email = a["p_role"], a["p_email"].lower().strip()
        if role not in ("viewer", "editor") or "@" not in email:
            deny("Invalid invitation", 422)
        token = secrets.token_urlsafe(32)
        row = Invitation(workspace_id=workspace, email=email, role=role, token_hash=digest(token), expires_at=later(days=7))
        db.add(row)
        db.flush()
        return {"id": row.id, "token": token, "delivery": "manual_link"}
    if name == "manage_member":
        action, identifier = a["p_action"], a["p_id"]
        if action == "revoke_invite":
            invitation = db.get(Invitation, identifier)
            if not invitation or invitation.workspace_id != workspace:
                deny()
            invitation.revoked_at = now()
            return
        member = db.get(Member, (workspace, identifier))
        if not member or identifier == identity.user_id:
            deny("Invalid membership action")
        if action == "remove":
            db.delete(member)
        elif action == "role" and a.get("p_role") in ("viewer", "editor"):
            member.role = a["p_role"]
        elif action == "transfer":
            db.get(Member, (workspace, identity.user_id)).role = "editor"
            member.role = "owner"
            db.get(Workspace, workspace).owner_id = identifier
            for c in db.scalars(select(Connection).where(Connection.workspace_id == workspace)):
                c.state = "revoked"
        else:
            deny("Invalid membership action")
        audit(db, identity, workspace, "Membership changed", "membership", identifier)
        return
    if name == "prune_operational_history":
        from datetime import datetime, timezone, timedelta
        before = datetime.fromisoformat(a["p_before"].replace("Z", "+00:00"))
        if before > datetime.now(timezone.utc) - timedelta(days=30):
            deny("Retain at least 30 days", 422)
        for job in db.scalars(select(Job).where(Job.workspace_id == workspace, Job.status.in_(["failed", "succeeded"]), Job.updated_at < before.isoformat())):
            db.delete(job)
        return
    deny("Operation unavailable in self-hosted mode", 404)
