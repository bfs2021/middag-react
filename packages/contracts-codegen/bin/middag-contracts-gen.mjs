#!/usr/bin/env node
/* global console, process */
/**
 * middag-contracts-gen — generate and gate a MIDDAG contracts package.
 *
 *   middag-contracts-gen [generate] [--package <dir>] [--source <dir>]
 *   middag-contracts-gen check [--package <dir>]
 *   middag-contracts-gen compat --base <dir> [--package <dir>]
 *   middag-contracts-gen mirror --repository <owner/name> --ref <tag> [--path schema] [--package <dir>]
 *   middag-contracts-gen verify-source [--package <dir>]
 *
 * --package defaults to the current directory. --source is for local
 * development only: it overwrites the mirror and marks it local, which `check`
 * rejects. `mirror` and `verify-source` read GITHUB_TOKEN when set.
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

import { check, compat, copyLocalSource, generate, mirror, verifySource } from "../lib/index.mjs";

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("--") ? argv.shift() : "generate";

function option(name) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);
  return value;
}

function fail(message) {
  console.error(`middag-contracts-gen: ${message}`);
  process.exit(1);
}

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function printReport(report) {
  console.log(
    `compat: ${report.level}${report.versionBumped ? " (x-contract-version bumped)" : ""}`,
  );
  for (const line of report.breaks) console.log(`  breaking: ${line}`);
  if (report.breaks.length && !report.enforced)
    console.log("  (reported only: the producer tag is below the rc gate)");
  for (const line of report.additions) console.log(`  additive: ${line}`);
}

const packageDir = resolve(option("package") ?? ".");
const token = process.env.GITHUB_TOKEN || undefined;

try {
  switch (command) {
    case "generate": {
      const source = option("source");
      if (source) {
        console.warn(
          "\n" +
            "  ************************************************************\n" +
            `  * LOCAL SOURCE: mirroring schemas from ${source}\n` +
            "  * schema/SOURCE.json is now marked local; `check` fails until\n" +
            "  * the mirror comes from a producer release (`mirror`).\n" +
            "  ************************************************************\n",
        );
        copyLocalSource(packageDir, resolve(source));
      }
      const result = await generate(packageDir);
      console.log(
        `middag-contracts-gen: wrote ${Object.keys(result.files).length} files to ${result.config.out} ` +
          `(contract v${result.version}, hash ${result.hash}, ${Object.keys(result.defs).length} defs).`,
      );
      break;
    }
    case "check": {
      if (option("source")) fail("check reads the mirror only; --source is not allowed");
      const result = await check(packageDir);
      if (!result.ok) {
        console.error("middag-contracts-gen check: FAILED");
        for (const p of result.problems) console.error(`  - ${p}`);
        console.error("Run `npm run gen` (or mirror a producer release) and commit the result.");
        process.exit(1);
      }
      console.log(
        `middag-contracts-gen check: OK (contract v${result.version}, hash ${result.hash}).`,
      );
      break;
    }
    case "compat": {
      const base = option("base") ?? fail("compat needs --base <dir>");
      const report = compat(packageDir, resolve(base));
      printReport(report);
      output("level", report.level);
      if (!report.ok) {
        console.error(
          "middag-contracts-gen compat: breaking change without an x-contract-version bump.",
        );
        process.exit(1);
      }
      break;
    }
    case "mirror": {
      const repository = option("repository") ?? fail("mirror needs --repository <owner/name>");
      const ref = option("ref") ?? fail("mirror needs --ref <tag>");
      const result = await mirror(packageDir, { repository, ref, path: option("path"), token });
      if (!result.changed) {
        console.log(
          `middag-contracts-gen mirror: ${repository}@${ref} carries the same schemas; nothing to do.`,
        );
        output("changed", "false");
        break;
      }
      output("changed", "true");
      const level = result.report?.level ?? "additive";
      output("level", level);
      output("ok", String(result.report?.ok ?? true));
      if (result.report) printReport(result.report);
      await generate(packageDir);
      console.log(`middag-contracts-gen mirror: mirrored ${repository}@${ref} and regenerated.`);
      break;
    }
    case "verify-source": {
      const result = await verifySource(packageDir, { token });
      if (!result.ok) {
        console.error("middag-contracts-gen verify-source: FAILED");
        for (const p of result.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log("middag-contracts-gen verify-source: mirror matches the producer release.");
      break;
    }
    default:
      fail(`unknown command "${command}"`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
