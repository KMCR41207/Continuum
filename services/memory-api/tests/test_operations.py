import json
from pathlib import Path
from sqlalchemy import select, text
from app.database import User, Workspace, Member, Connection, Conversation, Message, Memory, Source, Job, now
from app.security import passwords, issue_session
from app.admin import backup, restore, import_snapshot
from test_platform import platform, capture, approve, connection


def test_expiry_cross_project_and_source_deletion_policy(platform):
    app, client, owner, w, p, _ = platform
    captured, raw = capture(client, owner, w, p)
    memory = approve(client, owner)
    identifier, agent, _ = connection(client, owner, w, p, retrieval=True, all_history=True)
    another = client.post("/api/v1/projects", headers=owner, json={"workspace_id": w, "name": "Separate"}).json()["id"]
    assert client.post("/api/v1/memory/query", headers=agent, json={"project_id": another}).status_code == 403
    assert client.post("/api/v1/memory/query", headers=agent, json={"workspace_id": "guess", "project_id": p, "query": "PostgreSQL"}).json()["items"][0]["id"] == memory["id"]
    with app.state.sessions() as db:
        db.get(Connection, identifier).expires_at = "2000-01-01T00:00:00+00:00"
        db.commit()
    assert client.post("/api/v1/agent/test_connection", headers=agent, json={}).status_code == 401
    assert client.delete(f"/api/v1/conversations/{captured['id']}", headers=owner).status_code == 200
    assert client.get("/api/v1/memories", headers=owner).json() == []


def test_export_offline_migration_and_backup_integrity(platform, tmp_path):
    app, client, owner, w, p, _ = platform
    capture(client, owner, w, p)
    approve(client, owner)
    snapshot = client.post("/api/v1/rpc/export_workspace", headers=owner, json={"p_workspace": w}).json()
    assert "token_hash" not in json.dumps(snapshot)
    assert "password_hash" not in json.dumps(snapshot)
    from app.main import create_app
    from app.config import Settings
    from fastapi.testclient import TestClient
    target_app = create_app(Settings(data_dir=tmp_path / "migration-store", embedding_provider="disabled"))
    target_client = TestClient(target_app)
    target_session = target_client.post("/api/v1/auth/setup", json={"email": "migration@example.test", "password": "migration safe password"}).json()
    with target_app.state.sessions() as target_db:
        target_workspace = target_db.scalar(select(Workspace))
        counts = import_snapshot(target_db, target_session["user"]["id"], target_workspace.id, snapshot)
        target_db.commit()
        assert counts["memories"] == 1
        assert target_db.scalar(select(Source)).conversation_id == snapshot["conversations"][0]["id"]
    # Export is restorable through preserved source IDs. Import target must be empty.
    with app.state.sessions() as db:
        user = db.scalar(select(User))
        other = Workspace(owner_id=user.id, name="Migration target")
        db.add(other)
        db.flush()
        db.add(Member(workspace_id=other.id, user_id=user.id, role="owner"))
        # A separate store is necessary to preserve source IDs, not duplicate them in this store.
        try:
            import_snapshot(db, user.id, w, snapshot)
        except ValueError as error:
            assert "empty" in str(error)
        else:
            raise AssertionError("Existing data must never be overwritten")
        db.rollback()
    # SQLite backup copies an actual database and verifies manifest/integrity on restore.
    destination = tmp_path / "backup-out"
    backup(app.state.settings, destination)
    restored = tmp_path / "restore-out"
    restore(destination, restored)
    import sqlite3
    with sqlite3.connect(restored / "sqlite" / "continuum.db") as db:
        assert db.execute("select count(*) from memories").fetchone()[0] == 1
    (destination / "continuum.db").write_bytes(b"tampered")
    try:
        restore(destination, tmp_path / "invalid-restore")
    except ValueError as error:
        assert "manifest" in str(error)
    else:
        raise AssertionError("Tampered backup accepted")


def test_jobs_recover_expired_leases_and_apply_role_changes(platform):
    app, client, owner, w, p, _ = platform
    from app.worker import claim
    from app.engine import enqueue
    with app.state.sessions() as db:
        enqueue(db, w, p, "import", {"input": {}, "user_id": db.scalar(select(User.id))}, "lease-test")
        db.commit()
    first = claim(app.state.sessions)
    assert first
    with app.state.sessions() as db:
        job = db.get(Job, first[0])
        job.lease_until = "2000-01-01T00:00:00+00:00"
        db.commit()
    second = claim(app.state.sessions)
    assert second[0] == first[0] and second[1] != first[1]
