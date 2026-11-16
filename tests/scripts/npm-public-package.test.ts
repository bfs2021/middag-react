/**
 * Public npm package guard.
 *
 * The public npm copy of @middag-io/react is published from a staged
 * manifest. Earlier releases dropped `dependencies` and narrowed `files`
 * there, so installs from registry.npmjs.org broke (e.g. react-i18next
 * missing). This suite pins the staging rewrite and the tarball guard.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkTarball,
  diffManifests,
  missingExportTargets,
  packInto,
  toPublicManifest,
} from "../../scripts/npm-public-package.mjs";

const SCRIPT = path.resolve(__dirname, "../../scripts/npm-public-package.mjs");
const SOURCE_PKG = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));

const tmpDirs: string[] = [];

function makeTarball(manifest: Record<string, unknown>, files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "npm-public-guard-"));
  tmpDirs.push(root);
  const pkgDir = path.join(root, "package");
  for (const [rel, content] of Object.entries({
    ...files,
    "package.json": JSON.stringify(manifest),
  })) {
    const abs = path.join(pkgDir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const tarball = path.join(root, "pkg.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", root, "package"]);
  return tarball;
}

function writeSource(manifest: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "npm-public-src-"));
  tmpDirs.push(dir);
  const file = path.join(dir, "package.json");
  writeFileSync(file, JSON.stringify(manifest));
  return file;
}

const SOURCE = {
  name: "@middag-io/react",
  version: "1.2.3",
  publishConfig: { registry: "https://npm.pkg.github.com" },
  scripts: { prepare: "git config core.hooksPath .githooks" },
  files: ["dist-lib", "src/theme.css"],
  exports: {
    ".": { import: "./dist-lib/index.js" },
    "./theme.css": "./src/theme.css",
    "./lib/*": "./dist-lib/lib/*.js",
  },
  dependencies: { "react-i18next": "^15.0.0", clsx: "^2.1.1" },
  peerDependencies: { react: "^19.0.0" },
  devDependencies: { vitest: "^3.0.0" },
};

const FILES = {
  "dist-lib/index.js": "",
  "dist-lib/lib/utils.js": "",
  "src/theme.css": "",
};

function withoutDependencies(manifest: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "dependencies"));
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("toPublicManifest", () => {
  it("drops only publishConfig and scripts, keeping dependencies and files", () => {
    const publicPkg = toPublicManifest(SOURCE);

    expect(publicPkg).not.toHaveProperty("publishConfig");
    expect(publicPkg).not.toHaveProperty("scripts");
    expect(publicPkg.dependencies).toEqual(SOURCE.dependencies);
    expect(publicPkg.devDependencies).toEqual(SOURCE.devDependencies);
    expect(publicPkg.files).toEqual(SOURCE.files);
    expect(SOURCE).toHaveProperty("publishConfig");
  });

  it("keeps every guarded field of the real package.json", () => {
    expect(diffManifests(SOURCE_PKG, toPublicManifest(SOURCE_PKG))).toEqual([]);
  });
});

describe("diffManifests", () => {
  it("reports dropped dependencies", () => {
    const withoutDeps = withoutDependencies(toPublicManifest(SOURCE));

    expect(diffManifests(SOURCE, withoutDeps)).toEqual(["dependencies"]);
  });

  it("reports a narrowed files list", () => {
    expect(diffManifests(SOURCE, { ...SOURCE, files: ["dist-lib"] })).toEqual(["files"]);
  });

  it("ignores object key order", () => {
    const reordered = { ...SOURCE, dependencies: { clsx: "^2.1.1", "react-i18next": "^15.0.0" } };

    expect(diffManifests(SOURCE, reordered)).toEqual([]);
  });
});

describe("missingExportTargets", () => {
  it("returns static and wildcard targets absent from the file list", () => {
    expect(missingExportTargets(SOURCE.exports, ["dist-lib/index.js"])).toEqual([
      "./src/theme.css",
      "./dist-lib/lib/*.js",
    ]);
  });

  it("returns nothing when every target is shipped", () => {
    expect(missingExportTargets(SOURCE.exports, Object.keys(FILES))).toEqual([]);
  });
});

describe("checkTarball", () => {
  it("passes a tarball packed from the public manifest", () => {
    const tarball = makeTarball(toPublicManifest(SOURCE), FILES);

    expect(checkTarball(tarball, writeSource(SOURCE))).toEqual({
      dependencies: 2,
      peerDependencies: 1,
    });
  });

  it("fails when the tarball dropped dependencies", () => {
    const broken = withoutDependencies(toPublicManifest(SOURCE));
    const tarball = makeTarball(broken, FILES);

    expect(() => checkTarball(tarball, writeSource(SOURCE))).toThrow(/"dependencies" differs/);
  });

  it("fails when an exports target is missing from the tarball", () => {
    const tarball = makeTarball(toPublicManifest(SOURCE), { "dist-lib/index.js": "" });

    expect(() => checkTarball(tarball, writeSource(SOURCE))).toThrow(
      /\.\/src\/theme\.css is not in the tarball/,
    );
  });

  it("CLI exits non-zero on drift", () => {
    const broken = withoutDependencies(toPublicManifest(SOURCE));
    const tarball = makeTarball(broken, FILES);

    expect(() =>
      execFileSync("node", [SCRIPT, "check", tarball, writeSource(SOURCE)], { stdio: "pipe" }),
    ).toThrow();
  });
});

describe("packInto", () => {
  it("returns the tarball npm pack wrote, whatever npm's --json shape", () => {
    const pkgDir = mkdtempSync(path.join(tmpdir(), "npm-public-packinto-"));
    const packDir = mkdtempSync(path.join(tmpdir(), "npm-public-packout-"));
    tmpDirs.push(pkgDir, packDir);
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pack-into-fixture",
        version: "0.0.1",
        dependencies: { clsx: "^2.1.1" },
      }),
    );
    writeFileSync(path.join(pkgDir, "index.js"), "");

    const tarball = packInto(pkgDir, packDir);

    expect(path.basename(tarball)).toBe("pack-into-fixture-0.0.1.tgz");
    expect(checkTarball(tarball, path.join(pkgDir, "package.json"))).toEqual({
      dependencies: 1,
      peerDependencies: 0,
    });
  });
});
