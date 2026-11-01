"""Initial self-hosted schema. SQLite authoritative; Chroma rebuildable."""
from alembic import op
from app.database import Base

revision = "0001"
down_revision = None


def upgrade():
    Base.metadata.create_all(op.get_bind())
    op.execute("CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, content)")
    op.execute("CREATE TRIGGER memory_fts_insert AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(id,content) VALUES(new.id,new.content); END")
    op.execute("CREATE TRIGGER memory_fts_update AFTER UPDATE ON memories BEGIN DELETE FROM memories_fts WHERE id=old.id; INSERT INTO memories_fts(id,content) VALUES(new.id,new.content); END")
    op.execute("CREATE TRIGGER memory_fts_delete AFTER DELETE ON memories BEGIN DELETE FROM memories_fts WHERE id=old.id; END")


def downgrade():
    raise RuntimeError("Destructive downgrade disabled; restore a verified backup instead")
