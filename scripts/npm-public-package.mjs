#!/usr/bin/env node
/**
 * Public npm package staging + guard.
 *
 * The release publishes @middag-io/react twice: to GitHub Packages straight
 * from the repository, and to registry.npmjs.org from a staging directory
 * (the source manifest carries publishConfig.registry = GitHub Packages, so
 * the public copy needs its own manifest). The public copy must stay
 * installable on its own: same dependencies, same files, same exports.
 *
 *   stage <outDir>
 *     Packs the source package (honours `files` and .npmignore, exactly like
 *     the GitHub Packages publish), extracts it into <outDir> and rewrites
 *     its package.json with toPublicManifest().
 *
 *   verify <stageDir>
 *     Packs <stageDir> (as `npm publish` would) and runs the check below on
 *     that tarball against the repository package.json.
 *
 *   check <tarball> [sourcePackageJson]
 *     Reads package/package.json out of a packed tarball and fails when any
 *     consumer-facing field differs from the source manifest, or when a
 *     static `exports` target is missing from the tarball.
 *
 * Only two fields are removed on purpose (DROPPED_FIELDS): publishConfig
 * (it would route the public publish back to GitHub Packages) and scripts
 * (lifecycle hooks such as `prepare` need the git checkout and repo tooling).
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DROPPED_FIELDS = ["publishConfig", "scripts"];

export const GUARDED_FIELDS = [
  "name",
  "version",
  "type",
  "license",
  "engines",
  "bin",
  "main",
  "module",
  "types",
  "exports",
  "files",
  "dependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

/** Returns a new manifest for the public npm copy (input is not mutated). */
export function toPublicManifest(pkg) {
  return Object.fromEntries(Object.entries(pkg).filter(([key]) => !DROPPED_FIELDS.includes(key)));
}

/** Deterministic JSON (sorted object keys) so key order never counts as a difference. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Lists the guarded fields whose values differ between the two manifests. */
export function diffManifests(source, packed) {
  return GUARDED_FIELDS.filter((field) => canonical(source[field]) !== canonical(packed[field]));
}

function collectTargets(node, out) {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => collectTargets(child, out));
  } else if (node && typeof node === "object") {
    Object.values(node).forEach((child) => collectTargets(child, out));
  }
  return out;
}

/**
 * Static (non-wildcard) export targets missing from the tarball file list.
 * Wildcard targets must at least have their directory prefix present.
 */
export function missingExportTargets(exportsField, files) {
  const present = new Set(files.map((f) => f.replace(/^\.\//, "")));
  const targets = [...new Set(collectTargets(exportsField, []))];
  return targets.filter((target) => {
    const rel = target.replace(/^\.\//, "");
    if (!rel.includes("*")) return !present.has(rel);
    const prefix = rel.slice(0, rel.indexOf("*"));
    return ![...present].some((f) => f.startsWith(prefix));
  });
}

function readPackedManifest(tarball) {
  return JSON.parse(
    execFileSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" }),
  );
}

function listTarball(tarball) {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ""));
}

/** Throws when the packed tarball drifts from the source manifest. */
export function checkTarball(tarball, sourcePackageJson) {
  const source = JSON.parse(readFileSync(sourcePackageJson, "utf8"));
  const packed = readPackedManifest(tarball);
  const problems = [];
  for (const field of diffManifests(source, packed)) {
    problems.push(`package.json field "${field}" differs from the source manifest`);
  }
  for (const target of missingExportTargets(packed.exports ?? {}, listTarball(tarball))) {
    problems.push(`exports target ${target} is not in the tarball`);
  }
  if (problems.length) {
    throw new Error(problems.map((p) => `    ${p}`).join("\n"));
  }
  return {
    dependencies: Object.keys(packed.dependencies ?? {}).length,
    peerDependencies: Object.keys(packed.peerDependencies ?? {}).length,
  };
}

/**
 * Runs `npm pack` for cwd into the empty packDir and returns the tarball path.
 * The tarball is found on disk instead of parsing `npm pack --json`, whose
 * shape changed between npm 11 (array) and npm 12 (object keyed by name).
 */
export function packInto(cwd, packDir) {
  // --silent drops the per-file "npm notice" listing; errors still throw with stderr.
  execFileSync("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", packDir], {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`expected one tarball from npm pack in ${packDir}, found ${tarballs.length}`);
  }
  return join(packDir, tarballs[0]);
}

/** Packs the source package and extracts it into outDir with the public manifest. */
export function stagePublicPackage(sourceDir, outDir) {
  const packDir = mkdtempSync(join(tmpdir(), "npm-public-pack-"));
  try {
    const tarball = packInto(sourceDir, packDir);
    mkdirSync(outDir, { recursive: true });
    execFileSync("tar", ["-xzf", tarball, "-C", outDir, "--strip-components=1"]);
    const source = JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8"));
    writeFileSync(
      join(outDir, "package.json"),
      `${JSON.stringify(toPublicManifest(source), null, 2)}\n`,
    );
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

/** Packs a staged directory and checks the tarball against the source manifest. */
export function verifyStagedPackage(stageDir, sourcePackageJson) {
  const packDir = mkdtempSync(join(tmpdir(), "npm-public-verify-"));
  try {
    return checkTarball(packInto(stageDir, packDir), sourcePackageJson);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

// realpath both sides so symlinked invocations are still detected as direct CLI runs.
let isCli = false;
if (process.argv[1]) {
  try {
    isCli = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    isCli = false;
  }
}
if (isCli) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, arg, sourceArg] = process.argv.slice(2);
  try {
    if (command === "stage" && arg) {
      stagePublicPackage(repoRoot, resolve(arg));
      console.log(`✓ public npm package staged in ${resolve(arg)}`);
    } else if ((command === "check" || command === "verify") && arg) {
      const sourcePackageJson = resolve(sourceArg ?? join(repoRoot, "package.json"));
      const counts =
        command === "check"
          ? checkTarball(resolve(arg), sourcePackageJson)
          : verifyStagedPackage(resolve(arg), sourcePackageJson);
      console.log(
        `✓ packed manifest matches source (${counts.dependencies} dependencies, ${counts.peerDependencies} peerDependencies)`,
      );
    } else {
      console.error(
        "usage: npm-public-package.mjs stage <outDir> | verify <stageDir> | check <tarball> [sourcePackageJson]",
      );
      process.exit(2);
    }
  } catch (err) {
    console.error(`✗ public npm package ${command} FAILED\n${err.message}`);
    process.exit(1);
  }
}
