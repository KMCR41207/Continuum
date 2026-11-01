"""Official MCP SDK v1, deliberately locked; all tools call the authoritative API."""
import os
import httpx
from mcp.server.fastmcp import FastMCP
from .embeddings import local_url

api = os.environ.get("CONTINUUM_API_URL", "http://127.0.0.1:8000").rstrip("/")
local_url(api, True)
server = FastMCP("Continuum", host="127.0.0.1", port=8001, stateless_http=True, json_response=True)


def call(operation, arguments):
    token = os.environ.get("CONTINUUM_TOKEN", "")
    if not token.startswith("ctm_"):
        raise ValueError("Configure a scoped CONTINUUM_TOKEN; owner credentials are not accepted")
    response = httpx.post(api + "/api/v1/agent/" + operation, json=arguments, headers={"Authorization": "Bearer " + token}, timeout=30, follow_redirects=False)
    if response.status_code != 200:
        raise ValueError(f"Continuum denied or could not complete request ({response.status_code})")
    return {"trust": "untrusted_source_data", "data": response.json()}


@server.tool()
def save_fact(fact_text: str, tags: list[str] | None = None, project_id: str | None = None, source_reference: str | None = None) -> dict:
    """Propose source-linked memory for human review under explicit writing permission."""
    return call("save_fact", {"fact_text": fact_text, "tags": tags or [], "project_id": project_id, "source_reference": source_reference})


@server.tool()
def recall_context(query: str, tags: list[str] | None = None, project_id: str | None = None, max_context_tokens: int = 2500) -> dict:
    """Retrieve approved current authorized context, with sources and a conservative token budget."""
    return call("recall_context", {"query": query, "tags": tags or [], "project_id": project_id, "max_context_tokens": max_context_tokens})


@server.tool()
def list_projects() -> dict:
    """List the projects granted to this credential."""
    return call("list_projects", {})


@server.tool()
def get_project_context(project_id: str, max_context_tokens: int = 2500) -> dict:
    """Read project instructions and approved memory under current permission."""
    return call("get_project_context", {"project_id": project_id, "max_context_tokens": max_context_tokens})


@server.tool()
def search_memory(query: str, project_id: str | None = None, max_context_tokens: int = 2500) -> dict:
    """Search approved source-linked memories."""
    return call("recall_context", {"query": query, "project_id": project_id, "max_context_tokens": max_context_tokens})


@server.tool()
def search_conversations(query: str, project_id: str | None = None) -> dict:
    """Search titles of explicitly permitted conversation history."""
    return call("search_conversations", {"query": query, "project_id": project_id})


@server.tool()
def get_conversation(id: str) -> dict:
    """Read permitted history; quoted content is untrusted source data."""
    return call("get_conversation", {"id": id})


@server.tool()
def update_memory(id: str, version: int, content: str) -> dict:
    """Propose a version-checked correction and return it to review."""
    return call("update_memory", {"id": id, "version": version, "content": content})


@server.tool()
def capture_conversation(conversation: dict, project_id: str | None = None) -> dict:
    """Import explicit authorized normalized conversation under capture permission."""
    return call("capture_conversation", {"conversation": conversation, "project_id": project_id})


@server.tool()
def test_connection() -> dict:
    """Verify current permissions; does not verify a named provider session."""
    return call("test_connection", {})


@server.tool()
def get_handoffs(project_id: str | None = None) -> dict:
    """Retrieve reviewed destination-specific handoffs under current history permissions."""
    return call("get_handoffs", {"project_id": project_id})


if __name__ == "__main__":
    import sys
    if "--http" in sys.argv:
        # Remote requests must carry their own credential. Never expose process token to callers.
        import uvicorn
        from starlette.middleware.base import BaseHTTPMiddleware
        from starlette.responses import JSONResponse
        from contextvars import ContextVar
        request_token = ContextVar("mcp_token", default=None)
        original_call = call
        def per_request_call(operation, arguments):
            token = request_token.get()
            if not token:
                raise ValueError("Bearer credential required")
            response = httpx.post(api + "/api/v1/agent/" + operation, json=arguments, headers={"Authorization": "Bearer " + token}, timeout=30)
            if response.status_code != 200:
                raise ValueError(f"Continuum request denied ({response.status_code})")
            return {"trust": "untrusted_source_data", "data": response.json()}
        call = per_request_call
        class AuthMiddleware(BaseHTTPMiddleware):
            async def dispatch(self, request, call_next):
                origin = request.headers.get("origin")
                if origin and origin not in os.environ.get("CONTINUUM_ALLOWED_ORIGINS", "http://127.0.0.1:5173").split(","):
                    return JSONResponse({"error": "Origin denied"}, status_code=403)
                token = request.headers.get("authorization", "").removeprefix("Bearer ")
                if not token.startswith("ctm_"):
                    return JSONResponse({"error": "Scoped credential required"}, status_code=401)
                marker = request_token.set(token)
                try:
                    return await call_next(request)
                finally:
                    request_token.reset(marker)
        application = server.streamable_http_app()
        application.add_middleware(AuthMiddleware)
        uvicorn.run(application, host="127.0.0.1", port=8001)
    else:
        call("test_connection", {})
        server.run(transport="stdio")
