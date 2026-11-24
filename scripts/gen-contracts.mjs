#!/usr/bin/env node
/* global console, process */
/**
 * gen-contracts.mjs — contract codegen for @middag-io/react.
 *
 * The wire contract is owned by packages/contracts (@middag-io/ui-contracts):
 * its schema/ directory mirrors a middag-php-ui release, and
 * packages/contracts-codegen generates the TypeScript types and zod schemas
 * from that mirror. Until the engine depends on the published package, it
 * carries a copy of the generated sources in src/contracts/generated/, and
 * docs/public/schemas/ carries a copy of the wire schemas (MCP bundle and
 * public schema subpath).
 *
 * Usage:
 *   node scripts/gen-contracts.mjs                 regenerate the package and the copies
 *   node scripts/gen-contracts.mjs --check         drift gate (exit 1 if anything is stale)
 *   node scripts/gen-contracts.mjs --mirror <tag>  mirror a middag-php-ui release, then regenerate
 *
 * --mirror reads GITHUB_TOKEN when set and, in GitHub Actions, writes
 * `changed`, `level` and `ok` to GITHUB_OUTPUT (`npm run contracts:mirror -- vX.Y.Z`).
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { check, generate, mirror } from "../packages/contracts-codegen/lib/index.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = join(REPO, "packages", "contracts");
const ENGINE_DIR = join(REPO, "src", "contracts", "generated");
const DOCS_SCHEMA_DIR = join(REPO, "docs", "public", "schemas");
const CHECK = process.argv.includes("--check");
const MIRROR_AT = process.argv.indexOf("--mirror");
const MIRROR_REF = MIRROR_AT >= 0 ? process.argv[MIRROR_AT + 1] : undefined;
const PRODUCER_REPOSITORY = "middag-io/middag-php-ui";

const COPIED = ["types.ts", "schemas.ts"];
const SCHEMAS = ["page-contract.json", "fragment.json", "shared-props.json"];

function engineFiles() {
  const generated = join(PACKAGE_DIR, "src", "generated");
  const files = Object.fromEntries(
    COPIED.map((name) => [name, readFileSync(join(generated, name), "utf8")]),
  );
  const banner = readFileSync(join(generated, "index.ts"), "utf8").split("*/\n")[0] + "*/\n";
  files["index.ts"] =
    banner +
    [
      'export * from "./types.js";',
      'export { pageContractSchemaCore, fragmentSchemaCore, sharedPropsSchemaCore } from "./schemas.js";',
      "",
    ].join("\n");
  return files;
}

function schemaCopies() {
  return Object.fromEntries(
    SCHEMAS.map((name) => [name, readFileSync(join(PACKAGE_DIR, "schema", name), "utf8")]),
  );
}

function readDir(dir, suffix) {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(suffix))
      .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
  );
}

if (CHECK) {
  const result = await check(PACKAGE_DIR);
  const problems = result.problems.map((p) => `packages/contracts: ${p}`);
  if (result.ok) {
    const existing = readDir(ENGINE_DIR, ".ts");
    const expected = engineFiles();
    for (const [name, content] of Object.entries(expected)) {
      if (existing[name] !== content) problems.push(`src/contracts/generated/${name} is stale`);
    }
    for (const name of Object.keys(existing)) {
      if (!(name in expected)) problems.push(`src/contracts/generated/${name} is orphaned`);
    }
    for (const [name, content] of Object.entries(schemaCopies())) {
      const path = join(DOCS_SCHEMA_DIR, name);
      if (!existsSync(path) || readFileSync(path, "utf8") !== content) {
        problems.push(`docs/public/schemas/${name} differs from packages/contracts/schema/${name}`);
      }
    }
  }
  if (problems.length) {
    console.error("gen-contracts --check: generated contracts are STALE:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Run `npm run gen:contracts` and commit the result.");
    process.exit(1);
  }
  console.log(`gen-contracts --check: OK (hash ${result.hash}, contract v${result.version}).`);
} else {
  if (MIRROR_AT >= 0) {
    if (!MIRROR_REF || !/^v\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$/.test(MIRROR_REF)) {
      console.error(
        "gen-contracts: --mirror needs a release tag (vX.Y.Z or vX.Y.Z-alpha|beta|rc.N).",
      );
      process.exit(1);
    }
    const output = (key, value) => {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    };
    const mirrored = await mirror(PACKAGE_DIR, {
      repository: PRODUCER_REPOSITORY,
      ref: MIRROR_REF,
      token: process.env.GITHUB_TOKEN || undefined,
    });
    output("changed", String(mirrored.changed));
    if (!mirrored.changed) {
      console.log(`gen-contracts: ${PRODUCER_REPOSITORY}@${MIRROR_REF} carries the same schemas.`);
      process.exit(0);
    }
    const report = mirrored.report;
    output("level", report?.level ?? "additive");
    output("ok", String(report?.ok ?? true));
    if (report) {
      console.log(
        `compat: ${report.level}${report.versionBumped ? " (x-contract-version bumped)" : ""}`,
      );
      for (const line of report.breaks) console.log(`  breaking: ${line}`);
      if (report.breaks.length && !report.enforced)
        console.log("  (reported only: the producer tag is below the rc gate)");
      for (const line of report.additions) console.log(`  additive: ${line}`);
    }
  }
  const result = await generate(PACKAGE_DIR);
  mkdirSync(ENGINE_DIR, { recursive: true });
  const expected = engineFiles();
  for (const name of Object.keys(readDir(ENGINE_DIR, ".ts"))) {
    if (!(name in expected)) rmSync(join(ENGINE_DIR, name));
  }
  for (const [name, content] of Object.entries(expected)) {
    writeFileSync(join(ENGINE_DIR, name), content);
  }
  mkdirSync(DOCS_SCHEMA_DIR, { recursive: true });
  for (const [name, content] of Object.entries(schemaCopies())) {
    writeFileSync(join(DOCS_SCHEMA_DIR, name), content);
  }
  console.log(
    `gen-contracts: regenerated packages/contracts and the engine copy ` +
      `(hash ${result.hash}, contract v${result.version}).`,
  );
}
