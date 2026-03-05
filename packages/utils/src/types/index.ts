export * from "./constants.js";

export const SESSION_STATUS = {
  RUNNING: "running",
  DISCONNECTED: "disconnected",
  STOPPED: "stopped",
  ERROR: "error",
} as const;

export type SessionStatus =
  (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

export interface TerminalSessionMeta {
  id: string;
  userId: string;
  organizationId?: string | null;
  name: string;
  command: string;
  status: SessionStatus;
  encryptedSessionKey: string; // base64
  cols: number;
  rows: number;
  agentType?: string | null;
  machineId?: string | null;
  machineName?: string | null;
  createdAt: string; // ISO 8601
  endedAt: string | null;
  forwardedPorts?: string | null; // comma-separated: "3000,8080"
  snapshotSeq?: number | null;
  snapshotData?: string | null;
}

/**
 * Auto-detect AI agent type from a command string.
 * Returns null if no known agent is detected.
 */
export function detectAgentType(command: string): string | null {
  const cmd = command.toLowerCase();
  const agents: [string, string][] = [
    ["claude", "claude-code"],
    ["cursor", "cursor"],
    ["codex", "codex"],
    ["copilot", "copilot"],
    ["aider", "aider"],
    ["devin", "devin"],
    ["cline", "cline"],
    ["continue", "continue"],
  ];
  for (const [pattern, type] of agents) {
    if (cmd.includes(pattern)) return type;
  }
  return null;
}

export interface EncryptedChunk {
  sessionId: string;
  seq: number;
  data: string; // base64(nonce + ciphertext)
  timestamp: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CLIAuthTokens {
  token: string;
  userId: string;
}

export interface ResizeEvent {
  cols: number;
  rows: number;
}

export interface HttpTunnelRequest {
  reqId: string;
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string; // base64
}

export interface HttpTunnelResponse {
  reqId: string;
  status: number;
  headers: Record<string, string>;
  body?: string; // base64
}

export interface SpawnRequest {
  requestId: string;
  command: string;
  name: string;
  forwardedPorts?: number[];
}

export interface SpawnResponse {
  requestId: string;
  sessionId?: string;
  error?: string;
}

export interface MachineInfo {
  machineId: string;
  name: string;
}

export interface DaemonStatusResponse {
  online: boolean;
  machines: MachineInfo[];
}
