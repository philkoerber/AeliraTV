import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("world: join, WebGL canvas, screenshot artifact", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Enter" }).click();

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 90_000 });

  await page.waitForFunction(
    () => {
      const el = document.querySelector("canvas");
      if (!el) return false;
      const gl2 = el.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
      const gl = gl2 ?? el.getContext("webgl", { failIfMajorPerformanceCaveat: false });
      return !!gl;
    },
    { timeout: 30_000 }
  );

  await new Promise((r) => setTimeout(r, 750));

  const outDir = path.join(process.cwd(), "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const screenshotPath = path.join(outDir, "screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const stat = fs.statSync(screenshotPath);
  expect(stat.size).toBeGreaterThan(2_000);
});
