"use client";

import { useState, useEffect } from "react";
import { urqlClient } from "@/lib/urql";
import { USER_KEYS_QUERY } from "@/lib/graphql-queries";
import { sealMessage, toBase64, fromBase64 } from "@anyterm/utils/crypto";
import type { MachineInfo } from "@anyterm/utils/types";

interface SpawnTerminalModalProps {
  machines: MachineInfo[];
  onClose: () => void;
  onSpawned: (sessionId: string) => void;
}

export function SpawnTerminalModal({ machines, onClose, onSpawned }: SpawnTerminalModalProps) {
  const [command, setCommand] = useState("");
  const [name, setName] = useState("");
  const [ports, setPorts] = useState("");
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select when only 1 machine
  useEffect(() => {
    if (machines.length === 1) {
      setSelectedMachineId(machines[0].machineId);
    }
  }, [machines]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Fetch user's publicKey for E2E encryption
      const keysResult = await urqlClient.query(USER_KEYS_QUERY, {}).toPromise();
      const publicKeyB64 = keysResult.data?.userKeys?.publicKey;
      if (!publicKeyB64) {
        setError("Could not load encryption keys");
        return;
      }
      const publicKey = fromBase64(publicKeyB64);

      // Parse forwarded ports
      const forwardedPorts = ports
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535);

      // Encrypt spawn parameters so the server never sees the command
      const spawnData = {
        command: command.trim() || "",
        name: name.trim() || undefined,
        ...(forwardedPorts.length > 0 ? { forwardedPorts } : {}),
      };
      const plaintext = new TextEncoder().encode(JSON.stringify(spawnData));
      const sealed = sealMessage(plaintext, publicKey);
      const encryptedPayload = toBase64(sealed);

      const res = await fetch("/api/daemon/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedPayload,
          targetMachineId: selectedMachineId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to spawn terminal");
        return;
      }

      onSpawned(data.sessionId);
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }

  const needsMachineSelection = machines.length > 1;
  const canSubmit = machines.length > 0 && (!needsMachineSelection || selectedMachineId !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800/60 bg-zinc-900/95 p-6 shadow-2xl shadow-black/40">
        <h3 className="font-display text-lg font-bold tracking-tight text-zinc-100">New Terminal</h3>
        <p className="mt-1 text-sm text-zinc-500">
          Spawn a terminal session on your local machine
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {machines.length === 0 ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-3 text-sm text-zinc-400">
              No machines online. Start a daemon first:{" "}
              <code className="font-code text-zinc-300">anyterm daemon</code>
            </div>
          ) : needsMachineSelection ? (
            <div>
              <label className="block text-sm font-medium text-zinc-300">
                Machine
              </label>
              <div className="mt-1.5 space-y-2">
                {machines.map((m) => (
                  <button
                    key={m.machineId}
                    type="button"
                    onClick={() => setSelectedMachineId(m.machineId)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      selectedMachineId === m.machineId
                        ? "border-green-500/50 bg-green-500/10 text-zinc-100"
                        : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="ml-auto shrink-0 font-code text-xs text-zinc-500">
                      {m.machineId.slice(0, 8)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <label htmlFor="command" className="block text-sm font-medium text-zinc-300">
              Command{" "}
              <span className="text-zinc-500">(optional)</span>
            </label>
            <input
              id="command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              placeholder="Leave empty for interactive shell"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-zinc-300">
              Session Name{" "}
              <span className="text-zinc-500">(optional)</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              placeholder="Defaults to command name"
            />
          </div>

          <div>
            <label htmlFor="ports" className="block text-sm font-medium text-zinc-300">
              Forward Ports{" "}
              <span className="text-zinc-500">(optional)</span>
            </label>
            <input
              id="ports"
              type="text"
              value={ports}
              onChange={(e) => setPorts(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              placeholder="e.g. 3000, 8080"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-50"
            >
              {loading ? "Spawning..." : "Spawn Terminal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
