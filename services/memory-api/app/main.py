from collections import defaultdict, deque
from contextlib import asynccontextmanager
import json
import secrets
import time
from fastapi import FastAPI, Request, HTTPException, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from pydantic import ValidationError
from .config import Settings
from .database import *
from .security import authenticate, authorize, deny, passwords, issue_session, digest, Identity, now
from .schemas import Login, ImportRequest, Query, ConnectionInput, MemoryPatch
from .connections import configure
from .engine import ingest, query_memories, change_memory, permitted_memory, permitted_conversation, delete_conversation
from . import dashboard
from .migrate import upgrade


def create_app(settings=None, vector_store=None):
    settings = (settings or Settings()).prepare()
    engine, sessions = database(settings)
    upgrade(engine)
    vectors, vector_error = vector_store, False
    if vectors is None:
        try:
            from .embeddings import Embeddings, Vectors
            vectors = Vectors(settings, Embeddings(settings))
        except Exception:
            vector_error = True
    app = FastAPI(title="Continuum local memory", version="0.1.0")
    app.state.sessions, app.state.settings, app.state.vectors = sessions, settings, vectors
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins.split(","), allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"], allow_credentials=False)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts.split(","))
    buckets = defaultdict(deque)

    @app.middleware("http")
    async def limits(request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in settings.allowed_origins.split(",") and not origin.startswith(("chrome-extension://", "moz-extension://")):
            return json_response(403, "Origin denied")
        ip = (request.client.host if request.client else "unknown") + (":auth" if "/auth/" in request.url.path else ":api")
        current = time.monotonic()
        if len(buckets) > 10000:
            for key in list(buckets):
                if not buckets[key] or buckets[key][-1] < current - 60:
                    del buckets[key]
        bucket = buckets[ip]
        while bucket and bucket[0] < current - 60:
            bucket.popleft()
        if len(bucket) >= (30 if "/auth/" in request.url.path else 240):
            return json_response(429, "Rate limit; retry in 60 seconds")
        bucket.append(current)
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > settings.max_file_bytes + 100000:
            return json_response(413, "Request too large")
        # Stream cap also covers chunked bodies without trusting Content-Length.
        size = 0
        original_receive = request._receive
        async def bounded_receive():
            nonlocal size
            message = await original_receive()
            size += len(message.get("body", b""))
            if size > settings.max_file_bytes + 100000:
                raise HTTPException(413, "Request too large")
            return message
        request._receive = bounded_receive
        response = await call_next(request)
        response.headers.update({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        return response

    @app.exception_handler(IntegrityError)
    async def conflict(_request, _error):
        return json_response(409, "Record conflicts with existing data or linked records")

    @app.exception_handler(ValidationError)
    async def invalid(_request, _error):
        return json_response(422, "Invalid fields; check the requested format")

    def db_session():
        with sessions() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    def identity(request: Request, db=Depends(db_session)):
        return authenticate(db, settings, request.headers.get("authorization", "").removeprefix("Bearer "))

    @app.get("/health")
    def health(db=Depends(db_session)):
        db.execute(text("SELECT 1"))
        vector_ok = False
        try:
            vector_ok = bool(vectors and vectors.health())
        except Exception:
            pass
        return {"service": "continuum-memory", "database": "available", "vectors": "available" if vector_ok else "unavailable", "embedding_provider": settings.embedding_provider, "processing": "remote-opt-in" if settings.allow_remote_processing else "local"}

    @app.get("/api/v1/auth/status")
    def auth_status(db=Depends(db_session)):
        return {"setup_required": db.scalar(select(User.id).limit(1)) is None, "authentication": "local", "email_delivery": False}

    @app.post("/api/v1/auth/setup")
    def setup(body: Login, request: Request, db=Depends(db_session)):
        # First-owner setup only, from the local machine. Network installs use the CLI.
        if request.client.host not in ("127.0.0.1", "::1", "testclient"):
            deny("Run local administrator setup first")
        db.execute(text("BEGIN IMMEDIATE"))
        if db.scalar(select(User.id).limit(1)):
            deny("Administrator already configured", 409)
        if "@" not in body.email:
            deny("Valid email required", 422)
        user = User(email=body.email.strip().lower(), password_hash=passwords.hash(body.password), full_name=body.name)
        db.add(user)
        db.flush()
        workspace = Workspace(owner_id=user.id, name="My workspace")
        db.add(workspace)
        db.flush()
        db.add(Member(workspace_id=workspace.id, user_id=user.id, role="owner"))
        return issue_session(db, settings, user)

    @app.post("/api/v1/auth/login")
    def login(body: Login, db=Depends(db_session)):
        user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
        if not user or not passwords.verify(body.password, user.password_hash):
            deny("Incorrect email or password", 401)
        return issue_session(db, settings, user)

    @app.post("/api/v1/auth/refresh")
    def refresh(body: dict, db=Depends(db_session)):
        db.execute(text("BEGIN IMMEDIATE"))
        session = db.scalar(select(SessionToken).where(SessionToken.refresh_hash == digest(str(body.get("refresh_token", "")))))
        if not session or session.revoked or session.expires_at <= now():
            deny("Refresh token expired or revoked", 401)
        session.revoked = True
        return issue_session(db, settings, db.get(User, session.user_id))

    @app.get("/api/v1/auth/user")
    def user_info(who=Depends(identity), db=Depends(db_session)):
        if not who.user_id:
            deny()
        user = db.get(User, who.user_id)
        return {"id": user.id, "email": user.email, "user_metadata": {"full_name": user.full_name}}

    @app.post("/api/v1/auth/logout")
    def logout(body: dict, who=Depends(identity), db=Depends(db_session)):
        if not who.user_id:
            deny()
        for session in db.scalars(select(SessionToken).where(SessionToken.user_id == who.user_id)):
            if body.get("global") or session.refresh_hash == digest(str(body.get("refresh_token", ""))):
                session.revoked = True
        return {"signed_out": True}

    @app.patch("/api/v1/auth/user")
    def update_user(body: dict, who=Depends(identity), db=Depends(db_session)):
        user = db.get(User, who.user_id)
        if not user or (("password" in body or "email" in body) and not passwords.verify(str(body.get("current_password", "")), user.password_hash)):
            deny("Current password required", 401)
        if "password" in body:
            if not 12 <= len(body["password"]) <= 128:
                deny("Password must have 12–128 characters", 422)
            user.password_hash = passwords.hash(body["password"])
        if "email" in body:
            deny("Local email changes require administrator verification")
        if "data" in body:
            user.full_name = str(body["data"].get("full_name", ""))[:100]
        return {"updated": True}

    @app.post("/api/v1/conversations/import")
    def import_conversation(body: ImportRequest, who=Depends(identity), db=Depends(db_session)):
        db.execute(text("BEGIN IMMEDIATE"))
        return ingest(db, who, body.workspace_id, body.project_id, body.conversation.model_dump())

    @app.post("/api/v1/memory/ingest")
    def ingest_memory(body: dict, who=Depends(identity), db=Depends(db_session)):
        from .agent import agent_call
        if body.get("content_type") == "memory":
            if who.connection:
                return agent_call(db, who, settings, vectors, "save_fact", {"fact_text": body.get("content"), "tags": body.get("tags", []), "project_id": body.get("project_id"), "source_reference": body.get("source")})
            from .engine import propose, audit
            authorize(db, who, body.get("workspace_id"), "write", body.get("project_id"))
            memory = propose(db, body["workspace_id"], body.get("project_id"), body.get("content", ""), tags=body.get("tags", []))
            db.add(Source(workspace_id=memory.workspace_id, memory_id=memory.id, evidence=memory.content, source_reference=json.dumps(body.get("source", {}))))
            audit(db, who, memory.workspace_id, "Memory proposed", "memory", memory.id)
            return serialize(memory)
        source = body.get("source") or {}
        raw = body.get("conversation") or {"title": source.get("title", "Captured conversation"), "platform": source.get("provider", "manual"), "messages": [{"role": "user", "content": body.get("content", "")}], "metadata": source}
        workspace = who.connection.workspace_id if who.connection else body.get("workspace_id")
        return ingest(db, who, workspace, body.get("project_id"), raw)

    @app.post("/api/v1/memory/query")
    def query(body: Query, who=Depends(identity), db=Depends(db_session)):
        return query_memories(db, who, body, vectors)

    @app.post("/api/v1/agent/{operation}")
    def agent(operation: str, body: dict, who=Depends(identity), db=Depends(db_session)):
        from .agent import agent_call
        return agent_call(db, who, settings, vectors, operation, body)

    @app.get("/api/v1/data/{table}")
    def table_rows(table: str, filters: str = "{}", who=Depends(identity), db=Depends(db_session)):
        return dashboard.data_rows(db, who, table, json.loads(filters))

    @app.post("/api/v1/data/{table}")
    def table_mutation(table: str, body: dict, who=Depends(identity), db=Depends(db_session)):
        db.execute(text("BEGIN IMMEDIATE"))
        return dashboard.mutate_data(db, who, table, body)

    @app.post("/api/v1/rpc/{name}")
    def rpc(name: str, body: dict, who=Depends(identity), db=Depends(db_session)):
        db.execute(text("BEGIN IMMEDIATE"))
        return dashboard.rpc(db, who, settings, vectors, name, body)

    @app.post("/api/v1/connections")
    def create_connection(body: ConnectionInput, who=Depends(identity), db=Depends(db_session)):
        return configure(db, who, body.workspace_id, None, body.name, body.provider, body.permissions, days=body.expires_days)

    @app.patch("/api/v1/connections/{identifier}")
    def update_connection(identifier: str, body: dict, who=Depends(identity), db=Depends(db_session)):
        row = db.get(Connection, identifier)
        if not row:
            deny("Connection not found", 404)
        return configure(db, who, row.workspace_id, row.id, body.get("name", row.name), body.get("provider", row.provider), body.get("permissions", row.permissions))

    @app.post("/api/v1/connections/{identifier}/rotate")
    def rotate(identifier: str, who=Depends(identity), db=Depends(db_session)):
        row = db.get(Connection, identifier)
        if not row:
            deny("Connection not found", 404)
        return configure(db, who, row.workspace_id, row.id, row.name, row.provider, row.permissions, rotate=True)

    @app.delete("/api/v1/connections/{identifier}")
    def revoke(identifier: str, who=Depends(identity), db=Depends(db_session)):
        row = db.get(Connection, identifier)
        if not row:
            deny("Connection not found", 404)
        return configure(db, who, row.workspace_id, row.id, row.name, row.provider, row.permissions, revoke=True)

    @app.patch("/api/v1/memories/{identifier}")
    def patch_memory(identifier: str, body: MemoryPatch, who=Depends(identity), db=Depends(db_session)):
        memory = db.get(Memory, identifier)
        if not memory:
            deny("Memory not found", 404)
        return change_memory(db, who, memory, body.model_dump(exclude_none=True))

    @app.post("/api/v1/memories/{identifier}/{action}")
    def memory_action(identifier: str, action: str, body: dict, who=Depends(identity), db=Depends(db_session)):
        if action not in ("approve", "archive", "reject", "restore"):
            deny("Unknown action", 404)
        memory = db.get(Memory, identifier)
        if not memory or who.connection:
            deny("Workspace editor required")
        return change_memory(db, who, memory, {"version": body.get("version"), "status": {"approve": "active", "archive": "archived", "reject": "rejected", "restore": "pending"}[action]})

    @app.post("/api/v1/projects")
    def create_project(body: dict, who=Depends(identity), db=Depends(db_session)):
        return dashboard.mutate_data(db, who, "projects", {"action": "insert", "values": body})[0]

    @app.patch("/api/v1/projects/{identifier}")
    def patch_project(identifier: str, body: dict, who=Depends(identity), db=Depends(db_session)):
        result = dashboard.mutate_data(db, who, "projects", {"action": "update", "values": body, "filters": {"id": identifier}})
        if not result:
            deny("Project not found", 404)
        return result[0]

    @app.post("/api/v1/files/upload")
    async def upload_file(workspace_id: str = Form(...), project_id: str = Form(...), file: UploadFile = File(...), who=Depends(identity), db=Depends(db_session)):
        from .files import upload
        content = await file.read(settings.max_file_bytes + 1)
        return upload(db, who, settings, workspace_id, project_id, file.filename, content, file.content_type)

    def get_record(table, identifier, who, db):
        if table == "agent_connections" and who.connection:
            deny("Only workspace members may inspect connection records")
        model = dashboard.TABLES[table]
        row = db.get(model, identifier)
        if not row:
            deny("Record not found", 404)
        authorize(db, who, row.workspace_id, "files_read" if table == "project_files" else "read", row.id if table == "projects" else getattr(row, "project_id", None))
        if who.connection:
            if isinstance(row, Memory) and not permitted_memory(db, who, row):
                deny("Memory unavailable", 404)
            if isinstance(row, Conversation) and not permitted_conversation(db, who, row):
                deny("History access required")
        return row

    def register_resource(path, table):
        @app.get(f"/api/v1/{path}", name="list_" + path)
        def listing(workspace_id: str | None = None, project_id: str | None = None, who=Depends(identity), db=Depends(db_session)):
            workspace = who.connection.workspace_id if who.connection else workspace_id
            if who.connection:
                result = []
                for row in db.scalars(select(dashboard.TABLES[table]).where(dashboard.TABLES[table].workspace_id == workspace)):
                    try:
                        get_record(table, row.id, who, db)
                        if not project_id or getattr(row, "project_id", None) == project_id:
                            result.append(serialize(row))
                    except HTTPException:
                        continue
                return result[:1000]
            return dashboard.data_rows(db, who, table, {**({"workspace_id": workspace} if workspace else {}), **({"project_id": project_id} if project_id else {})})[:1000]

        @app.get(f"/api/v1/{path}/{{identifier}}", name="get_" + path)
        def get_one(identifier: str, who=Depends(identity), db=Depends(db_session)):
            row = get_record(table, identifier, who, db)
            value = serialize(row)
            if table == "conversations":
                value["messages"] = [serialize(m) for m in db.scalars(select(Message).where(Message.conversation_id == row.id).order_by(Message.position))]
            if table == "project_files":
                value["chunks"] = [serialize(m) for m in db.scalars(select(FileChunk).where(FileChunk.file_id == row.id))]
            if table == "memories":
                value["sources"] = [serialize(m) for m in db.scalars(select(Source).where(Source.memory_id == row.id))]
            return value

        @app.delete(f"/api/v1/{path}/{{identifier}}", name="delete_" + path)
        def delete_one(identifier: str, who=Depends(identity), db=Depends(db_session)):
            row = get_record(table, identifier, who, db)
            if who.connection:
                deny("Member session required for deletion")
            authorize(db, who, row.workspace_id, "write", getattr(row, "project_id", None))
            if table == "agent_connections":
                authorize(db, who, row.workspace_id, "owner")
            if table == "conversations":
                delete_conversation(db, who, row)
            elif table == "project_files":
                for source in db.scalars(select(Source).where(Source.file_id == row.id)):
                    memory = db.get(Memory, source.memory_id)
                    if memory:
                        db.delete(memory)
                db.flush()
                db.delete(row)
                # Commit before disk removal; an orphan after a crash can be pruned safely.
                db.commit()
                (settings.data_dir / "uploads" / identifier).unlink(missing_ok=True)
            else:
                db.delete(row)
            return {"deleted": True}

    for path, table in (("memories", "memories"), ("projects", "projects"), ("conversations", "conversations"), ("files", "project_files"), ("connections", "agent_connections")):
        register_resource(path, table)

    @app.get("/api/config")
    def config():
        return {"billing": False, "accountDeletion": True, "semantic": True, "embeddingModel": settings.embedding_model, "embeddingEndpoint": settings.embedding_provider, "mode": "selfhosted"}

    @app.post("/api/account/delete")
    def delete_account(body: dict, who=Depends(identity), db=Depends(db_session)):
        user = db.get(User, who.user_id)
        if not user or body.get("confirmation") != "DELETE CONTINUUM ACCOUNT" or not passwords.verify(str(body.get("password", "")), user.password_hash):
            deny("Confirmation and current password required")
        for w in db.scalars(select(Workspace).where(Workspace.owner_id == user.id)):
            if db.scalar(select(Member).where(Member.workspace_id == w.id, Member.user_id != user.id)):
                deny("Transfer shared workspace ownership first")
            files = list(db.scalars(select(ProjectFile).where(ProjectFile.workspace_id == w.id)))
            for f in files:
                (settings.data_dir / "uploads" / f.id).unlink(missing_ok=True)
            db.delete(w)
        db.flush()
        db.delete(user)
        return {"deleted": True}

    return app


def json_response(status, message):
    from fastapi.responses import JSONResponse
    return JSONResponse({"detail": message}, status_code=status)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(), host="127.0.0.1", port=8000)
