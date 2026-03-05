import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { registerUser, type RegisteredUser } from "../helpers/auth.js";
import { getEnv } from "../helpers/env.js";
import { ApiClient } from "../helpers/api-client.js";
import { WsClient } from "../helpers/ws-client.js";
import { browserLogin, navigateToSession } from "../helpers/browser.js";
import {
  generateSessionKey,
  encryptSessionKey,
  encryptChunk,
  toBase64,
  createSubscribeFrame,
  createEncryptedChunkFrame,
} from "../helpers/crypto.js";

/**
 * Browser E2E tests for session notifications:
 *
 * When a terminal program emits standard notification signals (BEL, OSC 9,
 * OSC 777) or the session ends (SESSION_ENDED frame), the browser should
 * show toast notifications and flash the tab title.
 *
 * Uses the /session/:id route (like test 10) which now wires notification
 * callbacks through useSessionNotifications.
 */

// Helper: wait for a toast element containing specific text
async function waitForToast(
  page: Page,
  text: string,
  timeout = 10_000,
): Promise<boolean> {
  try {
    await page.waitForSelector(`text=${text}`, { timeout });
    return true;
  } catch {
    return false;
  }
}

describe("Browser Notifications", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let user: RegisteredUser;
  let api: ApiClient;
  let baseUrl: string;

  // Live session shared across tests
  let liveSessionId: string;
  let liveSessionKey: Uint8Array;
  let cliWs: WsClient;

  beforeAll(async () => {
    baseUrl = getEnv().baseUrl;

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      permissions: ["notifications"],
    });
    page = await context.newPage();

    // Register user
    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    // Create a live session
    liveSessionKey = await generateSessionKey();
    const encSk = await encryptSessionKey(liveSessionKey, user.publicKey);
    const result = await api.createSession({
      name: "notif-test-session",
      command: "bash",
      encryptedSessionKey: toBase64(encSk),
      cols: 80,
      rows: 24,
    });
    liveSessionId = (result.body.data as Record<string, string>).id;

    // Connect CLI WS
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(liveSessionId));
    await new Promise((r) => setTimeout(r, 300));

    // Log in via browser
    await browserLogin(page, baseUrl, user.email, user.password);

    // Navigate to the live session page (with retry)
    await navigateToSession(page, baseUrl, liveSessionId);

    // Wait for browser WS to connect
    await page.waitForTimeout(3_000);

    // Verify the connection works by sending a chunk
    const initChunk = await encryptChunk(
      new TextEncoder().encode("$ ready\r\n"),
      liveSessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(liveSessionId, initChunk));
    await page.waitForTimeout(1_000);
  }, 90_000);

  afterAll(async () => {
    cliWs?.close();
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  it("BEL character triggers notification toast", async () => {
    // Send encrypted chunk containing BEL character (\x07)
    const bellChunk = await encryptChunk(
      new TextEncoder().encode("task complete\x07"),
      liveSessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(liveSessionId, bellChunk));

    // Verify toast appears
    const toastFound = await waitForToast(page, "Bell", 10_000);
    expect(toastFound).toBe(true);
  }, 30_000);

  it("OSC 9 escape sequence triggers notification toast", async () => {
    // Wait for previous toast to dismiss
    await page.waitForTimeout(6_000);

    // Send encrypted chunk with OSC 9: \e]9;Build finished\a
    const osc9Chunk = await encryptChunk(
      new TextEncoder().encode("\x1b]9;Build finished\x07"),
      liveSessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(liveSessionId, osc9Chunk));

    // Verify toast appears with OSC 9 message
    const toastFound = await waitForToast(page, "Build finished", 10_000);
    expect(toastFound).toBe(true);
  }, 30_000);

  it("OSC 777 escape sequence triggers notification toast", async () => {
    // Wait for previous toast to dismiss
    await page.waitForTimeout(6_000);

    // Send encrypted chunk with OSC 777: \e]777;notify;CI;Pipeline passed\a
    const osc777Chunk = await encryptChunk(
      new TextEncoder().encode("\x1b]777;notify;CI;Pipeline passed\x07"),
      liveSessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(liveSessionId, osc777Chunk));

    // Verify toast appears with body from OSC 777
    const toastFound = await waitForToast(page, "Pipeline passed", 10_000);
    expect(toastFound).toBe(true);
  }, 30_000);

  it("notification flashes the tab title", async () => {
    // Wait for previous toasts to clear
    await page.waitForTimeout(6_000);

    // Record original title
    const originalTitle = await page.evaluate(() => document.title);

    // Send BEL to trigger notification (which also flashes title)
    const bellChunk = await encryptChunk(
      new TextEncoder().encode("\x07"),
      liveSessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(liveSessionId, bellChunk));

    // Wait for title to change
    await page.waitForTimeout(1_500);
    const newTitle = await page.evaluate(() => document.title);

    // Title should have changed to include "anyterm"
    expect(newTitle).toContain("anyterm");
  }, 30_000);

  it("SESSION_ENDED frame shows toast notification", async () => {
    // Wait for previous toasts to clear
    await page.waitForTimeout(6_000);

    // Delete the session via API — this publishes SESSION_ENDED to Redis event channel,
    // which the WS relay forwards to the browser
    await api.deleteSession(liveSessionId);

    // Verify toast appears with "has ended" text
    const toastFound = await waitForToast(page, "has ended", 10_000);
    expect(toastFound).toBe(true);
  }, 30_000);
});
