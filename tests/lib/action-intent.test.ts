import { describe, expect, it } from "vitest";

import { isDangerIntent } from "@/base/utils/action-intent";

describe("isDangerIntent", () => {
  it("is true for danger", () => {
    expect(isDangerIntent("danger")).toBe(true);
  });

  it("treats an unknown intent as destructive", () => {
    expect(isDangerIntent("nuke")).toBe(true);
  });

  it.each(["primary", "secondary", "success", "warning", "info", "link", "ghost"])(
    "is false for the known intent %s",
    (intent) => {
      expect(isDangerIntent(intent)).toBe(false);
    },
  );

  it("is false when no intent is given", () => {
    expect(isDangerIntent(undefined)).toBe(false);
    expect(isDangerIntent("")).toBe(false);
  });
});
