import uuid
from datetime import datetime, timezone
from sqlalchemy import create_engine, event, String, Text, Integer, ForeignKey, UniqueConstraint, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String, default=now)


class SessionToken(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    refresh_hash: Mapped[str] = mapped_column(String, unique=True)
    expires_at: Mapped[str] = mapped_column(String)
    revoked: Mapped[bool] = mapped_column(default=False)


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Member(Base):
    __tablename__ = "workspace_members"
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String, default="viewer")


class Scoped:
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Project(Scoped, Base):
    __tablename__ = "projects"
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="active")
    compaction_excluded: Mapped[bool] = mapped_column(default=False)


class Conversation(Scoped, Base):
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("workspace_id", "scope_hash"),)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String)
    platform: Mapped[str] = mapped_column(String)
    scope_hash: Mapped[str] = mapped_column(String)
    message_count: Mapped[int] = mapped_column(Integer)
    processing_status: Mapped[str] = mapped_column(String, default="review")
    excluded: Mapped[bool] = mapped_column(default=False)
    compaction_excluded: Mapped[bool] = mapped_column(default=False)
    source_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    summary: Mapped[str | None] = mapped_column(Text)
    compacted_at: Mapped[str | None] = mapped_column(String)


class Message(Scoped, Base):
    __tablename__ = "messages"
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    source_metadata: Mapped[dict] = mapped_column(JSON, default=dict)


class Memory(Scoped, Base):
    __tablename__ = "memories"
    __table_args__ = (UniqueConstraint("workspace_id", "content_hash", "scope"),)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"))
    scope: Mapped[str] = mapped_column(String, default="global")
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String, default="Facts")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    confidence: Mapped[float] = mapped_column(default=0.8)
    importance: Mapped[float] = mapped_column(default=0.5)
    sensitivity: Mapped[str] = mapped_column(String, default="normal")
    status: Mapped[str] = mapped_column(String, default="pending", index=True)
    reason: Mapped[str] = mapped_column(Text, default="Direct statement; heuristic extraction; human review required.")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class Source(Scoped, Base):
    __tablename__ = "memory_sources"
    memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[str | None] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    message_id: Mapped[str | None] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"))
    file_id: Mapped[str | None] = mapped_column(ForeignKey("project_files.id", ondelete="CASCADE"))
    evidence: Mapped[str] = mapped_column(Text)
    source_reference: Mapped[str | None] = mapped_column(Text)


class MemoryVersion(Scoped, Base):
    __tablename__ = "memory_versions"
    memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer)


class Connection(Scoped, Base):
    __tablename__ = "agent_connections"
    name: Mapped[str] = mapped_column(String)
    provider: Mapped[str] = mapped_column(String, default="other")
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)
    expires_at: Mapped[str] = mapped_column(String)
    state: Mapped[str] = mapped_column(String, default="pending")
    verified_at: Mapped[str | None] = mapped_column(String)
    last_activity_at: Mapped[str | None] = mapped_column(String)
    last_sync_at: Mapped[str | None] = mapped_column(String)
    last_error: Mapped[str | None] = mapped_column(String)


class Job(Scoped, Base):
    __tablename__ = "sync_jobs"
    __table_args__ = (UniqueConstraint("workspace_id", "kind", "idempotency_key"),)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON)
    idempotency_key: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    available_at: Mapped[str] = mapped_column(String, default=now)
    lease_id: Mapped[str | None] = mapped_column(String)
    lease_until: Mapped[str | None] = mapped_column(String)
    last_error: Mapped[str | None] = mapped_column(Text)
    result: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class ProjectFile(Scoped, Base):
    __tablename__ = "project_files"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String)
    digest: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    media_type: Mapped[str] = mapped_column(String)


class FileChunk(Scoped, Base):
    __tablename__ = "file_chunks"
    file_id: Mapped[str] = mapped_column(ForeignKey("project_files.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)


class AuditEvent(Scoped, Base):
    __tablename__ = "audit_logs"
    actor_id: Mapped[str | None] = mapped_column(String)
    event: Mapped[str] = mapped_column(String)
    entity_type: Mapped[str] = mapped_column(String)
    entity_id: Mapped[str | None] = mapped_column(String)


class State(Scoped, Base):
    __tablename__ = "workspace_state"
    kind: Mapped[str] = mapped_column(String)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class Invitation(Scoped, Base):
    __tablename__ = "workspace_invitations"
    email: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    expires_at: Mapped[str] = mapped_column(String)
    accepted_at: Mapped[str | None] = mapped_column(String)
    revoked_at: Mapped[str | None] = mapped_column(String)


def database(settings):
    engine = create_engine(f"sqlite:///{settings.data_dir / 'sqlite' / 'continuum.db'}", connect_args={"check_same_thread": False})
    @event.listens_for(engine, "connect")
    def configure(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
    return engine, sessionmaker(engine, expire_on_commit=False)


def serialize(record):
    value = {column.name: getattr(record, column.name) for column in record.__table__.columns if column.name not in ("token_hash", "password_hash", "refresh_hash", "lease_id", "lease_until", "scope_hash")}
    if isinstance(record, Connection):
        value.update(value.pop("permissions"))
        value["method"] = "scoped-token"
    return value
