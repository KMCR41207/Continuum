import { test, expect } from "@playwright/test";
// UI-only wire fixtures. Actual authorization is tested against PostgreSQL + MCP in connections.test.ts.
test("owner creates minimal permissions, sees failed validation, changes permissions, and revokes", async ({
  page,
}) => {
  const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const owner = "11111111-1111-4111-8111-111111111111";
  const project = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const token = "ctm_" + "a".repeat(64);
  const now = new Date().toISOString();
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`,
    refresh_token: "test",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: owner,
      aud: "authenticated",
      email: "owner@example.test",
      app_metadata: {},
      user_metadata: {},
      created_at: now,
    },
  };
  await page.addInitScript(
    (s) =>
      localStorage.setItem("sb-continuum-test-auth-token", JSON.stringify(s)),
    session,
  );
  let connection: any = null;
  let saved: any = null;
  await page.route("https://continuum-test.supabase.co/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let data: unknown = [];
    if (url.pathname.includes("/auth/v1/user")) data = session.user;
    else if (url.pathname.endsWith("/workspaces"))
      data = [
        {
          id: workspace,
          owner_id: owner,
          name: "Test workspace",
          preferences: {},
          created_at: now,
        },
      ];
    else if (url.pathname.endsWith("/projects"))
      data = [
        {
          id: project,
          workspace_id: workspace,
          name: "Project A",
          created_at: now,
        },
      ];
    else if (url.pathname.endsWith("/rpc/configure_connection")) {
      saved = request.postDataJSON();
      connection = {
        id,
        workspace_id: workspace,
        provider: saved.p_provider,
        name: saved.p_name,
        ...saved.p_permissions,
        state: saved.p_revoke ? "revoked" : "pending",
        created_at: now,
        expires_at: "2099-01-01T00:00:00Z",
        last_activity_at: null,
        last_sync_at: null,
        last_error: null,
      };
      data = { id, token: saved.p_id ? null : token };
    } else if (url.pathname.endsWith("/agent_connections"))
      data = request.headers()["accept"]?.includes("object")
        ? connection
        : connection
          ? [connection]
          : [];
    else if (url.pathname.endsWith("/rpc/agent_request"))
      data = { error: "Invalid or expired credential", code: "unauthorized" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto("/app/connections");
  await page.getByRole("button", { name: "New connection" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Connection name").fill("Coding agent");
  await dialog
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("codex");
  await dialog
    .getByLabel("Memory retrieval — approved memories and permitted history")
    .check();
  await dialog.getByLabel("Project A", { exact: true }).check();
  await dialog
    .getByLabel(
      "I authorize the selected capabilities and scopes for this connection.",
    )
    .check();
  await dialog
    .getByRole("button", { name: "Create scoped credential" })
    .click();
  await expect(
    dialog.getByText("Credential created.", { exact: false }),
  ).toBeVisible();
  expect(saved.p_permissions).toMatchObject({
    retrieval: true,
    capture: false,
    writing: false,
    project_ids: [project],
    all_history: false,
    global_access: false,
  });
  await expect(dialog.getByLabel("New token — copy now")).toHaveAttribute(
    "type",
    "password",
  );
  expect(
    await page.evaluate((t) => JSON.stringify(localStorage).includes(t), token),
  ).toBe(false);
  await dialog
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    dialog.getByText("Invalid or expired credential", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Backend credential and permissions verified.", {
      exact: false,
    }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Memory writing — proposals and reviewed corrections")
    .check();
  await dialog.getByRole("button", { name: "Save permissions" }).click();
  await expect(
    dialog.getByText("Permissions saved.", { exact: false }),
  ).toBeVisible();
  expect(saved.p_permissions).toMatchObject({
    retrieval: true,
    writing: true,
    capture: false,
  });
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "Disconnect and revoke" }).click();
  await expect(
    dialog.getByText("Access revoked.", { exact: false }),
  ).toBeVisible();
  expect(saved.p_revoke).toBe(true);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
});
