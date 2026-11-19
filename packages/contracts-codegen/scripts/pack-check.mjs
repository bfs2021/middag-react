#!/usr/bin/env node
/* global console, process */
/**
 * pack-check.mjs — the @middag-io/ui-contracts-codegen tarball works on its own.
 *
 * 1. `npm pack` must hold exactly bin/, lib/, README.md, LICENSE and package.json.
 * 2. The tarball is installed in an empty directory from public npm (no
 *    repository node_modules to lean on) and its CLI generates and checks a
 *    small contracts package.
 *
 * Run from the repository root: node packages/contracts-codegen/scripts/pack-check.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "bin/middag-contracts-gen.mjs",
  "lib/index.mjs",
  "lib/index.d.mts",
  "lib/zod.mjs",
  "lib/compat.mjs",
];
const ALLOWED = /^(bin\/[^/]+\.mjs|lib\/[^/]+\.(mjs|d\.mts)|README\.md|LICENSE|package\.json)$/;

const problems = [];
const work = mkdtempSync(join(tmpdir(), "contracts-codegen-pack-"));

try {
  // npm <= 11 prints an array of packs; npm 12 an object keyed by package name.
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
    }),
  );
  const [pack] = Array.isArray(packed) ? packed : Object.values(packed);
  const files = pack.files.map((f) => f.path).sort();
  for (const path of REQUIRED) if (!files.includes(path)) problems.push(`missing ${path}`);
  for (const path of files) if (!ALLOWED.test(path)) problems.push(`unexpected file ${path}`);

  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{ "name": "consumer", "private": true }\n');
  writeFileSync(join(consumer, ".npmrc"), "registry=https://registry.npmjs.org/\n");
  execFileSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", join(work, pack.filename)],
    { cwd: consumer, stdio: "inherit" },
  );

  const fixture = join(consumer, "contracts");
  mkdirSync(join(fixture, "schema"), { recursive: true });
  const raw = JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://ui-docs.middag.io/schemas/sample.json",
    "x-contract-version": "1",
    $defs: {
      Node: {
        type: "object",
        required: ["key"],
        properties: {
          key: { type: "string" },
          children: { type: "array", items: { $ref: "#/$defs/Node" } },
        },
      },
    },
  });
  writeFileSync(join(fixture, "schema", "sample.json"), raw);
  writeFileSync(
    join(fixture, "schema", "SOURCE.json"),
    JSON.stringify({
      repository: "middag-io/middag-php-ui",
      ref: "v0.0.0",
      sha: "0".repeat(40),
      path: "schema",
      files: { "sample.json": createHash("sha256").update(raw).digest("hex") },
    }),
  );
  writeFileSync(
    join(fixture, "contracts.config.json"),
    JSON.stringify({
      schemas: ["sample.json"],
      idPrefix: "https://ui-docs.middag.io/",
      out: "src/generated",
      producer: "middag-io/ui",
    }),
  );
  const bin = join(consumer, "node_modules", ".bin", "middag-contracts-gen");
  execFileSync(bin, ["--package", fixture], { stdio: "inherit" });
  execFileSync(bin, ["check", "--package", fixture], { stdio: "inherit" });
  const zod = readFileSync(join(fixture, "src", "generated", "schemas.ts"), "utf8");
  if (!zod.includes("export const NodeSchema: z.ZodType<Node>")) {
    problems.push("the installed CLI did not emit the recursive NodeSchema");
  }
  if (problems.length === 0)
    console.log(`pack-check: ${pack.name}@${pack.version} OK (${files.length} files).`);
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (problems.length) {
  console.error("pack-check: @middag-io/ui-contracts-codegen FAILED");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
