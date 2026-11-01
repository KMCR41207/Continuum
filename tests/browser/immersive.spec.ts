import { test, expect } from "@playwright/test";

test("AOS initializes on marketing routes and refreshes after React navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.text().includes("GSAP target")) errors.push(message.text());
  });
  for (const path of [
    "/",
    "/product",
    "/integrations",
    "/developers",
    "/pricing",
    "/docs",
  ]) {
    await page.goto(path);
    const target = page.locator(
      path === "/" ? ".hero-description" : ".inner-page > h1",
    );
    await expect(target).toHaveAttribute("data-aos", "fade-up");
    await expect(target).toHaveClass(/aos-init/);
    await target.scrollIntoViewIfNeeded();
    await expect(target).toHaveClass(/aos-animate/);
  }
  await page
    .locator(".site-footer")
    .getByRole("link", { name: "Product", exact: true })
    .click();
  await expect(page.locator(".inner-page > h1")).toHaveClass(/aos-animate/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page
        .locator(".inner-page > h1")
        .evaluate((n) => getComputedStyle(n).transform),
    )
    .toBe("none");
  expect(errors).toEqual([]);
});

test("memory core controls, rendering lifecycle and mobile alternative work", async ({
  page,
}, info) => {
  await page.goto("/");
  const core = page.locator(".hero .memory-core");
  await core.getByLabel("Sample project").selectOption("Studio");
  await expect(core.locator(".core-detail")).toContainText(
    "Studio scope selected",
  );
  await core.getByLabel("Inspect node").selectOption("claude");
  await expect(core.locator(".core-detail")).toContainText(
    "No live provider session verified",
  );
  await core.getByRole("button", { name: "store", exact: true }).click();
  await expect(
    core.getByRole("button", { name: "store", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  if (info.project.name === "mobile") {
    await expect(core.locator("canvas")).toHaveCount(0);
    await expect(
      core.getByRole("button", { name: "Enable interactive 3D" }),
    ).toBeVisible();
  } else {
    await expect(core.locator(".core-viewport")).toHaveAttribute(
      "data-scene-ready",
      "true",
      { timeout: 20000 },
    );
    const before = await core.locator("canvas").screenshot();
    await core.getByRole("button", { name: "Zoom into memory core" }).click();
    await expect
      .poll(async () =>
        Buffer.compare(before, await core.locator("canvas").screenshot()),
      )
      .not.toBe(0);
    const box = (await core.locator("canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, {
      steps: 8,
    });
    await page.mouse.up();
    await core.getByRole("button", { name: "Reset camera" }).click();
    // Exercise the actual raycaster via pointer hover and a real click, not the select alternative.
    const hit = await core.locator("canvas").evaluate(async (canvas) => {
      const rect = canvas.getBoundingClientRect();
      for (let y = rect.height * 0.22; y < rect.height * 0.8; y += 18) {
        for (let x = rect.width * 0.15; x < rect.width * 0.9; x += 18) {
          canvas.dispatchEvent(
            new PointerEvent("pointermove", {
              clientX: rect.x + x,
              clientY: rect.y + y,
              bubbles: true,
            }),
          );
          await new Promise(requestAnimationFrame);
          const label =
            canvas.parentElement?.querySelector(".core-hover")?.textContent ||
            "";
          if (label && !label.includes("Drag to orbit") && label !== "Claude")
            return { x: rect.x + x, y: rect.y + y, label };
        }
      }
      return null;
    });
    expect(hit).not.toBeNull();
    await page.mouse.click(hit!.x, hit!.y);
    await expect(
      core.getByLabel("Inspect node").locator("option:checked"),
    ).toHaveText(hit!.label);
    await page.screenshot({
      path: "test-results/immersive-core-desktop.png",
      scale: "css",
    });
    await page.locator(".site-footer").scrollIntoViewIfNeeded();
    await expect(core.locator(".core-viewport")).toHaveAttribute(
      "data-rendering",
      "paused",
    );
  }
  await page
    .getByRole("button", { name: "Reduce motion", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveCount(0);
  await core.getByRole("button", { name: "retrieve", exact: true }).click();
  await expect(core.locator(".core-static")).toContainText("RETRIEVE");
});

test("workflow progresses both ways, releases pinning, and permits swipe or keyboard access", async ({
  page,
}, info) => {
  await page.goto("/product");
  const workflow = page.getByRole("region", {
    name: "Conversation to retrieval workflow",
  });
  await workflow
    .getByRole("button", { name: "6. Retrieve", exact: true })
    .click();
  await expect(workflow.locator(".workflow-outcome")).toContainText("Retrieve");
  await expect(
    workflow.getByRole("article", { name: "Retrieve sample interface" }),
  ).toBeInViewport();
  await workflow
    .getByRole("button", { name: "2. Capture", exact: true })
    .click();
  await expect(workflow.locator(".workflow-outcome")).toContainText("Capture");
  if (info.project.name === "mobile") {
    await expect(workflow).not.toHaveAttribute("data-horizontal", "true");
    await workflow
      .locator(".workflow-track")
      .evaluate((n) =>
        n.scrollTo({ left: n.scrollWidth, behavior: "instant" }),
      );
    await expect(workflow.locator(".workflow-outcome")).toContainText(
      "Retrieve",
    );
  } else await expect(workflow).toHaveAttribute("data-horizontal", "true");
  await page.locator(".memory-spiral").scrollIntoViewIfNeeded();
  await expect(page.locator(".memory-spiral")).toBeInViewport();
  await page.getByRole("button", { name: /06 \/ Instructions/ }).click();
  await expect(page.locator(".spiral-inspector")).toContainText(
    "Studio accessibility checklist",
  );
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/immersive-product-${info.project.name}.png`,
    scale: "css",
  });
});

test("agent capability ring and MCP architecture expose truthful selected details", async ({
  page,
}, info) => {
  await page.goto("/integrations");
  await page
    .locator(".agent-ring")
    .getByRole("button", { name: "Codex", exact: true })
    .click();
  await expect(page.locator(".orbit-detail")).toContainText(
    "No live provider session is claimed",
  );
  await expect(page.locator(".orbit-detail h2")).toHaveText("Codex");
  await page.screenshot({
    path: `test-results/immersive-integrations-${info.project.name}.png`,
    scale: "css",
  });
  await page.goto("/developers");
  await page.getByRole("button", { name: /02 Authorization/ }).click();
  await expect(page.locator(".architecture-explorer > p")).toContainText(
    "token expiry, revocation",
  );
  await page
    .getByRole("region", { name: "MCP request workflow" })
    .getByRole("button", { name: "6. Retrieve" })
    .click();
  await expect(
    page.getByRole("article", { name: "Retrieve sample interface" }),
  ).toContainText("return { memories, sources, handoffs }");
});

test("unavailable WebGL keeps the memory model and controls usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: any[]
    ) {
      if (type.startsWith("webgl")) return null;
      return (original as any).call(this, type, ...args);
    } as typeof original;
  });
  await page.goto("/");
  const core = page.locator(".hero .memory-core");
  const enable = core.getByRole("button", { name: "Enable interactive 3D" });
  if (await enable.isVisible()) await enable.click();
  await expect(core.getByRole("status")).toContainText("3D is unavailable");
  await core.getByLabel("Inspect node").selectOption("decision");
  await expect(core.locator(".core-detail")).toContainText("PostgreSQL");
});
