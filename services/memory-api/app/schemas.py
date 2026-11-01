from typing import Literal
from pydantic import BaseModel, Field, ConfigDict

CATEGORIES = {"Facts", "Preferences", "Decisions", "Projects", "Goals", "Skills", "Instructions", "Events", "Technical architecture", "Coding conventions", "Summaries"}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Strict):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    name: str = Field(default="", max_length=100)


class MessageInput(Strict):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20000)
    metadata: dict = Field(default_factory=dict)


class ConversationInput(Strict):
    title: str = Field(min_length=1, max_length=200)
    platform: str = Field(min_length=1, max_length=50)
    messages: list[MessageInput] = Field(min_length=1, max_length=500)
    metadata: dict = Field(default_factory=dict)


class ImportRequest(Strict):
    workspace_id: str
    project_id: str | None = None
    conversation: ConversationInput


class Query(Strict):
    workspace_id: str | None = None
    project_id: str | None = None
    query: str = Field(default="", max_length=1000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    category: str | None = None
    source: str | None = None
    top_k: int = Field(default=8, ge=1, le=50)
    max_context_tokens: int = Field(default=2500, ge=32, le=16000)
    relevance_threshold: float = Field(default=0, ge=0, le=1)


class ConnectionInput(Strict):
    workspace_id: str
    name: str = Field(min_length=1, max_length=100)
    provider: str = Field(default="other", max_length=50)
    permissions: dict = Field(default_factory=dict)
    expires_days: int = Field(default=30, ge=1, le=90)


class MemoryPatch(Strict):
    content: str | None = Field(default=None, min_length=12, max_length=4000)
    category: str | None = None
    status: Literal["pending", "active", "rejected", "archived"] | None = None
    sensitivity: Literal["normal", "sensitive"] | None = None
    importance: float | None = Field(default=None, ge=0, le=1)
    version: int = Field(ge=1)
