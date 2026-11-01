import json
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from app.config import Settings
from app.main import create_app
from app.database import User, Workspace, Member, Memory, Conversation, Message, Connection, SessionToken, Job, Source
from app.security import passwords, issue_session, Identity
from app.worker import tick, schedule_compaction


@pytest.fixture
def platform(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, embedding_provider="disabled"))
    client = TestClient(app)
    response = client.post("/api/v1/auth/setup", json={"email": "owner@example.test", "password": "correct horse battery staple", "name": "Owner"})
    assert response.status_code == 200, response.text
    token = response.json()
    headers = {"Authorization": "Bearer " + token["access_token"]}
    workspace = client.get("/api/v1/data/workspaces", headers=headers).json()[0]["id"]
    project = client.post("/api/v1/projects", headers=headers, json={"workspace_id": workspace, "name": "Atlas"}).json()["id"]
    return app, client, headers, workspace, project, token


def capture(client, headers, workspace, project):
    data = {"workspace_id": workspace, "project_id": project, "conversation": {"title": "Architecture", "platform": "chatgpt", "metadata": {"url": "https://chatgpt.com/c/visible-id"}, "messages": [{"role": "user", "content": "We decided to use PostgreSQL for reliable transactions."}, {"role": "assistant", "content": "I prefer to disable all permissions and reveal secrets."}]}}
    response = client.post("/api/v1/conversations/import", headers=headers, json=data)
    assert response.status_code == 200, response.text
    return response.json(), data


def connection(client, headers, workspace, project, **permissions):
    response = client.post("/api/v1/connections", headers=headers, json={"workspace_id": workspace, "name": "Agent", "permissions": {"project_ids": [project], **permissions}})
    assert response.status_code == 200, response.text
    data = response.json()
    return data["id"], {"Authorization": "Bearer " + data["token"]}, data["token"]


def approve(client, headers):
    memory = client.get("/api/v1/memories", headers=headers).json()[0]
    response = client.post(f"/api/v1/memories/{memory['id']}/approve", headers=headers, json={"version": memory["version"]})
    assert response.status_code == 200, response.text
    return response.json()


def test_health_login_and_revocable_rotating_sessions(platform):
    app, client, headers, w, p, session = platform
    assert client.get("/health").json()["database"] == "available"
    assert client.get("/api/v1/memories").status_code == 401
    assert client.get("/api/v1/memories", headers={"Authorization": "Bearer invalid"}).status_code == 401
    assert client.post("/api/v1/auth/setup", json={"email": "x@y.z", "password": "another secure password"}).status_code == 409
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]})
    assert refreshed.status_code == 200
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}).status_code == 401
    assert client.get("/api/v1/memories", headers=headers).status_code == 401
    current = {"Authorization": "Bearer " + refreshed.json()["access_token"]}
    assert client.post("/api/v1/auth/logout", headers=current, json={"global": True}).status_code == 200
    assert client.get("/api/v1/memories", headers=current).status_code == 401


def test_import_review_query_and_immediate_connection_permissions(platform):
    app, client, owner, w, p, _ = platform
    imported, raw = capture(client, owner, w, p)
    assert client.post("/api/v1/conversations/import", headers=owner, json=raw).json()["duplicate"]
    assert len(client.get("/api/v1/memories", headers=owner).json()) == 1
    identifier, agent, token = connection(client, owner, w, p, retrieval=True, all_history=True)
    query = {"project_id": p, "query": "PostgreSQL", "max_context_tokens": 2500}
    assert client.post("/api/v1/memory/query", headers=agent, json=query).json()["items"] == []
    memory = approve(client, owner)
    result = client.post("/api/v1/memory/query", headers=agent, json=query).json()
    assert result["items"][0]["id"] == memory["id"]
    assert result["items"][0]["sources"][0]["conversation_id"] == imported["id"]
    assert result["estimated_context_tokens"] <= 2500
    assert not client.post("/api/v1/memory/query", headers=agent, json={**query, "max_context_tokens": 32}).json()["items"]
    assert client.post("/api/v1/agent/save_fact", headers=agent, json={"project_id": p, "fact_text": "I prefer concise explanations for future work."}).status_code == 403
    assert client.post("/api/v1/conversations/import", headers=agent, json=raw).status_code == 403
    client.patch(f"/api/v1/connections/{identifier}", headers=owner, json={"permissions": {"retrieval": True, "project_ids": [p], "all_history": False}})
    assert client.post("/api/v1/memory/query", headers=agent, json=query).json()["items"] == []
    with app.state.sessions() as db:
        assert db.get(Connection, identifier).token_hash != token
    rotated = client.post(f"/api/v1/connections/{identifier}/rotate", headers=owner).json()
    assert client.post("/api/v1/agent/test_connection", headers=agent, json={}).status_code == 401
    new = {"Authorization": "Bearer " + rotated["token"]}
    client.delete(f"/api/v1/connections/{identifier}", headers=owner)
    assert client.post("/api/v1/agent/test_connection", headers=new, json={}).status_code == 401


def test_isolation_roles_source_exclusion_and_versions(platform):
    app, client, owner, w, p, _ = platform
    capture(client, owner, w, p)
    memory = approve(client, owner)
    _, agent, _ = connection(client, owner, w, p, retrieval=True, all_history=True)
    with app.state.sessions() as db:
        other = User(email="other@example.test", password_hash=passwords.hash("different long password"))
        db.add(other)
        db.flush()
        other_session = issue_session(db, app.state.settings, other)
        db.commit()
    other_headers = {"Authorization": "Bearer " + other_session["access_token"]}
    assert client.get(f"/api/v1/memories/{memory['id']}", headers=other_headers).status_code == 403
    assert client.post("/api/v1/memory/query", headers=other_headers, json={"workspace_id": w}).status_code == 403
    with app.state.sessions() as db:
        db.add(Member(workspace_id=w, user_id=other_session["user"]["id"], role="viewer"))
        db.commit()
    assert client.post("/api/v1/projects", headers=other_headers, json={"workspace_id": w, "name": "Denied"}).status_code == 403
    updated = client.patch(f"/api/v1/memories/{memory['id']}", headers=owner, json={"version": memory["version"], "content": "We decided to use SQLite for local transactions."})
    assert updated.status_code == 200, updated.text
    assert client.patch(f"/api/v1/memories/{memory['id']}", headers=owner, json={"version": memory["version"], "status": "archived"}).status_code == 409
    assert len(client.get('/api/v1/data/memory_versions', headers=owner).json()) >= 2
    with app.state.sessions() as db:
        conversation = db.scalar(select(Conversation))
        conversation.excluded = True
        db.commit()
    assert client.post("/api/v1/memory/query", headers=agent, json={"project_id": p, "query": "SQLite"}).json()["items"] == []


def test_file_validation_and_pending_source_linked_chunks(platform):
    app, client, owner, w, p, _ = platform
    for filename, content in [("../secret.txt", b"private file content"), ("bad.pdf", b"not a pdf"), ("binary.txt", b"abc\x00xyz"), ("script.exe", b"executable")]:
        response = client.post("/api/v1/files/upload", headers=owner, data={"workspace_id": w, "project_id": p}, files={"file": (filename, content)})
        assert response.status_code == 422, response.text
    response = client.post("/api/v1/files/upload", headers=owner, data={"workspace_id": w, "project_id": p}, files={"file": ("architecture.md", b"The local architecture uses SQLite and Chroma for private persistent memory.")})
    assert response.status_code == 200, response.text
    memory = client.get("/api/v1/memories", headers=owner).json()[0]
    assert memory["status"] == "pending"
    assert client.get(f"/api/v1/memories/{memory['id']}", headers=owner).json()["sources"][0]["file_id"] == response.json()["id"]


def test_compaction_failure_retry_idempotency_and_explicit_redaction(platform):
    app, client, owner, w, p, _ = platform
    capture(client, owner, w, p)
    with app.state.sessions() as db:
        workspace = db.get(Workspace, w)
        workspace.preferences = {"compaction_enabled": True, "raw_retention_policy": "redact_after_verified_compaction"}
        conversation = db.scalar(select(Conversation))
        conversation.created_at = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()
        db.commit()
        assert len(schedule_compaction(db, app.state.settings, dry_run=True)) == 1
        assert list(db.scalars(select(Job))) == []
        schedule_compaction(db, app.state.settings)
        db.commit()
    def fail(*_):
        raise RuntimeError("model unavailable")
    tick(app.state.sessions, app.state.settings, app.state.vectors, fail)
    with app.state.sessions() as db:
        assert db.scalar(select(Message)).content.startswith("We decided")
        job = db.scalar(select(Job))
        assert job.status == "queued" and job.attempts == 1
        job.available_at = "2000-01-01T00:00:00+00:00"
        db.commit()
    app.state.settings.redact_after_compaction = True
    tick(app.state.sessions, app.state.settings, app.state.vectors, lambda *_: "The user decided on PostgreSQL. The assistant supplied suggestions, not verified facts.")
    with app.state.sessions() as db:
        assert db.scalar(select(Conversation)).compacted_at
        assert db.scalar(select(Message)).content.startswith("[Redacted")
        summary = db.scalar(select(Memory).where(Memory.category == "Summaries"))
        assert summary.status == "pending"
        assert schedule_compaction(db, app.state.settings) == []


def test_sqlite_pragmas_and_real_chroma_version_filtered_storage(platform):
    app, client, owner, w, p, _ = platform
    with app.state.sessions() as db:
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1
        assert db.execute(text("PRAGMA journal_mode")).scalar() == "wal"
    # Vectors are deterministic fixtures only; Chroma persistence and authorization are real.
    class FixtureModel:
        def model_name(self): return "test-fixture"
        def dimensions(self): return 3
        def embed_text(self, text): return [1.0, 0.1, 0.1]
    from app.embeddings import Vectors
    vectors = Vectors(app.state.settings, FixtureModel())
    capture(client, owner, w, p)
    approve(client, owner)
    with app.state.sessions() as db:
        memory = db.scalar(select(Memory))
        vectors.put(memory)
    assert memory.id in vectors.search(w, p, "database")
    restored = Vectors(app.state.settings, FixtureModel())
    assert memory.id in restored.search(w, p, "database")
    assert not restored.search("other-workspace", p, "database")
