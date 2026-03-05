"use client";

import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { FormBanner } from "@/components/ui/form-banner";

export function TeamSection({ orgId, userId }: { orgId: string; userId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [memberList, setMemberList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMembers();
  }, [orgId]);

  async function loadMembers() {
    setLoading(true);
    try {
      const result = await (authClient as any).organization.getFullOrganization({
        organizationId: orgId,
      });
      setMemberList(result.data?.members ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    try {
      const result = await (authClient as any).organization.inviteMember({
        email,
        role,
        organizationId: orgId,
      });
      if (result.error) {
        setInviteError(result.error.message || "Failed to invite");
        return;
      }
      setInviteSuccess(`Invitation sent to ${email}`);
      setEmail("");
      setTimeout(() => setInviteSuccess(""), 3000);
    } catch {
      setInviteError("Failed to invite member");
    }
  }

  async function handleRemove(memberId: string) {
    try {
      await (authClient as any).organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: orgId,
      });
      await loadMembers();
    } catch {
      // ignore
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
      <h3 className="mb-4 font-medium">Team Members</h3>

      {loading ? (
        <div className="text-sm text-zinc-500">Loading members...</div>
      ) : (
        <div className="mb-4 space-y-2">
          {memberList.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-2.5">
              <div>
                <span className="text-sm">{m.user?.name || m.user?.email || "Unknown"}</span>
                <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                  {m.role}
                </span>
              </div>
              {m.role !== "owner" && m.userId !== userId && (
                <button
                  onClick={() => handleRemove(m.id)}
                  className="text-xs text-red-400 transition hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleInvite} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-zinc-600"
          required
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-zinc-300"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200"
        >
          Invite
        </button>
      </form>

      {inviteError && (
        <FormBanner variant="error" className="mt-2">{inviteError}</FormBanner>
      )}
      {inviteSuccess && (
        <FormBanner variant="success" className="mt-2">{inviteSuccess}</FormBanner>
      )}
    </section>
  );
}
