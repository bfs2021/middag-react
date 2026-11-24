/* global fetch, structuredClone */
/**
 * @middag-io/ui-contracts-codegen — TypeScript types and zod schemas from the
 * MIDDAG wire JSON Schemas.
 *
 * A contracts package keeps a mirror of the producer's schemas in `schema/`,
 * the provenance of that mirror in `schema/SOURCE.json`, and its settings in
 * `contracts.config.json`. Generation reads only the mirror. Reading another
 * directory takes an explicit `source` (local development), which rewrites the
 * mirror and marks its provenance as local so a published build refuses it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { compile } from "json-schema-to-typescript";

import { compareContracts } from "./compat.mjs";
import { assertOpenEnums, collectRefs, emitZod, resolveRef } from "./zod.mjs";

export { compareContracts, enforcesBreaks, ENFORCE_FROM } from "./compat.mjs";
export { emitZod } from "./zod.mjs";

export const CONFIG_FILE = "contracts.config.json";
export const SCHEMA_DIR = "schema";
export const SOURCE_FILE = "SOURCE.json";

const PRETTIER_STYLE = { singleQuote: false, semi: true, trailingComma: "all", printWidth: 100 };

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Read and validate `contracts.config.json`. */
export function loadConfig(packageDir) {
  const file = join(packageDir, CONFIG_FILE);
  if (!existsSync(file)) throw new Error(`contracts-codegen: ${file} not found`);
  const config = JSON.parse(readFileSync(file, "utf8"));
  const missing = ["schemas", "idPrefix", "out", "producer"].filter((k) => config[k] === undefined);
  if (missing.length) {
    throw new Error(`contracts-codegen: ${CONFIG_FILE} is missing ${missing.join(", ")}`);
  }
  if (!Array.isArray(config.schemas) || config.schemas.length === 0) {
    throw new Error(`contracts-codegen: ${CONFIG_FILE} "schemas" must list at least one file`);
  }
  return {
    forbiddenIds: [],
    externals: {},
    aliases: {},
    openEnums: [],
    relaxBareObjects: false,
    disjointWith: [],
    ...config,
    commands: { generate: "npm run gen", check: "npm run gen:check", ...config.commands },
  };
}

/** Read the mirrored schemas, in config order. */
export function readMirror(packageDir, config) {
  const dir = join(packageDir, SCHEMA_DIR);
  return config.schemas.map((name) => {
    const path = join(dir, name);
    if (!existsSync(path)) throw new Error(`contracts-codegen: mirror file ${path} not found`);
    const raw = readFileSync(path, "utf8");
    return { name, raw, json: JSON.parse(raw) };
  });
}

export function readSource(packageDir) {
  const path = join(packageDir, SCHEMA_DIR, SOURCE_FILE);
  if (!existsSync(path)) throw new Error(`contracts-codegen: ${path} not found`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeSource(packageDir, source) {
  writeFileSync(join(packageDir, SCHEMA_DIR, SOURCE_FILE), JSON.stringify(source, null, 2) + "\n");
}

/** Hash of a schema set: one value for the whole mirror, in config order. */
export function schemaHash(files) {
  const hash = createHash("sha256");
  files.forEach((f, i) => {
    if (i > 0) hash.update(" ");
    hash.update(f.raw);
  });
  return hash.digest("hex").slice(0, 16);
}

/**
 * Leak guard and consistency checks on the mirrored schemas.
 * Throws on the first violation.
 */
export function validateSchemas(files, config) {
  let version;
  for (const file of files) {
    const id = file.json.$id;
    if (typeof id !== "string" || !id.startsWith(config.idPrefix)) {
      throw new Error(
        `contracts-codegen: ${file.name} has $id ${JSON.stringify(id)}, outside ${config.idPrefix}`,
      );
    }
    for (const forbidden of config.forbiddenIds) {
      if (file.raw.includes(forbidden)) {
        throw new Error(
          `contracts-codegen: ${file.name} mentions ${forbidden}, which this package must not carry`,
        );
      }
    }
    const v = file.json["x-contract-version"];
    if (v === undefined) {
      throw new Error(
        `contracts-codegen: ${file.name} has no x-contract-version stamp (regenerate it with the producer's emit:schemas)`,
      );
    }
    if (version !== undefined && String(v) !== String(version)) {
      throw new Error(
        `contracts-codegen: x-contract-version differs between schemas (${version} vs ${v})`,
      );
    }
    version = v;
  }
  return String(version);
}

/** Union of the $defs of every schema; the same name must carry the same definition. */
export function mergeDefs(files) {
  const defs = {};
  for (const file of files) {
    for (const [name, def] of Object.entries(file.json.$defs ?? {})) {
      if (name in defs && JSON.stringify(defs[name]) !== JSON.stringify(def)) {
        throw new Error(`contracts-codegen: $def "${name}" differs between schemas`);
      }
      defs[name] = def;
    }
  }
  return defs;
}

/**
 * Names that two def sets share. A contracts package that extends another must
 * reference it, not redefine its names.
 */
export function sharedNames(defs, otherDefs) {
  return Object.keys(defs)
    .filter((name) => name in otherDefs)
    .sort();
}

function relaxBareObjects(node) {
  if (Array.isArray(node)) {
    node.forEach(relaxBareObjects);
  } else if (node && typeof node === "object") {
    if (
      node.type === "object" &&
      node.properties === undefined &&
      node.additionalProperties === undefined
    ) {
      node.additionalProperties = true;
    }
    for (const value of Object.values(node)) relaxBareObjects(value);
  }
}

/** Replace external $refs with a tsType placeholder, collecting the imports. */
function externalizeForTypes(node, externals, imports) {
  if (Array.isArray(node)) return node.map((n) => externalizeForTypes(n, externals, imports));
  if (node && typeof node === "object") {
    if (typeof node.$ref === "string") {
      const resolved = resolveRef(node.$ref, externals);
      if (resolved.kind === "external") {
        const list = imports.get(resolved.module) ?? new Set();
        list.add(resolved.name);
        imports.set(resolved.module, list);
        const rest = { ...node };
        delete rest.$ref;
        return { ...externalizeForTypes(rest, externals, imports), tsType: resolved.name };
      }
    }
    const out = {};
    for (const [key, value] of Object.entries(node))
      out[key] = externalizeForTypes(value, externals, imports);
    return out;
  }
  return node;
}

function header({ summary, config, source, version, hash }) {
  const files = config.schemas.length === 1 ? config.schemas[0] : `{${config.schemas.join(",")}}`;
  const where = source?.repository ? `${source.repository}@${source.ref ?? "?"}` : config.producer;
  return [
    "/**",
    " * @generated by @middag-io/ui-contracts-codegen — DO NOT EDIT BY HAND.",
    " *",
    ` * ${summary}`,
    " *",
    ` * Source of truth: ${config.producer} value objects -> JSON Schema (draft 2020-12).`,
    ` * Regenerate:  ${config.commands.generate}`,
    ` * Drift gate:  ${config.commands.check}`,
    " *",
    ` * @source ${where} ${SCHEMA_DIR}/${files}`,
    ` * @contract-version ${version}`,
    ` * @hash ${hash}`,
    " */",
    "",
  ].join("\n");
}

async function emitTypes(defs, config, banner) {
  const prepared = structuredClone(defs);
  assertOpenEnums(prepared, config.openEnums);
  for (const name of config.openEnums) {
    // string & {} keeps editor autocomplete on the known members.
    prepared[name].tsType = [
      ...prepared[name].enum.map((e) => JSON.stringify(e)),
      "(string & {})",
    ].join(" | ");
  }
  if (config.relaxBareObjects) relaxBareObjects(prepared);
  const imports = new Map();
  const externalized = externalizeForTypes(prepared, config.externals, imports);
  const names = Object.keys(externalized);
  const root = {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(names.map((k) => [k, { $ref: `#/$defs/${k}` }])),
    required: names,
    $defs: externalized,
  };
  let ts = await compile(root, "ContractsCodegenRoot", {
    additionalProperties: false,
    bannerComment: "",
    declareExternallyReferenced: true,
    enableConstEnums: false,
    unknownAny: true,
    format: true,
    style: PRETTIER_STYLE,
  });
  ts = ts.replace(/export interface ContractsCodegenRoot \{[\s\S]*?\n\}\n+/, "");
  const importLines = [...imports]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, list]) => `import type { ${[...list].sort().join(", ")} } from "${module}";`);
  return (
    banner + (importLines.length ? importLines.join("\n") + "\n\n" : "") + ts.trimStart() + "\n"
  );
}

function emitMeta(config, source, version, hash, banner) {
  const producer = {
    package: config.producer,
    repository: source?.repository ?? null,
    ref: source?.ref ?? null,
    sha: source?.sha ?? null,
  };
  return (
    banner +
    [
      "/** Breaking version of the wire contract (`x-contract-version`). */",
      `export const CONTRACT_VERSION = ${JSON.stringify(version)} as const;`,
      "",
      "/** Hash of the mirrored schemas this package was generated from. */",
      `export const SCHEMA_HASH = ${JSON.stringify(hash)} as const;`,
      "",
      "/** Producer of the schemas and the release they were mirrored from. */",
      `export const PRODUCER = ${JSON.stringify(producer, null, 2)} as const;`,
      "",
    ].join("\n")
  );
}

/**
 * Generate the package sources from its mirror.
 * @returns {Promise<{ files: Record<string, string>, version: string, hash: string, defs: Record<string, unknown> }>}
 */
export async function build(packageDir) {
  const config = loadConfig(packageDir);
  const files = readMirror(packageDir, config);
  const version = validateSchemas(files, config);
  const defs = mergeDefs(files);
  for (const name of Object.keys(defs)) {
    for (const ref of collectRefs(defs[name])) resolveRef(ref, config.externals);
  }
  const source = readSource(packageDir);
  const hash = schemaHash(files);
  const banner = (summary) => header({ summary, config, source, version, hash });

  const zod = emitZod({
    defs,
    externals: config.externals,
    typesModule: "./types.js",
    aliases: config.aliases,
    openEnums: config.openEnums,
  });

  return {
    config,
    version,
    hash,
    defs,
    source,
    files: {
      "types.ts": await emitTypes(defs, config, banner("TypeScript types of the wire contract.")),
      "schemas.ts":
        banner("Zod schemas of the wire contract, one per $def. Lenient on unknown keys.") +
        zod.body,
      "meta.ts": emitMeta(
        config,
        source,
        version,
        hash,
        banner("Contract version and provenance."),
      ),
      "index.ts":
        banner("Barrel of the generated contract layer.") +
        [
          'export * from "./types.js";',
          'export * from "./schemas.js";',
          'export * from "./meta.js";',
          "",
        ].join("\n"),
    },
  };
}

function readOut(outDir) {
  if (!existsSync(outDir)) return {};
  const out = {};
  for (const f of readdirSync(outDir)) {
    if (f.endsWith(".ts")) out[f] = readFileSync(join(outDir, f), "utf8");
  }
  return out;
}

/** Problems with the mirror's provenance, offline (no network). */
export function provenanceProblems(packageDir, config, source) {
  const problems = [];
  if (!source.repository || !source.ref || !source.sha) {
    problems.push(
      `${SCHEMA_DIR}/${SOURCE_FILE} has no repository, ref or sha (mirror written from a local --source)`,
    );
  }
  for (const name of config.schemas) {
    const path = join(packageDir, SCHEMA_DIR, name);
    const actual = existsSync(path) ? sha256(readFileSync(path, "utf8")) : undefined;
    if (source.files?.[name] !== actual)
      problems.push(`${SCHEMA_DIR}/${name} does not match its hash in ${SOURCE_FILE}`);
  }
  return problems;
}

/**
 * Drift gate: the generated sources match the mirror, nothing is orphaned and
 * the mirror matches its recorded provenance.
 * @returns {Promise<{ ok: boolean, problems: string[], hash: string, version: string }>}
 */
export async function check(packageDir) {
  const result = await build(packageDir);
  const outDir = join(packageDir, result.config.out);
  const existing = readOut(outDir);
  const problems = [];
  for (const [name, content] of Object.entries(result.files)) {
    if (existing[name] !== content) problems.push(`${result.config.out}/${name} is stale`);
  }
  for (const name of Object.keys(existing)) {
    if (!(name in result.files)) problems.push(`${result.config.out}/${name} is orphaned`);
  }
  problems.push(...provenanceProblems(packageDir, result.config, result.source));
  problems.push(...(await disjointProblems(packageDir, result)));
  return { ok: problems.length === 0, problems, hash: result.hash, version: result.version };
}

async function disjointProblems(packageDir, result) {
  const problems = [];
  for (const other of result.config.disjointWith) {
    const otherDir = resolve(packageDir, other);
    const otherConfig = loadConfig(otherDir);
    const otherDefs = mergeDefs(readMirror(otherDir, otherConfig));
    const shared = sharedNames(result.defs, otherDefs);
    if (shared.length) {
      problems.push(
        `$defs shared with ${otherConfig.packageName ?? other}: ${shared.join(", ")} (reference them, do not redefine)`,
      );
    }
  }
  return problems;
}

/** Write the generated sources, removing orphans. */
export async function generate(packageDir) {
  const result = await build(packageDir);
  const outDir = join(packageDir, result.config.out);
  mkdirSync(outDir, { recursive: true });
  for (const name of Object.keys(readOut(outDir))) {
    if (!(name in result.files)) rmSync(join(outDir, name));
  }
  for (const [name, content] of Object.entries(result.files))
    writeFileSync(join(outDir, name), content);
  return result;
}

/**
 * Copy schemas from a local directory into the mirror (development only). The
 * provenance is rewritten as local, which the drift gate rejects.
 */
export function copyLocalSource(packageDir, sourceDir) {
  const config = loadConfig(packageDir);
  const dir = join(packageDir, SCHEMA_DIR);
  mkdirSync(dir, { recursive: true });
  const hashes = {};
  for (const name of config.schemas) {
    const raw = readFileSync(join(sourceDir, name), "utf8");
    writeFileSync(join(dir, name), raw);
    hashes[name] = sha256(raw);
  }
  writeSource(packageDir, {
    repository: null,
    ref: null,
    sha: null,
    path: relative(packageDir, resolve(sourceDir)),
    files: hashes,
  });
}

/** Defs and version of a mirror directory (for the compatibility gate). */
export function contractOf(dir, config) {
  const files = config.schemas.map((name) => {
    const raw = readFileSync(join(dir, name), "utf8");
    return { name, raw, json: JSON.parse(raw) };
  });
  return { version: String(files[0].json["x-contract-version"]), defs: mergeDefs(files) };
}

/** The `ref` a mirror's SOURCE.json records, or undefined when it has none. */
function sourceRef(schemaDir) {
  const path = join(schemaDir, SOURCE_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const ref = JSON.parse(readFileSync(path, "utf8")).ref;
    return typeof ref === "string" ? ref : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compare a previous mirror directory with the package's current mirror. The
 * producer tags come from each mirror's SOURCE.json (see compareContracts).
 */
export function compat(packageDir, baseDir) {
  const config = loadConfig(packageDir);
  const dir = join(packageDir, SCHEMA_DIR);
  return compareContracts(contractOf(baseDir, config), contractOf(dir, config), {
    producerTag: sourceRef(dir),
    baseTag: sourceRef(baseDir),
  });
}

/**
 * Fetch one file of a GitHub repository at a ref. Public repositories need no
 * token; a private producer takes one with contents: read.
 */
export async function fetchGitHubFile({ repository, ref, path, token }) {
  const url = `https://api.github.com/repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  const headers = {
    Accept: "application/vnd.github.raw+json",
    "User-Agent": "ui-contracts-codegen",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok)
    throw new Error(`contracts-codegen: GET ${repository}/${path}@${ref} -> ${res.status}`);
  return res.text();
}

export async function resolveGitHubSha({ repository, ref, token }) {
  const url = `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`;
  const headers = { Accept: "application/vnd.github.sha", "User-Agent": "ui-contracts-codegen" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`contracts-codegen: resolve ${repository}@${ref} -> ${res.status}`);
  return (await res.text()).trim();
}

/**
 * Mirror the producer's schemas at a release tag. Leaves the mirror untouched
 * and returns `changed: false` when the schemas did not change.
 */
export async function mirror(packageDir, { repository, ref, path = SCHEMA_DIR, token }) {
  const config = loadConfig(packageDir);
  const dir = join(packageDir, SCHEMA_DIR);
  const fetched = {};
  for (const name of config.schemas) {
    fetched[name] = await fetchGitHubFile({ repository, ref, path: `${path}/${name}`, token });
  }
  const unchanged = config.schemas.every((name) => {
    const current = join(dir, name);
    return existsSync(current) && readFileSync(current, "utf8") === fetched[name];
  });
  if (unchanged) return { changed: false };

  const baseTag = sourceRef(dir);
  const baseDir = join(dir, ".base");
  rmSync(baseDir, { recursive: true, force: true });
  mkdirSync(baseDir, { recursive: true });
  for (const name of config.schemas) {
    if (existsSync(join(dir, name)))
      writeFileSync(join(baseDir, name), readFileSync(join(dir, name), "utf8"));
  }
  const hashes = {};
  for (const name of config.schemas) {
    writeFileSync(join(dir, name), fetched[name]);
    hashes[name] = sha256(fetched[name]);
  }
  const sha = await resolveGitHubSha({ repository, ref, token });
  writeSource(packageDir, { repository, ref, sha, path, files: hashes });
  const hasBase = config.schemas.every((name) => existsSync(join(baseDir, name)));
  const report = hasBase
    ? compareContracts(contractOf(baseDir, config), contractOf(dir, config), {
        producerTag: ref,
        baseTag,
      })
    : null;
  rmSync(baseDir, { recursive: true, force: true });
  return { changed: true, report };
}

/** Check the mirror against the producer at the recorded ref (network). */
export async function verifySource(packageDir, { token } = {}) {
  const config = loadConfig(packageDir);
  const source = readSource(packageDir);
  const problems = provenanceProblems(packageDir, config, source);
  if (problems.length) return { ok: false, problems };
  for (const name of config.schemas) {
    const remote = await fetchGitHubFile({
      repository: source.repository,
      ref: source.sha,
      path: `${source.path ?? SCHEMA_DIR}/${name}`,
      token,
    });
    if (sha256(remote) !== source.files[name]) {
      problems.push(
        `${SCHEMA_DIR}/${name} differs from ${source.repository}@${source.ref} (${source.sha})`,
      );
    }
  }
  return { ok: problems.length === 0, problems };
}
