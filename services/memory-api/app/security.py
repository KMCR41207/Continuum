import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import jwt
from pwdlib import PasswordHash
from fastapi import HTTPException
from sqlalchemy import select
from .database import User, SessionToken, Connection, Member, Project, now

passwords = PasswordHash.recommended()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def deny(message="Access denied", status=403):
    raise HTTPException(status, message)


def later(days=0, minutes=0):
    return (datetime.now(timezone.utc) + timedelta(days=days, minutes=minutes)).isoformat()


@dataclass
class Identity:
    user_id: str | None = None
    connection: Connection | None = None


def authenticate(db, settings, token):
    if not token:
        deny("Authentication required", 401)
    if token.startswith("ctm_"):
        connection = db.scalar(select(Connection).where(Connection.token_hash == digest(token)))
        if not connection or connection.state == "revoked" or connection.expires_at <= now():
            deny("Invalid or expired credential", 401)
        connection.last_activity_at = now()
        connection.verified_at = now()
        connection.state = "verified"
        return Identity(connection=connection)
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], audience="continuum", issuer="continuum-local")
        session = db.get(SessionToken, payload["sid"])
        if not session or session.revoked or session.expires_at <= now() or session.user_id != payload["sub"]:
            raise ValueError()
        if not db.get(User, payload["sub"]):
            raise ValueError()
        return Identity(user_id=payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        deny("Session expired or revoked", 401)


def authorize(db, identity, workspace, action="read", project=None):
    if identity.connection:
        c = identity.connection
        permissions = c.permissions
        required = {"read": "retrieval", "write": "writing", "capture": "capture", "history": "retrieval", "files_read": "files_read", "files_write": "files_write"}.get(action)
        if c.workspace_id != workspace or not required or not permissions.get(required):
            deny()
        if action == "capture" and permissions.get("capture_paused"):
            deny("Capture is paused")
        if project is None and not permissions.get("global_access"):
            deny("Global scope not granted")
        if project is not None and project not in permissions.get("project_ids", []):
            deny("Project scope not granted")
    else:
        member = db.get(Member, (workspace, identity.user_id))
        if not member or (action != "read" and member.role == "viewer") or (action == "owner" and member.role != "owner"):
            deny()
    if project:
        p = db.get(Project, project)
        if not p or p.workspace_id != workspace:
            deny("Project not found", 404)


def issue_session(db, settings, user):
    refresh = secrets.token_urlsafe(48)
    session = SessionToken(user_id=user.id, refresh_hash=digest(refresh), expires_at=later(days=7))
    db.add(session)
    db.flush()
    exp = datetime.now(timezone.utc) + timedelta(minutes=15)
    token = jwt.encode({"sub": user.id, "sid": session.id, "aud": "continuum", "iss": "continuum-local", "exp": exp}, settings.jwt_secret, algorithm="HS256")
    return {"access_token": token, "refresh_token": refresh, "expires_at": int(exp.timestamp()), "expires_in": 900, "token_type": "bearer", "user": {"id": user.id, "email": user.email, "user_metadata": {"full_name": user.full_name}}}
