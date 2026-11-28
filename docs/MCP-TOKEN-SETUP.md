# MCP Token Setup

This guide explains how to configure the Continuum MCP server so agents can authenticate.

## Quick start

For a single saved chat, open **Chat Links** in Continuum and choose **Copy IDE prompt**. If Codex already has access, paste that prompt into Codex. Each read fetches the latest saved messages.

For first-time Codex setup, run the following from the Continuum project folder. Replace `CHAT_ID` with the ID in the copied prompt.

```bash
node server/cli.ts login --conversation CHAT_ID
node server/cli.ts mcp on --agents codex
```

The first command opens Connections with the chat and its project scope already selected. Review the permissions, tick the authorization box and choose **Create scoped credential**. Choose **Copy token**, paste it into the local login window and press Enter. The window hides your input. Continuum verifies the chat is readable before saving the token. Restart Codex after registration.

For a general connection or another client, use the existing CLI commands below.

```bash
# 1. Log in and save your token
continuum login

# 2. Register the MCP server with your agent
continuum mcp on --agents claude       # Claude Code
continuum mcp on --agents cursor       # Cursor
continuum mcp on --agents codex        # Codex

# 3. Restart the agent to load the server
```

## Token requirement

The MCP server reads the token from one of two places (in order):

1. **Environment variable:** `CONTINUUM_TOKEN=ctm_…`
2. **Token file:** `~/.continuum/token` (written by `continuum login`, mode 0600)

**Running `continuum mcp on` without a token will register the server config but all MCP calls will fail at runtime.** Always run `continuum login` first.

## Verify the token is set

```bash
continuum diagnose
```

Output shows:
```
Token:       ✓ valid (ctm_abcd…)
Connection:  ✓ connected
Permissions: capture, retrieval, writing
Advice:      Everything looks good.
```

## Manual token setup (alternative to login)

If you prefer to set the token manually without `continuum login`:

```bash
# Create the directory and write the token file
mkdir -p ~/.continuum
echo "ctm_your64hextoken" > ~/.continuum/token
chmod 600 ~/.continuum/token
```

Or set the environment variable in your shell profile:
```bash
export CONTINUUM_TOKEN=ctm_your64hextoken
```

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Not logged in. Run continuum login` | No token file and no env var | Run `continuum login` |
| `Token rejected` | Token was revoked or expired | Create a new token in Connections |
| `permission denied` | Token lacks the required permission | Edit the connection and enable retrieval/capture |
| MCP server starts but tools fail | Token set after `mcp on` was registered without it | Run `continuum login`, then restart the agent |

## MCP serve token flow

When an agent runs `continuum mcp serve` (via the registered command), the server:
1. Reads `CONTINUUM_TOKEN` from the environment
2. Falls back to `~/.continuum/token`
3. If neither is set, starts the server but all tool calls return an authentication error

The token is not stored in the MCP config file — only the command path is registered. This keeps credentials out of agent config files.
