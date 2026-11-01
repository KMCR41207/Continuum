import { test, expect } from "@playwright/test";
test("memory loop demonstrates capture, source evidence, and retrieval", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Good thinking",
  );
  await page
    .getByRole("button", { name: "Capture conversation", exact: true })
    .click();
  await expect(page.getByText("Captured with source evidence")).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect extracted memory", exact: true })
    .click();
  await expect(
    page
      .locator(".memory-loop")
      .getByText("PostgreSQL is the selected database for Project Atlas.", {
        exact: true,
      }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View source", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Ask another agent", exact: true })
    .click();
  await expect(
    page.getByText("Context received. Work continues."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replay the loop" }).click();
  await expect(
    page.getByRole("button", { name: "Capture conversation", exact: true }),
  ).toBeVisible();
});
test("integration search and details accurately show capabilities", async ({
  page,
}) => {
  await page.goto("/integrations");
  await page
    .getByRole("textbox", { name: "Search integrations" })
    .fill("Codex");
  await page
    .getByRole("button", { name: /Client setup required Codex/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "No live provider connection is claimed",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("textbox", { name: "Search integrations" })
    .fill("unknown-source");
  await expect(
    page.getByText("No integrations match your search."),
  ).toBeVisible();
});
test("unconfigured authentication never pretends to sign in", async ({
  page,
}) => {
  await page.goto("/signup");
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "Account services need setup",
  );
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "secure home",
  );
  await expect(
    page.getByText("VITE_SUPABASE_URL", { exact: true }),
  ).toBeVisible();
});
test("public calls to action lead to setup instead of unavailable authentication", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Connection setup", exact: true }),
  ).toHaveAttribute("href", "/docs#setup");
  await expect(
    page.getByRole("link", { name: "Setup guide", exact: true }),
  ).toHaveAttribute("href", "/docs#setup");
  await expect(page.locator('a[href="/signin"], a[href="/signup"]')).toHaveCount(
    0,
  );
});
test("pricing cannot simulate checkout", async ({ page }) => {
  await page.goto("/pricing");
  const links = page.getByRole("link", { name: "View billing setup" });
  await expect(links).toHaveCount(4);
  for (const link of await links.all())
    await expect(link).toHaveAttribute("href", "/app/billing");
});
test("public pages render without overflow or broken internal links", async ({
  page,
}, testInfo) => {
  for (const route of [
    "/",
    "/product",
    "/integrations",
    "/developers",
    "/pricing",
    "/docs",
    "/privacy",
    "/terms",
    "/security",
    "/contact",
    "/signin",
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, route).toBe(false);
    expect(await page.locator('a[href="#"]').count()).toBe(0);
  }
  await page.goto("/");
  await page.screenshot({
    path: `test-results/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("navigation is usable on a narrow viewport", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Product", exact: true })
    .click();
  await expect(page).toHaveURL(/\/product$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "worth remembering",
  );
});
