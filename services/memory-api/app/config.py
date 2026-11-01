from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONTINUUM_", env_file=".env", extra="ignore")
    data_dir: Path = Path("../../data")
    jwt_secret: str = ""
    allowed_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    allowed_hosts: str = "127.0.0.1,localhost,testserver"
    embedding_provider: str = "sentence-transformers"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_url: str = "http://127.0.0.1:11434/api/embed"
    embedding_key: str = ""
    chroma_url: str = ""
    allow_remote_processing: bool = False
    ollama_url: str = "http://127.0.0.1:11434/api/chat"
    summary_model: str = "llama3.2"
    summary_provider: str = "ollama"
    summary_url: str = ""
    summary_key: str = ""
    raw_conversation_retention_days: int = 14
    redact_after_compaction: bool = False
    max_file_bytes: int = 10_000_000
    model_local_only: bool = True

    def prepare(self):
        self.data_dir = self.data_dir.resolve()
        for name in ("sqlite", "chroma", "uploads", "backups"):
            (self.data_dir / name).mkdir(parents=True, exist_ok=True)
        key_path = self.data_dir / "sqlite" / ".jwt-secret"
        if not self.jwt_secret:
            if not key_path.exists():
                import secrets, os
                descriptor = os.open(key_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, "w") as output:
                    output.write(secrets.token_urlsafe(48))
            self.jwt_secret = key_path.read_text().strip()
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT secret must contain at least 32 characters")
        return self
