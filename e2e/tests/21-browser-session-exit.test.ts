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
  createSessionEndedFrame,
  createUnsubscribeFrame,
} from "../helpers/crypto.js";

/**
 * Playwright browser tests for session exit UI behavior:
 *
 * When a CLI/daemon sends SESSION_ENDED (PTY process exited):
 * 1. Terminal shows "--- Session ended ---" message
 * 2. Status badge changes from "running" to "stopped"
 * 3. After CLI_DISCONNECTED, input is blocked
 */

/** Read terminal buffer content via xterm's buffer API */
async function readTerminalBuffer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const term = (window as any).__xterm;
    if (!term) return "";
    let content = "";
    for (let i = 0; i < term.buffer.active.length; i++) {
      const line = term.buffer.active.getLine(i);
      if (line) content += line.translateToString().trimEnd() + "\n";
    }
    return content.trim();
  });
}

/** Poll the status badge text until it matches the expected value */
async function waitForBadgeText(
  page: Page,
  expected: string,
  timeout = 10_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const text = await page
      .locator('[data-testid="session-status"]')
      .textContent()
      .catch(() => null);
    if (text?.trim() === expected) return text.trim();
    await page.waitForTimeout(200);
  }
  const final = await page
    .locator('[data-testid="session-status"]')
    .textContent()
    .catch(() => "");
  return final?.trim() ?? "";
}

/** Wait for terminal buffer to contain specific text */
async function waitForTerminalContent(
  page: Page,
  text: string,
  timeout = 15_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const content = await readTerminalBuffer(page);
    if (content.includes(text)) return content;
    await page.waitForTimeout(300);
  }
  return readTerminalBuffer(page);
}

describe("Browser Session Exit UI", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let user: RegisteredUser;
  let api: ApiClient;
  let baseUrl: string;

  let sessionId: string;
  let sessionKey: Uint8Array;
  let cliWs: WsClient;

  beforeAll(async () => {
    baseUrl = getEnv().baseUrl;

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    user = await registerUser();
    api = new ApiClient(user.cookieToken);

    // Create live session
    sessionKey = await generateSessionKey();
    const encSk = await encryptSessionKey(sessionKey, user.publicKey);
    const result = await api.createSession({
      name: "exit-ui-test",
      command: "bash",
      encryptedSessionKey: toBase64(encSk),
      cols: 80,
      rows: 24,
    });
    sessionId = (result.body.data as Record<string, string>).id;

    // Connect CLI WS
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    // Log in via browser
    await browserLogin(page, baseUrl, user.email, user.password);

    // Navigate to the live session (with retry)
    await navigateToSession(page, baseUrl, sessionId);

    // Wait for browser WS to establish
    await page.waitForTimeout(3_000);

    // Verify connection works by sending initial output
    const initChunk = await encryptChunk(
      new TextEncoder().encode("$ ready\r\n"),
      sessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(sessionId, initChunk));
    await page.waitForTimeout(1_000);
  }, 90_000);

  afterAll(async () => {
    cliWs?.close();
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  it("status badge shows 'running' before session ends", async () => {
    const badgeText = await waitForBadgeText(page, "running");
    expect(badgeText).toBe("running");
  }, 15_000);

  it("terminal shows '--- Session ended ---' when CLI sends SESSION_ENDED", async () => {
    // Send some final output before ending
    const finalChunk = await encryptChunk(
      new TextEncoder().encode("goodbye\r\n"),
      sessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(sessionId, finalChunk));
    await page.waitForTimeout(500);

    // CLI sends SESSION_ENDED + UNSUBSCRIBE (simulating PTY exit)
    cliWs.send(createSessionEndedFrame(sessionId));
    cliWs.send(createUnsubscribeFrame(sessionId));

    // Wait for "--- Session ended ---" to appear in terminal buffer
    const content = await waitForTerminalContent(
      page,
      "--- Session ended ---",
      10_000,
    );
    expect(content).toContain("--- Session ended ---");
  }, 20_000);

  it("status badge changes to 'stopped' after SESSION_ENDED", async () => {
    // Badge should already be 'stopped' from the previous test
    const badgeText = await waitForBadgeText(page, "stopped", 10_000);
    expect(badgeText).toBe("stopped");
  }, 15_000);

  it("final output before SESSION_ENDED is visible in terminal", async () => {
    const content = await readTerminalBuffer(page);
    expect(content).toContain("goodbye");
  }, 10_000);
});
