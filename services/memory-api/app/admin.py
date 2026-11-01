"""Local administrator operations. No password or API key is accepted in argv."""
import argparse
import getpass
import hashlib
import json
import shutil
import sqlite3
import tarfile
from pathlib import Path
from sqlalchemy import select
from .config import Settings
from .database import *
from .security import passwords, Identity
from .engine import ingest, hash_text
from .migrate import upgrade


def backup(settings, destination):
    """Stop API and worker first so the Chroma/uploads snapshot matches SQLite."""
    target = Path(destination).resolve()
    if target.exists():
        raise ValueError("Backup destination already exists")
    target.mkdir(parents=True, mode=0o700)
    with sqlite3.connect(settings.data_dir / "sqlite" / "continuum.db") as source, sqlite3.connect(target / "continuum.db") as output:
        source.backup(output)
    shutil.copytree(settings.data_dir / "chroma", target / "chroma")
    shutil.copytree(settings.data_dir / "uploads", target / "uploads")
    # Signing material is required to restore sessions; keep the entire backup private.
    secret = settings.data_dir / "sqlite" / ".jwt-secret"
    if secret.exists():
        shutil.copy2(secret, target / ".jwt-secret")
    checksums = {str(path.relative_to(target)): hashlib.sha256(path.read_bytes()).hexdigest() for path in target.rglob("*") if path.is_file()}
    (target / "manifest.json").write_text(json.dumps(checksums, indent=2), encoding="utf-8")
    return target


def restore(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Restore requires an empty target directory; never overwrite a live installation")
    manifest = json.loads((source / "manifest.json").read_text())
    for relative, checksum in manifest.items():
        path = (source / relative).resolve()
        if not path.is_relative_to(source) or hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
            raise ValueError("Backup manifest validation failed")
    (destination / "sqlite").mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / "continuum.db", destination / "sqlite" / "continuum.db")
    if (source / ".jwt-secret").exists():
        shutil.copy2(source / ".jwt-secret", destination / "sqlite" / ".jwt-secret")
    for directory in ("chroma", "uploads"):
        shutil.copytree(source / directory, destination / directory)
    with sqlite3.connect(destination / "sqlite" / "continuum.db") as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Restored database integrity check failed")


def import_snapshot(db, owner, workspace, snapshot):
    """Offline one-time import. Preserve source IDs; never import keys/passwords."""
    target = db.get(Workspace, workspace)
    if not target or target.owner_id != owner:
        raise ValueError("Selected workspace owner required")
    if db.scalar(select(Project.id).where(Project.workspace_id == workspace)) or db.scalar(select(Conversation.id).where(Conversation.workspace_id == workspace)) or db.scalar(select(Memory.id).where(Memory.workspace_id == workspace)):
        raise ValueError("Snapshot import requires an empty target workspace")
    old_workspace = snapshot.get("workspace", {}).get("id")
    if not old_workspace:
        raise ValueError("Expected a complete workspace export")
    for name in ("projects", "conversations", "messages", "memories", "sources", "memory_sources", "versions", "memory_versions"):
        if any(row.get("workspace_id") != old_workspace for row in snapshot.get(name, [])):
            raise ValueError("Mixed workspace export")
    project_ids = {row["id"] for row in snapshot.get("projects", [])}
    conversation_ids = {row["id"] for row in snapshot.get("conversations", [])}
    message_ids = {row["id"] for row in snapshot.get("messages", [])}
    memory_ids = {row["id"] for row in snapshot.get("memories", [])}
    for row in snapshot.get("conversations", []) + snapshot.get("memories", []):
        if row.get("project_id") and row["project_id"] not in project_ids:
            raise ValueError("Snapshot project reference missing")
    if any(row["conversation_id"] not in conversation_ids for row in snapshot.get("messages", [])):
        raise ValueError("Snapshot source reference missing")
    for row in snapshot.get("sources", snapshot.get("memory_sources", [])):
        if row["memory_id"] not in memory_ids or row.get("conversation_id") not in conversation_ids or row.get("message_id") not in message_ids:
            raise ValueError("Snapshot provenance is incomplete")
    for row in snapshot.get("projects", []):
        if row["workspace_id"] != old_workspace:
            raise ValueError("Mixed workspace export")
        db.add(Project(id=row["id"], workspace_id=workspace, name=row["name"], description=row.get("description", ""), instructions=row.get("instructions", ""), status=row.get("status", "active"), created_at=row["created_at"]))
    db.flush()
    for row in snapshot.get("conversations", []):
        db.add(Conversation(id=row["id"], workspace_id=workspace, project_id=row.get("project_id"), title=row["title"], platform=row["platform"], scope_hash=hash_text(row["id"]), message_count=row["message_count"], excluded=row.get("excluded", False), source_metadata=row.get("source_metadata", {}), created_at=row["created_at"]))
    db.flush()
    for row in snapshot.get("messages", []):
        db.add(Message(id=row["id"], workspace_id=workspace, conversation_id=row["conversation_id"], position=row["position"], role=row["role"], content=row["content"], source_metadata=row.get("source_metadata", {})))
    for row in snapshot.get("memories", []):
        db.add(Memory(id=row["id"], workspace_id=workspace, project_id=row.get("project_id"), scope=row.get("project_id") or "global", content=row["content"], content_hash=hash_text(row["content"]), category=row["category"], confidence=row["confidence"], status=row["status"], sensitivity=row["sensitivity"], version=row["version"], created_at=row["created_at"], updated_at=row["updated_at"]))
    db.flush()
    for row in snapshot.get("sources", snapshot.get("memory_sources", [])):
        db.add(Source(id=row["id"], workspace_id=workspace, memory_id=row["memory_id"], conversation_id=row.get("conversation_id"), message_id=row.get("message_id"), evidence=row["evidence"]))
    for row in snapshot.get("versions", snapshot.get("memory_versions", [])):
        db.add(MemoryVersion(id=row["id"], workspace_id=workspace, memory_id=row["memory_id"], content=row["content"], category=row["category"], status=row["status"], version=row["version"]))
    db.flush()
    return {"projects": len(snapshot.get("projects", [])), "conversations": len(snapshot.get("conversations", [])), "memories": len(snapshot.get("memories", [])), "credentials_migrated": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create-user", "reset-password", "prepare-model", "backup", "restore", "import-snapshot"])
    parser.add_argument("--email")
    parser.add_argument("--path")
    parser.add_argument("--workspace")
    parser.add_argument("--services-stopped", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    if args.command == "restore":
        if not args.services_stopped:
            raise ValueError("Stop API/worker and confirm --services-stopped")
        restore(args.path, settings.data_dir)
        return
    settings.prepare()
    if args.command == "prepare-model":
        from .embeddings import Embeddings
        settings.model_local_only = False
        model = Embeddings(settings)
        model.embed_text("local model installation verification")
        print(json.dumps({"model": model.model_name(), "dimensions": model.dimensions(), "processing": "local"}))
        return
    if args.command == "backup":
        if not args.services_stopped:
            raise ValueError("Stop API/worker and confirm --services-stopped")
        print(backup(settings, args.path))
        return
    engine, sessions = database(settings)
    upgrade(engine)
    with sessions.begin() as db:
        user = db.scalar(select(User).where(User.email == (args.email or "").lower()))
        if args.command == "import-snapshot":
            if not user or not args.services_stopped:
                raise ValueError("Existing owner email and --services-stopped required")
            print(json.dumps(import_snapshot(db, user.id, args.workspace, json.loads(Path(args.path).read_text(encoding="utf-8")))))
            return
        if not args.email or "@" not in args.email:
            raise ValueError("Valid --email required")
        password = getpass.getpass("New local password: ")
        if not 12 <= len(password) <= 128 or password != getpass.getpass("Repeat password: "):
            raise ValueError("Passwords must match and contain 12–128 characters")
        if args.command == "create-user":
            if user:
                raise ValueError("Account already exists")
            db.add(User(email=args.email.lower(), password_hash=passwords.hash(password)))
        else:
            if not user:
                raise ValueError("Account not found")
            user.password_hash = passwords.hash(password)
            for session in db.scalars(select(SessionToken).where(SessionToken.user_id == user.id)):
                session.revoked = True
        print("Local account updated. No email was sent.")


if __name__ == "__main__":
    main()
