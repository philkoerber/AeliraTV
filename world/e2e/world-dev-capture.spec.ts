import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Requires a **Vite dev** web build (`import.meta.env.DEV`) so dev access is allowed.
 * Skips on production `vite build` output (e.g. CI static preview) where `__AELIRA_DEV__` is absent.
 */
test("world dev: captureScreenshot from world coordinates", async ({ page }) => {
  await page.goto("/?dev=1");

  await page.getByPlaceholder("Your name").fill("DevE2E");
  await page.getByRole("button", { name: "Enter" }).click();

  await expect(page.getByText("WASD to move")).toBeVisible({ timeout: 90_000 });

  await page.waitForFunction(() => Boolean(window.__AELIRA_DEV__?.captureScreenshot), null, {
    timeout: 30_000
  });

  const dataUrl = await page.evaluate(() => {
    const api = window.__AELIRA_DEV__;
    if (!api) return null;
    return api.captureScreenshot({
      position: { x: 14, z: 10 },
      lookAt: { x: 0, z: 0 },
      fov: 50
    });
  });

  expect(dataUrl).toBeTruthy();
  expect(dataUrl!.startsWith("data:image/png;base64,")).toBe(true);

  const b64 = dataUrl!.split(",")[1];
  const buf = Buffer.from(b64, "base64");
  expect(buf.length).toBeGreaterThan(5_000);

  const outDir = path.join(process.cwd(), "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "dev-coordinate-capture.png");
  fs.writeFileSync(outPath, buf);
});
