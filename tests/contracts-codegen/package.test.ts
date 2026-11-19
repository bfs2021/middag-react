import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  build,
  check,
  copyLocalSource,
  generate,
  sha256,
  writeSource,
} from "../../packages/contracts-codegen/lib/index.mjs";

const REPO = resolve(__dirname, "../..");
const FREE_ID = "https://ui-docs.middag.io/";

const schema = (id: string, defs: Record<string, unknown>, version = "1") =>
  JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: id,
      "x-contract-version": version,
      $defs: defs,
    },
    null,
    2,
  );

const dirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

/** A contracts package with one mirrored schema and a release provenance. */
function fixture(
  dir: string,
  defs: Record<string, unknown>,
  config: Record<string, unknown> = {},
  id = `${FREE_ID}schemas/a.json`,
) {
  const raw = schema(id, defs);
  writeFileSync(
    join(dir, "contracts.config.json"),
    JSON.stringify({
      packageName: "@test/contracts",
      schemas: ["a.json"],
      idPrefix: FREE_ID,
      forbiddenIds: ["https://pro-docs.middag.io/"],
      out: "src/generated",
      producer: "middag-io/ui",
      ...config,
    }),
  );
  mkdirSync(join(dir, "schema"), { recursive: true });
  writeFileSync(join(dir, "schema", "a.json"), raw);
  writeSource(dir, {
    repository: "middag-io/middag-php-ui",
    ref: "v1.0.0",
    sha: "abc",
    path: "schema",
    files: { "a.json": sha256(raw) },
  });
}

let dir: string;
beforeEach(() => {
  dir = tempDir("contracts-codegen-");
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("contracts package", () => {
  it("passes the drift gate after generate", async () => {
    fixture(dir, { Page: { type: "object", properties: { title: { type: "string" } } } });
    await generate(dir);
    expect(await check(dir)).toMatchObject({ ok: true, problems: [] });
    const meta = readFileSync(join(dir, "src/generated/meta.ts"), "utf8");
    expect(meta).toContain('"ref": "v1.0.0"');
    expect(meta).toContain('export const CONTRACT_VERSION = "1" as const;');
  });

  it("reports stale and orphaned output", async () => {
    fixture(dir, { Page: { type: "string" } });
    await generate(dir);
    writeFileSync(join(dir, "src/generated/types.ts"), "// edited");
    writeFileSync(join(dir, "src/generated/extra.ts"), "");
    expect((await check(dir)).problems).toEqual([
      "src/generated/types.ts is stale",
      "src/generated/extra.ts is orphaned",
    ]);
  });

  it("rejects a mirror that does not match SOURCE.json or came from a local directory", async () => {
    fixture(dir, { Page: { type: "string" } });
    writeFileSync(
      join(dir, "schema/a.json"),
      schema(`${FREE_ID}schemas/a.json`, { Page: { type: "integer" } }),
    );
    await generate(dir);
    expect((await check(dir)).problems).toContain(
      "schema/a.json does not match its hash in SOURCE.json",
    );

    const local = tempDir("contracts-local-");
    writeFileSync(
      join(local, "a.json"),
      schema(`${FREE_ID}schemas/a.json`, { Page: { type: "boolean" } }),
    );
    copyLocalSource(dir, local);
    await generate(dir);
    expect((await check(dir)).problems).toEqual([
      "schema/SOURCE.json has no repository, ref or sha (mirror written from a local --source)",
    ]);
  });

  it("refuses a schema of the other tier", async () => {
    fixture(
      dir,
      { Page: { type: "string" } },
      {},
      "https://pro-docs.middag.io/schemas/premium.json",
    );
    await expect(build(dir)).rejects.toThrow(/outside https:\/\/ui-docs\.middag\.io\//);
  });

  it("refuses a schema that mentions a forbidden $id", async () => {
    fixture(dir, {
      Page: { $ref: "https://pro-docs.middag.io/schemas/premium.json#/$defs/X" },
    });
    await expect(build(dir)).rejects.toThrow(/mentions https:\/\/pro-docs\.middag\.io\//);
  });

  it("refuses schemas with different contract versions or conflicting $defs", async () => {
    fixture(dir, { Page: { type: "string" } }, { schemas: ["a.json", "b.json"] });
    writeFileSync(join(dir, "schema/b.json"), schema(`${FREE_ID}schemas/b.json`, {}, "2"));
    await expect(build(dir)).rejects.toThrow(/x-contract-version differs/);
    writeFileSync(
      join(dir, "schema/b.json"),
      schema(`${FREE_ID}schemas/b.json`, { Page: { type: "integer" } }),
    );
    await expect(build(dir)).rejects.toThrow(/"Page" differs between schemas/);
  });

  it("fails when a $def name of a package it must stay disjoint with is redefined", async () => {
    const free = tempDir("contracts-free-");
    fixture(free, { Label: { type: "string" }, Page: { type: "string" } });
    fixture(
      dir,
      { Label: { type: "string" }, Panel: { type: "string" } },
      { idPrefix: "https://pro-docs.middag.io/", forbiddenIds: [], disjointWith: [free] },
      "https://pro-docs.middag.io/schemas/a.json",
    );
    await generate(dir);
    expect((await check(dir)).problems).toEqual([
      "$defs shared with @test/contracts: Label (reference them, do not redefine)",
    ]);
  });

  it("imports the types and schemas of a package it references", async () => {
    fixture(
      dir,
      {
        Panel: {
          type: "object",
          properties: {
            form: {
              $ref: "https://ui-docs.middag.io/schemas/page-contract.json#/$defs/FormSchemaNode",
            },
          },
        },
      },
      {
        idPrefix: "https://pro-docs.middag.io/",
        forbiddenIds: [],
        externals: { "https://ui-docs.middag.io/": "@middag-io/ui-contracts" },
      },
      "https://pro-docs.middag.io/schemas/a.json",
    );
    const { files } = await build(dir);
    expect(files["types.ts"]).toContain(
      'import type { FormSchemaNode } from "@middag-io/ui-contracts";',
    );
    expect(files["types.ts"]).toContain("form?: FormSchemaNode;");
    expect(files["schemas.ts"]).toContain(
      'import { FormSchemaNodeSchema } from "@middag-io/ui-contracts";',
    );
  });
});

describe("@middag-io/ui-contracts", () => {
  const FREE = join(REPO, "packages/contracts");

  it("is in sync with its mirror and its provenance", async () => {
    expect(await check(FREE)).toMatchObject({ ok: true, problems: [] });
  });

  it("exports a type and a zod schema for every $def, and the two legacy root names", async () => {
    const result = await build(FREE);
    for (const name of Object.keys(result.defs)) {
      expect(result.files["schemas.ts"]).toContain(`export const ${name}Schema`);
    }
    expect(result.files["schemas.ts"]).toContain(
      "export const pageContractSchemaCore = PageContractSchema;",
    );
    expect(result.files["schemas.ts"]).toContain(
      "export const fragmentSchemaCore = FragmentSchema;",
    );
  });

  it("is copied verbatim into the engine and the public schema mirror", () => {
    for (const name of ["types.ts", "schemas.ts"]) {
      expect(readFileSync(join(REPO, "src/contracts/generated", name), "utf8")).toBe(
        readFileSync(join(FREE, "src/generated", name), "utf8"),
      );
    }
    for (const name of ["page-contract.json", "fragment.json"]) {
      expect(readFileSync(join(REPO, "docs/public/schemas", name), "utf8")).toBe(
        readFileSync(join(FREE, "schema", name), "utf8"),
      );
    }
  });
});
