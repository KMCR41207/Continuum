import { test, expect, type Page } from "@playwright/test";

async function tickerX(page: Page) {
  return page
    .locator(".ticker-track")
    .evaluate(
      (node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41,
    );
}

test("scroll-linked motion follows reading direction without capturing scrolling", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect
    .poll(() => page.locator(".ticker-track").getAttribute("style"))
    .toContain("transform");
  const initial = await tickerX(page);
  await page.locator("#how-it-works").evaluate((node) =>
    window.scrollTo({
      top: node.getBoundingClientRect().top + scrollY + 120,
      behavior: "instant",
    }),
  );
  await expect.poll(() => tickerX(page)).toBeLessThan(initial - 10);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect
    .poll(async () => Math.abs((await tickerX(page)) - initial))
    .toBeLessThan(1);
  await page.locator("#remember").evaluate((node) =>
    window.scrollTo({
      top: node.getBoundingClientRect().top + scrollY - innerHeight * 0.3,
      behavior: "instant",
    }),
  );
  await expect(
    page
      .getByRole("navigation", { name: "Memory lifecycle" })
      .getByRole("link", { name: "03 Remember" }),
  ).toHaveAttribute("aria-current", "step");
  expect(await page.locator(".story-chapter").count()).toBe(4);
  expect(errors).toEqual([]);
});

test("reduced motion persists and the system preference overrides full effects", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Reduce motion", exact: true })
    .click();
  await expect(page.locator(".public-site")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  await expect
    .poll(() =>
      page
        .locator(".ticker-track")
        .evaluate((node) => getComputedStyle(node).transform),
    )
    .toBe("none");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe("auto");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable full motion" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Enable full motion" }).click();
  await expect(page.locator(".public-site")).toHaveAttribute(
    "data-motion",
    "full",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("button", { name: "Motion reduced by system" }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page
        .locator(".ticker-track")
        .evaluate((node) => getComputedStyle(node).transform),
    )
    .toBe("none");
  await page
    .getByRole("button", { name: "Capture conversation", exact: true })
    .click();
  await expect(page.getByText("Captured with source evidence")).toBeVisible();
});

test("anchors, menu keyboard control and route re-entry preserve a usable page", async ({
  page,
}, testInfo) => {
  await page.goto("/product");
  if (testInfo.project.name === "mobile") {
    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.click();
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
  }
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "How it works" })
    .click();
  await expect(page).toHaveURL(/\/#how-it-works$/);
  await expect
    .poll(() =>
      page
        .locator("#how-it-works")
        .evaluate((node) => node.getBoundingClientRect().top),
    )
    .toBeLessThan(250);
  await page
    .getByRole("navigation", { name: "Memory lifecycle" })
    .getByRole("link", { name: "04 Reuse" })
    .click();
  await expect
    .poll(() =>
      page
        .locator("#reuse")
        .evaluate((node) => node.getBoundingClientRect().top),
    )
    .toBeLessThan(260);
  await page.getByRole("link", { name: "Continuum home" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
});

test("animation download failure leaves all content and demo controls usable", async ({
  page,
}) => {
  await page.route("**/src/lib/editorialMotion.ts*", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page
    .getByRole("button", { name: "Capture conversation", exact: true })
    .click();
  await expect(page.getByText("Captured with source evidence")).toBeVisible();
  await page.locator("#reuse").scrollIntoViewIfNeeded();
  await expect(page.locator("#reuse")).toBeVisible();
  expect(
    await page
      .locator(".ticker-track")
      .evaluate((node) => getComputedStyle(node).transform),
  ).toBe("none");
});

test("responsive layouts remain within the viewport at narrow, tablet and wide sizes", async ({
  page,
}, testInfo) => {
  const widths =
    testInfo.project.name === "mobile" ? [320, 390] : [768, 1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".hero-description")
          .evaluate((node) => getComputedStyle(node).opacity),
      )
      .toBe("1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Overflow at ${width}px`,
    ).toBe(true);
    await page.screenshot({ path: `test-results/editorial-${width}-hero.png` });
    await page.locator("#remember").evaluate((node) =>
      window.scrollTo({
        top: node.getBoundingClientRect().top + scrollY - 180,
        behavior: "instant",
      }),
    );
    await expect(page.locator("#remember")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Scrolled overflow at ${width}px`,
    ).toBe(true);
    await page.screenshot({
      path: `test-results/editorial-${width}-story.png`,
    });
  }
});
