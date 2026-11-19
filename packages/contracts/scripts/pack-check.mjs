#!/usr/bin/env node
/* global console, process */
/**
 * pack-check.mjs — what `npm pack` would publish for @middag-io/ui-contracts.
 *
 * Fails when the tarball:
 * - misses an entry point of `exports` (dist/index, dist/types, dist/meta, the schemas);
 * - carries files outside dist/, schema/, README.md, LICENSE and package.json;
 * - mentions the premium schema host (pro-docs.middag.io) anywhere;
 * - declares a $def that is not in the mirrored FREE schemas;
 * - does not work from a clean install: the tarball is installed with zod from
 *   public npm in an empty directory, imported from Node ESM and type-checked
 *   with NodeNext resolution.
 *
 * Run after `npm run contracts:build` (from the repository root):
 *   node packages/contracts/scripts/pack-check.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(PACKAGE_DIR, "..", "..");
// Premium schema host; matched as text anywhere in the tarball, not as a URL.
const FORBIDDEN_HOST = "pro-docs.middag.io";
const FORBIDDEN = /pro-docs\.middag\.io/;
const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/types.js",
  "dist/types.d.ts",
  "dist/schemas.js",
  "dist/schemas.d.ts",
  "dist/meta.js",
  "dist/meta.d.ts",
  "schema/page-contract.json",
  "schema/fragment.json",
  "schema/SOURCE.json",
];
const ALLOWED = /^(dist\/[^/]+\.(js|d\.ts)|schema\/[^/]+\.json|README\.md|LICENSE|package\.json)$/;

// npm <= 11 prints an array of packs; npm 12 an object keyed by package name.
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
  }),
);
const [pack] = Array.isArray(packed) ? packed : Object.values(packed);
const files = pack.files.map((f) => f.path).sort();
const problems = [];

for (const path of REQUIRED) {
  if (!files.includes(path)) problems.push(`missing ${path}`);
}
for (const path of files) {
  if (!ALLOWED.test(path)) problems.push(`unexpected file ${path}`);
  const text = readFileSync(join(PACKAGE_DIR, path), "utf8");
  if (FORBIDDEN.test(text)) problems.push(`${path} mentions ${FORBIDDEN_HOST}`);
}

const mirrored = new Set();
for (const name of ["page-contract.json", "fragment.json"]) {
  const schema = JSON.parse(readFileSync(join(PACKAGE_DIR, "schema", name), "utf8"));
  for (const def of Object.keys(schema.$defs ?? {})) mirrored.add(def);
}
const declared = readFileSync(join(PACKAGE_DIR, "dist", "schemas.d.ts"), "utf8").matchAll(
  /export declare const (\w+)Schema\b/g,
);
for (const [, def] of declared) {
  if (!mirrored.has(def)) problems.push(`dist declares ${def}Schema, which no FREE schema defines`);
}

function consumerProblems() {
  const work = mkdtempSync(join(tmpdir(), "ui-contracts-consumer-"));
  try {
    const tarball = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
      }),
    );
    const [packedNow] = Array.isArray(tarball) ? tarball : Object.values(tarball);
    const consumer = join(work, "consumer");
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      '{ "name": "consumer", "private": true, "type": "module" }\n',
    );
    writeFileSync(
      join(consumer, ".npmrc"),
      "registry=https://registry.npmjs.org/\n@middag-io:registry=https://registry.npmjs.org/\n",
    );
    execFileSync(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        join(work, packedNow.filename),
        "zod@^4",
      ],
      { cwd: consumer, stdio: "inherit" },
    );
    writeFileSync(
      join(consumer, "runtime.mjs"),
      [
        'import { NavigationNodeSchema, pageContractSchemaCore, PageContractSchema, CONTRACT_VERSION } from "@middag-io/ui-contracts";',
        'import { createRequire } from "node:module";',
        "const require = createRequire(import.meta.url);",
        'const schema = require("@middag-io/ui-contracts/schemas/page-contract.json");',
        'const nested = { key: "a", label: "A", children: [{ key: "b", label: "B" }] };',
        "const ok = NavigationNodeSchema.safeParse(nested).success",
        '  && !NavigationNodeSchema.safeParse({ key: "a" }).success',
        "  && pageContractSchemaCore === PageContractSchema",
        "  && CONTRACT_VERSION === schema['x-contract-version'];",
        "if (!ok) { console.error('runtime smoke failed'); process.exit(1); }",
        "",
      ].join("\n"),
    );
    execFileSync("node", ["runtime.mjs"], { cwd: consumer, stdio: "inherit" });
    writeFileSync(
      join(consumer, "types.ts"),
      [
        'import type { PageContract, NavigationNode } from "@middag-io/ui-contracts/types";',
        'import { SCHEMA_HASH } from "@middag-io/ui-contracts/meta";',
        'export const node: NavigationNode = { key: "a", label: "A" };',
        'export const page: PageContract["page"] | undefined = undefined;',
        "export const hash: string = SCHEMA_HASH;",
        "",
      ].join("\n"),
    );
    execFileSync(
      "node",
      [
        join(REPO, "node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
        "--strict",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "types.ts",
      ],
      { cwd: consumer, stdio: "inherit" },
    );
    return [];
  } catch (error) {
    return [`clean install: ${error instanceof Error ? error.message.split("\n")[0] : error}`];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (problems.length === 0) problems.push(...consumerProblems());

if (problems.length) {
  console.error(`pack-check: ${pack.name}@${pack.version} FAILED`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`pack-check: ${pack.name}@${pack.version} OK (${files.length} files).`);
