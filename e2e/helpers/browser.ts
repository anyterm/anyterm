import type { Page } from "playwright";

/**
 * Navigate to a session page and wait for the xterm terminal to render.
 * Retries with page reload if the terminal doesn't appear within the initial timeout.
 * This handles flaky dev-server responses under sustained test-suite load.
 */
export async function navigateToSession(
  page: Page,
  baseUrl: string,
  sessionId: string,
  opts?: { maxAttempts?: number; xtermTimeout?: number },
): Promise<void> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const xtermTimeout = opts?.xtermTimeout ?? 30_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt === 1) {
      await page.goto(`${baseUrl}/s/${sessionId}`);
    } else {
      // Retry: reload the page
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    try {
      await page.waitForSelector(".xterm", { timeout: xtermTimeout });
      return; // Success
    } catch {
      if (attempt === maxAttempts) {
        // Final attempt failed — capture diagnostics and throw
        const bodyText = await page
          .evaluate(() => document.body?.innerText?.substring(0, 500) ?? "")
          .catch(() => "(could not read body)");
        const url = page.url();
        throw new Error(
          `.xterm not visible after ${maxAttempts} attempts (${xtermTimeout}ms each). ` +
          `URL: ${url}, Body: ${bodyText}`,
        );
      }
    }
  }
}

/**
 * Login via browser form and wait for dashboard redirect.
 */
export async function browserLogin(
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}
