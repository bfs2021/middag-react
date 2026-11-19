import { describe, expect, it } from "vitest";

import { compareContracts } from "../../packages/contracts-codegen/lib/index.mjs";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});
const contract = (defs: Record<string, unknown>, version = "1") => ({ version, defs });

describe("compareContracts", () => {
  const base = contract({
    Page: obj(
      { title: { type: "string" }, kind: { enum: ["a", "b"] }, size: { type: "integer" } },
      ["title"],
    ),
    Old: { type: "string" },
  });

  it("reports identical contracts as none", () => {
    expect(compareContracts(base, base)).toMatchObject({ level: "none", ok: true, breaks: [] });
  });

  it("treats a description-only change as a patch", () => {
    const next = structuredClone(base);
    (next.defs.Old as Record<string, unknown>).description = "now documented";
    expect(compareContracts(base, next).level).toBe("patch");
  });

  it("treats new defs, optional fields and enum values as additive", () => {
    const next = contract({
      Page: obj(
        {
          title: { type: "string" },
          kind: { enum: ["a", "b", "c"] },
          size: { type: "integer" },
          note: { type: "string" },
        },
        ["title"],
      ),
      Old: { type: "string" },
      New: { type: "boolean" },
    });
    const report = compareContracts(base, next);
    expect(report).toMatchObject({ level: "additive", ok: true, breaks: [] });
    expect(report.additions).toEqual(
      expect.arrayContaining([
        'Page.kind: enum value "c" added',
        "Page.note: optional property added",
        "New: $def added",
      ]),
    );
  });

  it("flags removals, new required fields and narrowed types", () => {
    const next = contract({
      Page: obj(
        {
          title: { type: "boolean" },
          kind: { enum: ["a"] },
          size: { type: "integer" },
          owner: { type: "string" },
        },
        ["title", "size", "owner"],
      ),
    });
    const report = compareContracts(base, next);
    expect(report.level).toBe("breaking");
    expect(report.ok).toBe(false);
    expect(report.breaks).toEqual(
      expect.arrayContaining([
        "Old: $def removed",
        'Page.title: type "string" removed',
        'Page.kind: enum value "b" removed',
        "Page.size: became required",
        "Page.owner: new required property",
      ]),
    );
  });

  it("accepts a breaking change that bumps x-contract-version", () => {
    const next = contract({ Page: obj({}) }, "2");
    expect(compareContracts(base, next)).toMatchObject({
      level: "breaking",
      versionBumped: true,
      ok: true,
    });
  });

  it("flags a $ref that points elsewhere and a lost union branch", () => {
    const a = contract({ X: { oneOf: [{ $ref: "#/$defs/A" }, { $ref: "#/$defs/B" }] } });
    const b = contract({ X: { oneOf: [{ $ref: "#/$defs/C" }] } });
    expect(compareContracts(a, b).breaks).toEqual([
      "X: oneOf lost 1 branch(es)",
      "X.oneOf[0]: $ref #/$defs/A -> #/$defs/C",
    ]);
  });
});
