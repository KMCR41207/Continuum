import asyncio
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path
import uvicorn
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from test_platform import platform, capture, approve, connection


def test_actual_python_sdk_stdio_client_retrieves_writes_and_obeys_revocation(platform):
    app, client, owner, w, p, _ = platform
    capture(client, owner, w, p)
    approve(client, owner)
    identifier, agent_headers, token = connection(client, owner, w, p, retrieval=True, writing=True, all_history=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(.05)
    async def scenario():
        parameters = StdioServerParameters(command=sys.executable, args=["-m", "app.mcp_server"], cwd=str(Path(__file__).parents[1]), env={**os.environ, "CONTINUUM_API_URL": f"http://127.0.0.1:{port}", "CONTINUUM_TOKEN": token})
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                assert {"save_fact", "recall_context", "get_project_context"}.issubset({tool.name for tool in tools.tools})
                result = await session.call_tool("recall_context", {"query": "PostgreSQL", "project_id": p})
                assert not result.isError
                assert "PostgreSQL" in str(result)
                saved = await session.call_tool("save_fact", {"fact_text": "I prefer concise explanations and runnable examples.", "project_id": p})
                assert not saved.isError
                assert "pending" in str(saved)
                client.patch(f"/api/v1/connections/{identifier}", headers=owner, json={"permissions": {"retrieval": True, "project_ids": [p], "all_history": True}})
                denied = await session.call_tool("save_fact", {"fact_text": "I prefer long explanations for every future project.", "project_id": p})
                assert denied.isError
                client.delete(f"/api/v1/connections/{identifier}", headers=owner)
                revoked = await session.call_tool("recall_context", {"query": "PostgreSQL", "project_id": p})
                assert revoked.isError
    try:
        asyncio.run(scenario())
    finally:
        server.should_exit = True
        thread.join(timeout=10)
