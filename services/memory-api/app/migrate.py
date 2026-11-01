from pathlib import Path
from alembic.config import Config
from alembic import command


def upgrade(engine):
    configuration = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    configuration.set_main_option("script_location", str(Path(__file__).parents[1] / "migrations"))
    configuration.attributes["connection"] = engine.connect()
    try:
        command.upgrade(configuration, "head")
    finally:
        configuration.attributes["connection"].close()
