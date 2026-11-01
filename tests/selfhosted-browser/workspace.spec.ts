import { test, expect } from "@playwright/test";
test("local setup, import, review and connections persist through the real FastAPI service", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .locator(".nav-account")
    .getByRole("link", { name: "Open workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create your local workspace." }),
  ).toBeVisible();
  await page
    .getByLabel("Email for your local account")
    .fill("browser@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser password long enough");
  await page.getByRole("button", { name: "Create local workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.goto("/app/projects");
  await page.getByRole("button", { name: /New project/i }).click();
  await page
    .getByRole("dialog")
    .getByLabel(/Project name|Name/i)
    .fill("Browser Atlas");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save project" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Browser Atlas", exact: true, level: 2 }),
  ).toBeVisible();
  await page.goto("/app/conversations");
  await page.getByRole("button", { name: /Import conversation/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption({ label: "Browser Atlas" });
  await dialog
    .locator("textarea")
    .fill(
      JSON.stringify({
        title: "Browser architecture",
        platform: "manual",
        messages: [
          {
            role: "user",
            content:
              "We decided to use PostgreSQL for the browser verification project.",
          },
        ],
      }),
    );
  await dialog
    .getByLabel("I have permission to store and process this conversation.")
    .check();
  await dialog
    .getByRole("button", { name: "Import and propose memories" })
    .click();
  await expect(
    page.getByText("Browser architecture", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/app/memories?status=pending");
  await expect(
    page
      .getByText(
        "We decided to use PostgreSQL for the browser verification project.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByText(
        "We decided to use PostgreSQL for the browser verification project.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await page
    .locator(".memory-table")
    .getByRole("button", {
      name: "We decided to use PostgreSQL for the browser verification project.",
    })
    .click();
  await page.getByRole("button", { name: "Save and approve" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/app/memories");
  await expect(
    page
      .getByText(
        "We decided to use PostgreSQL for the browser verification project.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await page.goto("/app/connections");
  await page.getByRole("button", { name: "New connection" }).click();
  await page.getByLabel("Connection name").fill("Browser agent");
  await page
    .getByLabel("Memory retrieval — approved memories and permitted history")
    .check();
  await page.getByLabel("Browser Atlas", { exact: true }).check();
  await page
    .getByLabel(
      "I authorize the selected capabilities and scopes for this connection.",
    )
    .check();
  await page.getByRole("button", { name: "Create scoped credential" }).click();
  await expect(page.getByLabel("New token — copy now")).toHaveValue(/^ctm_/);
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText("Backend credential and permissions verified.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/security");
  await expect(
    page.getByRole("heading", { name: "Security and data" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
