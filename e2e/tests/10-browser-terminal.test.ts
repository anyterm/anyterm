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
 * Playwright browser tests verifying the full user-facing flow:
 *
 * 1. Login form → masterKey stored in sessionStorage → redirect to dashboard
 * 2. Dashboard shows session card with name and status
 * 3. Session page renders xterm.js with decrypted replayed chunks
 * 4. Live session: CLI output appears in browser terminal in real-time
 * 5. Browser typing sends encrypted input to CLI via WebSocket
 */

// Helper: read terminal buffer content via xterm's buffer API
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

// Helper: wait for terminal buffer to contain text
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
  // Return whatever we have for assertion message
  return readTerminalBuffer(page);
}

describe("Browser Terminal Rendering", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let user: RegisteredUser;
  let baseUrl: string;

  // Session with pre-stored chunks (for replay test)
  let replaySessionId: string;
  let replaySessionKey: Uint8Array;
  const replayLines = ["$ echo hello", "hello", "$ "];

  // Live session (for real-time output + input test)
  let liveSessionId: string;
  let liveSessionKey: Uint8Array;
  let cliWs: WsClient;

  beforeAll(async () => {
    baseUrl = getEnv().baseUrl;

    // 1. Launch browser
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    // 2. Register user via API
    user = await registerUser();

    const api = new ApiClient(user.cookieToken);

    // 3. Create replay session with pre-stored encrypted chunks
    replaySessionKey = await generateSessionKey();
    const replayEncSk = await encryptSessionKey(
      replaySessionKey,
      user.publicKey,
    );
    const replayResult = await api.createSession({
      name: "replay-test-session",
      command: "echo hello",
      encryptedSessionKey: toBase64(replayEncSk),
      cols: 80,
      rows: 24,
    });
    replaySessionId = (replayResult.body.data as Record<string, string>).id;

    // Store encrypted chunks for replay
    const replayChunks = await Promise.all(
      replayLines.map(async (line, i) => {
        const encrypted = await encryptChunk(
          new TextEncoder().encode(line),
          replaySessionKey,
        );
        return { seq: i + 1, data: toBase64(encrypted) };
      }),
    );
    await api.storeChunks(replaySessionId, replayChunks);

    // Mark replay session as stopped
    await api.updateSession(replaySessionId, {
      status: "stopped",
      endedAt: new Date().toISOString(),
    });

    // 4. Create live session + CLI WS client
    liveSessionKey = await generateSessionKey();
    const liveEncSk = await encryptSessionKey(liveSessionKey, user.publicKey);
    const liveResult = await api.createSession({
      name: "live-test-session",
      command: "bash",
      encryptedSessionKey: toBase64(liveEncSk),
      cols: 80,
      rows: 24,
    });
    liveSessionId = (liveResult.body.data as Record<string, string>).id;

    // Connect CLI WS for the live session
    cliWs = new WsClient();
    await cliWs.connect(user.token, "cli");
    cliWs.send(createSubscribeFrame(liveSessionId));
    await new Promise((r) => setTimeout(r, 300));
  }, 60_000);

  afterAll(async () => {
    cliWs?.close();
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  it("logs in via browser form and redirects to dashboard", async () => {
    await browserLogin(page, baseUrl, user.email, user.password);

    expect(page.url()).toContain("/dashboard");
  }, 45_000);

  it("dashboard shows both session cards", async () => {
    // Wait for sessions to load
    await page.waitForSelector("text=replay-test-session", { timeout: 15_000 });

    // Check both sessions are visible
    expect(await page.locator("text=replay-test-session").first().isVisible()).toBe(true);
    expect(await page.locator("text=live-test-session").first().isVisible()).toBe(true);

    // Live session should show LIVE badge
    expect(await page.locator("text=LIVE").first().isVisible()).toBe(true);
  }, 20_000);

  it("session page renders terminal with decrypted replayed chunks", async () => {
    // Navigate to the replay session (with retry)
    await navigateToSession(page, baseUrl, replaySessionId);

    // Wait for terminal buffer to contain our replayed text
    const content = await waitForTerminalContent(page, "hello", 15_000);

    // Verify all replayed lines are present
    expect(content).toContain("$ echo hello");
    expect(content).toContain("hello");
  }, 45_000);

  it("live session: CLI output appears in browser terminal", async () => {
    // Navigate to live session (with retry)
    await navigateToSession(page, baseUrl, liveSessionId);

    // Wait for the browser's WS connection to be established
    // The browser fetches /api/ws-token, then connects to the WS server
    await page.waitForTimeout(3_000);

    // CLI sends encrypted output
    const outputText = "browser-render-test: live output from CLI";
    const encrypted = await encryptChunk(
      new TextEncoder().encode(outputText),
      liveSessionKey,
    );
    cliWs.send(createEncryptedChunkFrame(liveSessionId, encrypted));

    // Wait for the text to appear in the terminal buffer
    const content = await waitForTerminalContent(page, "live output from CLI", 20_000);

    expect(content).toContain(outputText);
  }, 45_000);

  it("browser typing sends encrypted input to CLI", async () => {
    // Should still be on the live session page
    // Record the current frame count so we only look at new frames
    const framesBefore = cliWs.receivedFrames.length;

    // Focus the terminal
    await page.click(".xterm");
    await page.waitForTimeout(500);

    // Type some text
    const inputText = "test-input";
    await page.keyboard.type(inputText);

    // Wait for frames to arrive
    await new Promise((r) => setTimeout(r, 3_000));

    // Collect all ENCRYPTED_INPUT frames received after typing
    const inputFrames = cliWs.receivedFrames
      .slice(framesBefore)
      .filter((f) => f.type === FrameType.ENCRYPTED_INPUT);

    // Decrypt and concatenate all input frames
    let received = "";
    for (const frame of inputFrames) {
      const decrypted = await decryptChunk(frame.payload, liveSessionKey);
      received += new TextDecoder().decode(decrypted);
    }

    expect(received).toContain(inputText);
  }, 20_000);
});
