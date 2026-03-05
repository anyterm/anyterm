import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getConfig } from "../config.js";

/** Whether this org is the user's personal org (slug matches userId). */
export function isPersonalOrg(slug: string, userId: string): boolean {
  return slug === userId;
}

/** Return a display badge for the org (" (Personal)" or ""). */
export function orgBadge(slug: string, userId: string): string {
  return isPersonalOrg(slug, userId) ? " (Personal)" : "";
}

/** Validate a 1-based numeric selection. Returns 0-based index or null. */
export function validateSwitchIndex(answer: string, orgCount: number): number | null {
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= orgCount) return null;
  return idx;
}

export const orgCommand = new Command("org")
  .description("Manage organizations");

orgCommand
  .command("list")
  .description("List your organizations")
  .action(async () => {
    const { serverUrl, authToken, userId } = await getConfig();

    const res = await fetch(
      `${serverUrl}/api/auth/organization/list`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );

    if (!res.ok) {
      console.error("Failed to list organizations:", res.statusText);
      process.exit(1);
    }

    const orgs = await res.json();

    if (!orgs || orgs.length === 0) {
      console.log("No organizations found.");
      return;
    }

    console.log("\nOrganizations:\n");
    for (const org of orgs) {
      const badge = orgBadge(org.slug, userId);
      console.log(`  ${org.name}${badge}`);
      console.log(`    Slug: ${org.slug}`);
      console.log(`    ID:   ${org.id}`);
      console.log();
    }
  });

orgCommand
  .command("current")
  .description("Show currently active organization")
  .action(async () => {
    const { serverUrl, authToken, userId } = await getConfig();

    const res = await fetch(
      `${serverUrl}/api/auth/organization/get-active-organization`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );

    if (!res.ok) {
      console.error("Failed to get active organization:", res.statusText);
      process.exit(1);
    }

    const org = await res.json();
    if (!org) {
      console.log("No active organization. Run: anyterm org switch");
      return;
    }

    console.log(`Active: ${org.name}${orgBadge(org.slug, userId)}`);
    console.log(`  Slug: ${org.slug}`);
    console.log(`  ID:   ${org.id}`);
  });

orgCommand
  .command("switch")
  .description("Switch active organization")
  .action(async () => {
    const { serverUrl, authToken, userId } = await getConfig();

    const res = await fetch(
      `${serverUrl}/api/auth/organization/list`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );

    if (!res.ok) {
      console.error("Failed to list organizations:", res.statusText);
      process.exit(1);
    }

    const orgs = await res.json();
    if (!orgs || orgs.length === 0) {
      console.log("No organizations found.");
      return;
    }

    console.log("\nSelect an organization:\n");
    for (let i = 0; i < orgs.length; i++) {
      const org = orgs[i];
      console.log(`  [${i + 1}] ${org.name}${orgBadge(org.slug, userId)}`);
    }
    console.log();

    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = await rl.question("Enter number: ");
      const idx = validateSwitchIndex(answer, orgs.length);

      if (idx === null) {
        console.error("Invalid selection");
        process.exit(1);
      }

      const selected = orgs[idx];
      const setRes = await fetch(
        `${serverUrl}/api/auth/organization/set-active`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ organizationId: selected.id }),
        },
      );

      if (!setRes.ok) {
        console.error("Failed to switch organization:", setRes.statusText);
        process.exit(1);
      }

      console.log(`Switched to: ${selected.name}`);
    } finally {
      rl.close();
    }
  });
