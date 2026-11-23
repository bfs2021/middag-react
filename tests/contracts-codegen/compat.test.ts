import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  compareContracts,
  compat,
  enforcesBreaks,
} from "../../packages/contracts-codegen/lib/index.mjs";

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

  it("treats widening a $ref into an anyOf that keeps it as additive", () => {
    const a = contract({ S: obj({ errors: { $ref: "#/$defs/FormErrors" } }) });
    const b = contract({
      S: obj({
        errors: {
          description: "errors",
          anyOf: [{ $ref: "#/$defs/FormErrors" }, { $ref: "#/$defs/Bags" }],
        },
      }),
    });
    const report = compareContracts(a, b);
    expect(report).toMatchObject({ level: "additive", ok: true, breaks: [] });
    expect(report.additions).toContain("S.errors: $ref #/$defs/FormErrors widened to anyOf");
  });

  it("does not treat a $ref turned into a narrowing union as a widening", () => {
    const X = { $ref: "#/$defs/X" };
    const a = contract({ S: obj({ v: X }) });
    const shapes = [
      { oneOf: [X, { type: "object" }] },
      { oneOf: [X, X] },
      { anyOf: [X], type: "null" },
      { anyOf: [X], enum: [1] },
      { anyOf: [X, { type: "null" }], not: {} },
      { anyOf: [X, { type: "null" }], allOf: [{ type: "null" }] },
      { anyOf: [{ ...X, type: "null" }] },
    ];
    for (const shape of shapes) {
      const report = compareContracts(a, contract({ S: obj({ v: shape }) }), {
        producerTag: "v2.0.0",
      });
      expect(report.ok, JSON.stringify(shape)).toBe(false);
    }
  });

  it("still flags a $ref replaced by a union that drops it", () => {
    const a = contract({ S: obj({ errors: { $ref: "#/$defs/FormErrors" } }) });
    const b = contract({ S: obj({ errors: { anyOf: [{ $ref: "#/$defs/Bags" }] } }) });
    expect(compareContracts(a, b).ok).toBe(false);
  });

  describe("release-candidate gate", () => {
    const broken = contract({ Page: obj({}) });

    it("reports but does not refuse a break from a producer below 2.0.0-rc.1", () => {
      for (const tag of ["v1.14.0", "1.99.9", "v2.0.0-alpha.3", "v2.0.0-beta.1", "v2.0.0-rc.0"]) {
        const report = compareContracts(base, broken, { producerTag: tag });
        expect(report).toMatchObject({ level: "breaking", enforced: false, ok: true });
        expect(report.breaks).toContain("Old: $def removed");
      }
    });

    it("refuses a break from 2.0.0-rc.1 on", () => {
      for (const tag of [
        "v2.0.0-rc.1",
        "2.0.0-rc.2",
        "v2.0.0-rc.10",
        "v2.0.0",
        "v2.1.0",
        "v3.0.0-rc.1",
      ]) {
        expect(compareContracts(base, broken, { producerTag: tag })).toMatchObject({
          enforced: true,
          ok: false,
        });
      }
    });

    it("enforces when the producer tag is missing or unparseable", () => {
      expect(compareContracts(base, broken)).toMatchObject({ enforced: true, ok: false });
      for (const tag of ["", "main", "v1.14", "latest", "v2.0.0-RC.1", "v2.0.0-rc", "v2.0.0-0"]) {
        expect(enforcesBreaks(tag)).toBe(true);
      }
      for (const tag of ["v1.15.0-final", "v1.15.0-preview.1"]) {
        expect(enforcesBreaks(tag)).toBe(true);
      }
    });

    it("enforces when the base mirror already came from 2.0.0-rc.1 or later", () => {
      expect(
        compareContracts(base, broken, { producerTag: "v1.15.0", baseTag: "v2.0.0-rc.2" }),
      ).toMatchObject({ enforced: true, ok: false });
      expect(
        compareContracts(base, broken, { producerTag: "v1.15.0", baseTag: "v1.14.0" }),
      ).toMatchObject({ enforced: false, ok: true });
    });

    it("lets a version bump pass even when enforced", () => {
      expect(
        compareContracts(base, contract({ Page: obj({}) }, "2"), { producerTag: "v2.0.0" }).ok,
      ).toBe(true);
    });
  });

  describe("compat() reads the producer tags from SOURCE.json", () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });
    const schema = (defs: Record<string, unknown>) =>
      JSON.stringify({ "x-contract-version": "2", $defs: defs });
    const mirrorDir = (defs: Record<string, unknown>, ref?: string) => {
      const dir = mkdtempSync(join(tmpdir(), "compat-"));
      dirs.push(dir);
      writeFileSync(join(dir, "a.json"), schema(defs));
      if (ref) writeFileSync(join(dir, "SOURCE.json"), JSON.stringify({ ref }));
      return dir;
    };
    const pkg = (defs: Record<string, unknown>, ref?: string) => {
      const dir = mkdtempSync(join(tmpdir(), "compat-pkg-"));
      dirs.push(dir);
      writeFileSync(
        join(dir, "contracts.config.json"),
        JSON.stringify({
          packageName: "@test/contracts",
          schemas: ["a.json"],
          idPrefix: "https://ui-docs.middag.io/",
          out: "src/generated",
          producer: "middag-io/ui",
        }),
      );
      mkdirSync(join(dir, "schema"));
      writeFileSync(join(dir, "schema", "a.json"), schema(defs));
      if (ref) writeFileSync(join(dir, "schema", "SOURCE.json"), JSON.stringify({ ref }));
      return dir;
    };
    const before = { Page: obj({ a: { type: "string" } }), Gone: { type: "string" } };
    const after = { Page: obj({ a: { type: "string" } }) };

    it("reports a pre-rc break without failing", () => {
      const report = compat(pkg(after, "v1.14.0"), mirrorDir(before, "v1.13.1"));
      expect(report).toMatchObject({ level: "breaking", enforced: false, ok: true });
    });

    it("refuses a break from an rc producer", () => {
      const report = compat(pkg(after, "v2.0.0-rc.1"), mirrorDir(before, "v1.14.0"));
      expect(report).toMatchObject({ enforced: true, ok: false });
    });

    it("refuses a break against an rc base even from an older-line tag", () => {
      const report = compat(pkg(after, "v1.15.0"), mirrorDir(before, "v2.0.0-rc.1"));
      expect(report).toMatchObject({ enforced: true, ok: false });
    });

    it("stays strict without a SOURCE.json", () => {
      expect(compat(pkg(after), mirrorDir(before))).toMatchObject({ enforced: true, ok: false });
    });
  });
});
