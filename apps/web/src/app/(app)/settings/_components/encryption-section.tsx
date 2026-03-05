"use client";

export function EncryptionSection() {
  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
      <h3 className="mb-4 font-medium">Encryption</h3>
      <p className="text-sm text-zinc-400">
        Your encryption keys are derived from your password. The server never
        sees your plaintext terminal data. All session content is encrypted with
        XChaCha20-Poly1305 before leaving your device.
      </p>
    </section>
  );
}
