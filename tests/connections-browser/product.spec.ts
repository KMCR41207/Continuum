import { test, expect, type Page } from "@playwright/test";
// These UI wire fixtures do not replace the PostgreSQL authorization tests.
const w = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  u = "11111111-1111-4111-8111-111111111111",
  p = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function fixture(page: Page) {
  const now = new Date().toISOString(),
    expires = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: u, exp: expires })).toString("base64url")}.test`,
    refresh_token: "test",
    expires_at: expires,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: u,
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
  const calls: { name: string; body: any }[] = [];
  let step = 0;
  await page.route("https://continuum-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      name = url.pathname.split("/").pop()!;
    const body = req.postData() ? req.postDataJSON() : null;
    calls.push({ name, body });
    let data: any = [];
    if (name === "workspaces")
      data = [
        {
          id: w,
          owner_id: u,
          name: "Continuum workspace",
          preferences: {},
          created_at: now,
        },
      ];
    if (name === "projects")
      data =
        req.method() === "GET"
          ? [
              {
                id: p,
                workspace_id: w,
                name: "Atlas",
                instructions: "Use strict TypeScript",
                status: "active",
                created_at: now,
              },
            ]
          : null;
    if (name === "user") data = session.user;
    if (name === "onboarding_progress") {
      if (body) {
        step = body.step;
        data = null;
      } else data = { step };
    }
    if (name === "workspace_usage")
      data = {
        plan: "free",
        billing_status: "unconfigured",
        limits: {
          memories: 100000,
          conversations: 1000,
          projects: 1000,
          connections: 100,
        },
        memories: 1,
        pending: 1,
        conversations: 1,
        projects: 1,
        connections: 0,
        verified_agents: 0,
        requests_30d: 4,
        jobs: 1,
        stored_text_bytes: 200,
        last_successful_sync: null,
      };
    if (name === "plan_catalog")
      data = [
        { id: "free", name: "Free", enabled: true, stripe_price_id: null },
        { id: "pro", name: "Pro", enabled: false, stripe_price_id: null },
      ];
    if (name === "workspace_billing") data = null;
    if (name === "memory_platforms") data = ["chatgpt"];
    if (name === "memory_sources")
      data = [
        {
          id: "source-fixture",
          memory_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          conversation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          message_id: "message-fixture",
          evidence: "This project uses React.",
        },
      ];
    if (name === "memories")
      data = [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          project_id: p,
          content: "This project uses React.",
          category: "Facts",
          status: "active",
          version: 1,
          updated_at: now,
        },
      ];
    if (name === "agent_connections")
      data = [
        {
          id: "agent-fixture",
          name: "Scoped test agent",
          provider: "claude",
          state: "revoked",
          project_ids: [p],
          conversation_ids: [],
          capture: false,
          retrieval: true,
          writing: false,
          global_access: false,
          expires_at: "2099-01-01T00:00:00Z",
          created_at: now,
        },
      ];
    if (name === "project_handoffs")
      data = [
        {
          id: "handoff-fixture",
          project_id: p,
          conversation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          destination_connection_id: "agent-fixture",
          target_provider: "claude",
          note: "Continue architecture review",
          created_at: now,
        },
      ];
    if (name === "list_members")
      data = [{ user_id: u, email: "owner@example.test", role: "owner" }];
    if (name === "invite_member")
      data = { id: "invite", token: "fixture-token", delivery: "manual_link" };
    if (name === "conversations")
      data = [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          workspace_id: w,
          project_id: p,
          title: "Architecture",
          platform: "chatgpt",
          message_count: 1,
          processing_status: "review",
          created_at: now,
        },
      ];
    if (name === "search_memories")
      data = {
        total: 1,
        items: [
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            workspace_id: w,
            project_id: p,
            content: "This project uses React.",
            category: "Facts",
            status: body.p_status === "all" ? "active" : body.p_status,
            confidence: 0.8,
            version: 1,
            created_at: now,
            updated_at: now,
          },
        ],
      };
    if (name === "sync_jobs")
      data = [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          kind: "import",
          status: "failed",
          attempts: 5,
          max_attempts: 5,
          available_at: now,
          last_error: "Processing failed; check source",
          updated_at: now,
        },
      ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  return calls;
}

test("relationship explorers reflect authorized wire records and open existing actions", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto("/app/memories");
  const memories = page.getByRole("region", {
    name: "Memory relationship explorer",
  });
  await expect(memories).toContainText("Original supporting evidence");
  await memories
    .getByRole("button", { name: "Inspect memory and sources" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Source evidence");
  await expect(page.getByRole("dialog")).toContainText(
    "This project uses React.",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/app/connections");
  const connections = page.getByRole("region", { name: "Agent access map" });
  await connections
    .getByRole("button", { name: "Credential Scoped test agent" })
    .click();
  await expect(connections.locator(".relationship-detail")).toContainText(
    "revoked",
  );
  await expect(connections.locator(".relationship-detail")).toContainText(
    "Capture: off · Retrieval: on · Writing: off",
  );
  await connections
    .getByRole("button", { name: "Manage this connection" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/app/projects");
  const projects = page.getByRole("region", { name: "Project context map" });
  await projects
    .getByRole("button", { name: "Handoff Continue architecture review" })
    .click();
  await expect(projects.locator(".relationship-detail")).toContainText(
    "Handoff source",
  );
  await expect(projects.locator(".relationship-detail")).toContainText(
    "Reviewed destination",
  );
  expect(
    calls.some(
      (c) => c.name === "configure_connection" || c.name === "confirm_handoff",
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
test("onboarding resumes, skips optional steps, and never grants agent permissions", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto("/app/onboarding");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Welcome to Continuum",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your first project",
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your first project",
  );
  await page.getByLabel("Project name").fill("My first project");
  await page
    .getByRole("button", { name: "Create project and continue" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "How memories work",
  );
  expect(calls.some((c) => c.name === "configure_connection")).toBe(false);
  expect(
    calls.filter((c) => c.name === "projects" && c.body).at(-1)?.body
      .workspace_id,
  ).toBe(w);
});
test("product pages expose actual controls without claiming unconfigured services succeeded", async ({
  page,
}) => {
  const calls = await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [route, title] of [
    ["usage", "Usage"],
    ["billing", "Billing"],
    ["team", "Workspace team"],
    ["jobs", "Processing jobs"],
    ["security", "Security and data"],
  ] as const) {
    await page.goto(`/app/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByText("No deletion has been performed.", { exact: false }),
  ).toBeVisible();
  await page.goto("/app/team");
  await page.getByLabel("Email", { exact: true }).fill("teammate@example.test");
  await page.getByRole("button", { name: "Create invitation link" }).click();
  await expect(page.getByLabel("Invitation link — copy now")).toHaveValue(
    /\/invite#token=fixture-token$/,
  );
  expect(calls.find((c) => c.name === "invite_member")?.body.p_role).toBe(
    "viewer",
  );
  await page.goto("/app/jobs");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  expect(
    calls.some((c) => c.name === "control_job" && c.body.p_action === "retry"),
  ).toBe(true);
  await page.goto("/app/memories");
  await page.getByRole("textbox", { name: "Search memories" }).fill("React");
  await page
    .getByRole("combobox", { name: "Source platform" })
    .selectOption("chatgpt");
  await expect
    .poll(
      () =>
        calls.filter((c) => c.name === "search_memories").at(-1)?.body
          .p_platform,
    )
    .toBe("chatgpt");
  expect(errors).toEqual([]);
});
