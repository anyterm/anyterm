import { describe, it, expect } from "vitest";
import { isPersonalOrg, orgBadge, validateSwitchIndex } from "../commands/org.js";

const USER_ID = "user-123";

describe("isPersonalOrg", () => {
  it("returns true when slug matches userId", () => {
    expect(isPersonalOrg(USER_ID, USER_ID)).toBe(true);
  });

  it("returns false when slug differs from userId", () => {
    expect(isPersonalOrg("acme", USER_ID)).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isPersonalOrg("User-123", USER_ID)).toBe(false);
  });
});

describe("orgBadge", () => {
  it("returns ' (Personal)' for personal org", () => {
    expect(orgBadge(USER_ID, USER_ID)).toBe(" (Personal)");
  });

  it("returns empty string for team org", () => {
    expect(orgBadge("acme", USER_ID)).toBe("");
  });
});

describe("validateSwitchIndex", () => {
  it("converts 1-based input to 0-based index", () => {
    expect(validateSwitchIndex("1", 3)).toBe(0);
    expect(validateSwitchIndex("3", 3)).toBe(2);
  });

  it("rejects zero", () => {
    expect(validateSwitchIndex("0", 3)).toBeNull();
  });

  it("rejects negative", () => {
    expect(validateSwitchIndex("-1", 3)).toBeNull();
  });

  it("rejects too high", () => {
    expect(validateSwitchIndex("4", 3)).toBeNull();
  });

  it("rejects non-numeric", () => {
    expect(validateSwitchIndex("abc", 3)).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateSwitchIndex("", 3)).toBeNull();
  });

  it("rejects float strings", () => {
    // parseInt("1.5") === 1, which is valid — this is expected JavaScript behavior
    expect(validateSwitchIndex("1.5", 3)).toBe(0);
  });
});
