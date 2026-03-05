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
  decryptChunk,
  toBase64,
  createSubscribeFrame,
  createEncryptedChunkFrame,
  FrameType,
} from "../helpers/crypto.js";

/**
 * Playwright browser tests for CLI presence UI behavior:
 *
 * 1. Status badge shows "running" when CLI is connected
 * 2. Status badge changes to "disconnected" (yellow) when CLI disconnects
 * 3. CLI reconnect restores "running" status
 * 4. Browser keyboard input is blocked when CLI is disconnected
 */

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
  // Return whatever we have for the assertion error message
  const final = await page
    .locator('[data-testid="session-status"]')
    .textContent()
    .catch(() => "");
  return final?.trim() ?? "";
}

describe("Browser CLI Presence UI", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let user: RegisteredUser;
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
    const api = new ApiClient(user.cookieToken);

    // Create live session
    sessionKey = await generateSessionKey();
    const encSk = await encryptSessionKey(sessionKey, user.publicKey);
    const result = await api.createSession({
      name: "presence-ui-test",
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
  }, 60_000);

  afterAll(async () => {
    cliWs?.close();
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  it("logs in and navigates to session", async () => {
    await browserLogin(page, baseUrl, user.email, user.password);
    await navigateToSession(page, baseUrl, sessionId);

    // Wait for browser WS to establish
    await page.waitForTimeout(3_000);
  }, 120_000);

  it("shows 'running' status when CLI is connected", async () => {
    const badgeText = await waitForBadgeText(page, "running");
    expect(badgeText).toBe("running");
  }, 15_000);

  it("shows 'disconnected' status when CLI disconnects", async () => {
    // Disconnect CLI
    cliWs.close();

    const badgeText = await waitForBadgeText(page, "disconnected");
    expect(badgeText).toBe("disconnected");
  }, 15_000);

  it("does not relay keyboard input when CLI is disconnected", async () => {
    // Reconnect a fresh CLI WS to observe frames, but subscribe to a DIFFERENT
    // purpose — we'll use a separate WS client as observer
    // Actually, let's just connect a new CLI, track frames, type, and verify no input arrives

    // Connect observer CLI (not subscribed yet — just to have a token-valid WS)
    const observerCli = new WsClient();
    await observerCli.connect(user.token, "cli");
    observerCli.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 300));

    // Note initial frame count
    const framesBefore = observerCli.receivedFrames.length;

    // Disconnect the observer so there's no CLI
    observerCli.close();
    await new Promise((r) => setTimeout(r, 500));

    // Focus terminal and type
    await page.click(".xterm");
    await page.waitForTimeout(300);
    await page.keyboard.type("blocked-input");

    // Wait a bit for any frames to arrive
    await new Promise((r) => setTimeout(r, 2_000));

    // Reconnect an observer to check — no ENCRYPTED_INPUT should have been relayed
    // Since there's no CLI connected, the browser should not have sent anything.
    // We verify by reconnecting a CLI and checking it has no pending input frames.
    const checkCli = new WsClient();
    await checkCli.connect(user.token, "cli");
    checkCli.send(createSubscribeFrame(sessionId));
    await new Promise((r) => setTimeout(r, 1_000));

    const inputFrames = checkCli.receivedFrames.filter(
      (f) => f.type === FrameType.ENCRYPTED_INPUT,
    );

    // No input frames should have been relayed since the browser blocks sending
    expect(inputFrames).toHaveLength(0);

    checkCli.close();
  }, 20_000);

  it("restores 'running' status when CLI reconnects", async () => {
    // Reconnect CLI
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(sessionId));

    const badgeText = await waitForBadgeText(page, "running");
    expect(badgeText).toBe("running");
  }, 15_000);

  it("keyboard input works again after CLI reconnects", async () => {
    // Record frame count before typing
    const framesBefore = cliWs.receivedFrames.length;

    // Focus and type
    await page.click(".xterm");
    await page.waitForTimeout(500);
    await page.keyboard.type("alive-input");

    // Wait for frames
    await new Promise((r) => setTimeout(r, 3_000));

    // Collect ENCRYPTED_INPUT frames
    const inputFrames = cliWs.receivedFrames
      .slice(framesBefore)
      .filter((f) => f.type === FrameType.ENCRYPTED_INPUT);

    // Decrypt and concatenate
    let received = "";
    for (const frame of inputFrames) {
      const decrypted = await decryptChunk(frame.payload, sessionKey);
      received += new TextDecoder().decode(decrypted);
    }

    expect(received).toContain("alive-input");
  }, 20_000);

  it("CLI output still renders after reconnect", async () => {
    // CLI sends some output
    const outputText = "presence-ui: output after reconnect";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(outputText),
      sessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(sessionId, encrypted));

    // Wait for it to appear in terminal buffer
    const start = Date.now();
    let content = "";
    while (Date.now() - start < 15_000) {
      content = await page.evaluate(() => {
        const term = (window as any).__xterm;
        if (!term) return "";
        let text = "";
        for (let i = 0; i < term.buffer.active.length; i++) {
          const line = term.buffer.active.getLine(i);
          if (line) text += line.translateToString().trimEnd() + "\n";
        }
        return text.trim();
      });
      if (content.includes("output after reconnect")) break;
      await page.waitForTimeout(300);
    }

    expect(content).toContain(outputText);
  }, 20_000);
});
