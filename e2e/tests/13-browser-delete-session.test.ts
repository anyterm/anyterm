import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { getEnv } from "../helpers/env.js";
import { ApiClient } from "../helpers/api-client.js";
import { WsClient } from "../helpers/ws-client.js";
import { browserLogin } from "../helpers/browser.js";
import {
  generateSessionKey,
  encryptSessionKey,
  toBase64,
  createSubscribeFrame,
  FrameType,
} from "../helpers/crypto.js";

/**
 * Browser E2E tests for the delete session feature:
 *
 * 1. Delete button appears on session cards
 * 2. Clicking delete shows confirmation, cancel dismisses it
 * 3. Confirming delete removes session from dashboard
 * 4. Deleting a live session sends SESSION_ENDED to CLI
 */

describe("Browser Delete Session", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let user: RegisteredUser;
  let api: ApiClient;
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = getEnv().baseUrl;

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    // Log in via browser
    await browserLogin(page, baseUrl, user.email, user.password);
  }, 60_000);

  afterAll(async () => {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  async function createSession(name: string, status: "running" | "stopped" = "stopped") {
    const sessionKey = await generateSessionKey();
    const encSk = await encryptSessionKey(sessionKey, user.publicKey);
    const result = await api.createSession({
      name,
      command: "test-cmd",
      encryptedSessionKey: toBase64(encSk),
    });
    const id = (result.body.data as Record<string, string>).id;

    if (status === "stopped") {
      await api.updateSession(id, {
        status: "stopped",
        endedAt: new Date().toISOString(),
      });
    }

    return { id, sessionKey };
  }

  /** Find the session card row that contains the given session name */
  function findSessionCard(name: string) {
    // Each card is a direct child div with flex layout inside the grid
    // Use the font-medium span for the session name to anchor, then go up to the card root
    return page.locator(`div.grid > div`).filter({ hasText: name }).first();
  }

  it("shows delete button on session cards", async () => {
    await createSession("delete-btn-test");

    await page.goto(`${baseUrl}/dashboard`);
    await page.waitForSelector("text=delete-btn-test", { timeout: 15_000 });

    const card = findSessionCard("delete-btn-test");
    const deleteBtn = card.getByRole("button", { name: "Delete" });
    expect(await deleteBtn.isVisible()).toBe(true);
  }, 30_000);

  it("cancel dismisses confirmation without deleting", async () => {
    await createSession("cancel-test");

    await page.goto(`${baseUrl}/dashboard`);
    await page.waitForSelector("text=cancel-test", { timeout: 15_000 });

    const card = findSessionCard("cancel-test");

    // Click Delete
    await card.getByRole("button", { name: "Delete" }).click();

    // Confirm and Cancel buttons should appear
    await page.waitForSelector("button:has-text('Confirm')", { timeout: 5_000 });
    expect(await card.getByRole("button", { name: "Confirm" }).isVisible()).toBe(true);
    expect(await card.getByRole("button", { name: "Cancel" }).isVisible()).toBe(true);

    // Click Cancel
    await card.getByRole("button", { name: "Cancel" }).click();

    // Session should still be visible
    await page.waitForTimeout(500);
    expect(await page.locator("text=cancel-test").first().isVisible()).toBe(true);
  }, 30_000);

  it("confirming delete removes session from dashboard", async () => {
    const { id } = await createSession("confirm-delete-test");

    await page.goto(`${baseUrl}/dashboard`);
    await page.waitForSelector("text=confirm-delete-test", { timeout: 15_000 });

    const card = findSessionCard("confirm-delete-test");

    // Click Delete then Confirm
    await card.getByRole("button", { name: "Delete" }).click();
    await card.getByRole("button", { name: "Confirm" }).click();

    // Wait and refresh to confirm it's gone
    await page.waitForTimeout(2_000);
    await page.goto(`${baseUrl}/dashboard`);
    await page.waitForTimeout(3_000);

    const visible = await page.locator("text=confirm-delete-test").isVisible();
    expect(visible).toBe(false);

    // Verify via API
    const { status } = await api.getSession(id);
    expect(status).toBe(404);
  }, 30_000);

  it("deleting a live session notifies CLI with SESSION_ENDED", async () => {
    const { id } = await createSession("live-delete-test", "running");

    // Connect CLI WS
    const cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(id));
    await new Promise((r) => setTimeout(r, 500));

    // Navigate to dashboard and delete
    await page.goto(`${baseUrl}/dashboard`);
    await page.waitForSelector("text=live-delete-test", { timeout: 15_000 });

    const card = findSessionCard("live-delete-test");
    await card.getByRole("button", { name: "Delete" }).click();
    await card.getByRole("button", { name: "Confirm" }).click();

    // CLI should receive SESSION_ENDED
    const ended = await cliWs.waitForMessage(
      (f) => f.type === FrameType.SESSION_ENDED,
      10_000,
    );
    expect(ended).toBeTruthy();
    expect(ended!.sessionId).toBe(id);

    cliWs.close();
  }, 45_000);
});
