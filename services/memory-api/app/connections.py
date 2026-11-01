import secrets
from sqlalchemy import select
from .database import Connection, Conversation, Project, serialize, now
from .security import authorize, digest, later, deny
from .engine import audit

FLAGS = {"capture", "retrieval", "writing", "global_access", "all_history", "capture_paused", "files_read", "files_write"}


def configure(db, identity, workspace, identifier, name, provider, permissions, rotate=False, revoke=False, days=30):
    authorize(db, identity, workspace, "owner")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        deny("Connection name required", 422)
    if not isinstance(permissions, dict) or set(permissions) - FLAGS - {"project_ids", "conversation_ids"}:
        deny("Unknown permission", 422)
    p = {flag: permissions.get(flag, False) for flag in FLAGS}
    if any(not isinstance(value, bool) for value in p.values()):
        deny("Permissions must be boolean", 422)
    for key, model in (("project_ids", Project), ("conversation_ids", Conversation)):
        values = permissions.get(key, [])
        if not isinstance(values, list) or len(values) > 1000:
            deny("Invalid allowlist", 422)
        for value in values:
            row = db.get(model, value)
            if not row or row.workspace_id != workspace:
                deny("Allowlist outside workspace")
        p[key] = values
    connection = db.get(Connection, identifier) if identifier else None
    if identifier and (not connection or connection.workspace_id != workspace):
        deny("Connection not found", 404)
    token = None
    if connection is None:
        token = "ctm_" + secrets.token_hex(32)
        connection = Connection(workspace_id=workspace, name=name.strip(), provider=provider, token_hash=digest(token), permissions=p, expires_at=later(days=days))
        db.add(connection)
    else:
        connection.name, connection.provider, connection.permissions = name.strip(), provider, p
        if rotate:
            token = "ctm_" + secrets.token_hex(32)
            connection.token_hash, connection.expires_at, connection.state = digest(token), later(days=days), "pending"
        if revoke:
            connection.state = "revoked"
    db.flush()
    audit(db, identity, workspace, "Connection revoked" if revoke else "Connection configured", "connection", connection.id)
    return {"id": connection.id, "token": token, "connection": serialize(connection)}
