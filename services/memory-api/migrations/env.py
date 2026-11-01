from alembic import context
from app.config import Settings
from app.database import Base, database

connection = context.config.attributes.get("connection")
if connection is None:
    engine, _ = database(Settings().prepare())
    connection = engine.connect()
try:
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
finally:
    if "connection" not in context.config.attributes:
        connection.close()
