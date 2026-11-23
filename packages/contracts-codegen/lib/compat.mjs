/**
 * Wire compatibility between two versions of a schema set.
 *
 * The producer (PHP) only makes additive changes within one
 * `x-contract-version`. This compares the previous mirror with the new one and
 * reports what breaks a TypeScript consumer:
 *
 * - a $def or a property removed;
 * - a property that became required (an existing optional one, or a new one);
 * - a type narrowed: a type removed from the type set, an enum value removed,
 *   a const changed, a $ref pointing elsewhere, a union branch removed.
 *
 * A new $def, a new optional property or a new enum value is additive. So is
 * widening a `$ref X` into an `anyOf`/`oneOf` that still has `$ref X` as a
 * branch: every value the old schema accepted is still accepted.
 *
 * The gate only refuses a break once the producer is at `2.0.0-rc.1` or later
 * (the wire freezes at the first release candidate): when the new tag or the
 * base mirror's tag is at or past that floor. Below it, breaks are still
 * reported, but `ok` stays true. A missing or unparseable new tag is enforced,
 * so a caller that does not pass one keeps the strict behaviour. Only the
 * prerelease forms `alpha.N`, `beta.N` and `rc.N` parse; any other prerelease
 * is treated as unparseable.
 */

/** First producer version whose wire breaks are refused. */
export const ENFORCE_FROM = "2.0.0-rc.1";

function parseVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(tag ?? "").trim(),
  );
  if (!match) return null;
  if (match[4] !== undefined && !/^(alpha|beta|rc)\.\d+$/.test(match[4])) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

function comparePre(a, b) {
  if (!a.length || !b.length) return a.length ? -1 : b.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const na = /^\d+$/.test(a[i]);
    const nb = /^\d+$/.test(b[i]);
    if (na && nb) {
      if (Number(a[i]) !== Number(b[i])) return Number(a[i]) < Number(b[i]) ? -1 : 1;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Whether a break in the producer release `tag` must fail the gate: true from
 * {@link ENFORCE_FROM} on, and for a missing or unparseable tag.
 */
export function enforcesBreaks(tag) {
  const version = parseVersion(tag);
  if (!version) return true;
  const floor = parseVersion(ENFORCE_FROM);
  for (let i = 0; i < 3; i++) {
    if (version.core[i] !== floor.core[i]) return version.core[i] > floor.core[i];
  }
  return comparePre(version.pre, floor.pre) >= 0;
}

const describe = (path) => (path.length ? path.join(".") : "(root)");

function typeSet(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node.type)) return new Set(node.type);
  if (typeof node.type === "string") return new Set([node.type]);
  return null;
}

/** Keywords that never change which values a schema accepts. */
const ANNOTATIONS = new Set(["description", "title", "$comment", "examples", "deprecated"]);

/**
 * `next` is `{anyOf: [..., {$ref: ref}, ...]}` and nothing else that could
 * reject a value (annotations and `x-*` keys aside), so every value the old
 * `$ref` accepted still validates. `oneOf` is not a widening: a new branch that
 * overlaps the old one makes those values fail.
 */
function isPureWidening(ref, next) {
  if (!Array.isArray(next.anyOf)) return false;
  if (
    !next.anyOf.some((branch) => branch && branch.$ref === ref && Object.keys(branch).length === 1)
  )
    return false;
  return Object.keys(next).every(
    (key) => key === "anyOf" || ANNOTATIONS.has(key) || key.startsWith("x-"),
  );
}

function compareNode(base, next, path, breaks, additions) {
  if (base === next) return;
  if (base === true || base === undefined) return;
  if (next === true || next === undefined) return;
  if (typeof base !== "object" || typeof next !== "object" || base === null || next === null) {
    if (JSON.stringify(base) !== JSON.stringify(next))
      breaks.push(`${describe(path)}: schema changed`);
    return;
  }

  if (base.$ref !== undefined && next.$ref === undefined && isPureWidening(base.$ref, next)) {
    additions.push(`${describe(path)}: $ref ${base.$ref} widened to anyOf`);
    return;
  }

  if (base.$ref !== undefined || next.$ref !== undefined) {
    if (base.$ref !== next.$ref) {
      breaks.push(`${describe(path)}: $ref ${base.$ref ?? "(none)"} -> ${next.$ref ?? "(none)"}`);
    }
    return;
  }

  if (base.const !== undefined || next.const !== undefined) {
    if (JSON.stringify(base.const) !== JSON.stringify(next.const)) {
      breaks.push(
        `${describe(path)}: const ${JSON.stringify(base.const)} -> ${JSON.stringify(next.const)}`,
      );
    }
  }

  if (Array.isArray(base.enum)) {
    if (!Array.isArray(next.enum)) {
      if (next.const !== undefined) breaks.push(`${describe(path)}: enum narrowed to a const`);
    } else {
      const kept = new Set(next.enum.map((e) => JSON.stringify(e)));
      for (const value of base.enum) {
        if (!kept.has(JSON.stringify(value))) {
          breaks.push(`${describe(path)}: enum value ${JSON.stringify(value)} removed`);
        }
      }
      const old = new Set(base.enum.map((e) => JSON.stringify(e)));
      for (const value of next.enum) {
        if (!old.has(JSON.stringify(value))) {
          additions.push(`${describe(path)}: enum value ${JSON.stringify(value)} added`);
        }
      }
    }
  }

  const baseTypes = typeSet(base);
  const nextTypes = typeSet(next);
  if (baseTypes && nextTypes) {
    for (const t of baseTypes) {
      // integer narrows number; number widening integer is fine.
      if (!nextTypes.has(t) && !(t === "integer" && nextTypes.has("number"))) {
        breaks.push(`${describe(path)}: type "${t}" removed`);
      }
    }
  }

  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const a = base[key];
    const b = next[key];
    if (!Array.isArray(a)) continue;
    if (!Array.isArray(b)) {
      breaks.push(`${describe(path)}: ${key} removed`);
      continue;
    }
    if (key !== "allOf" && b.length < a.length) {
      breaks.push(`${describe(path)}: ${key} lost ${a.length - b.length} branch(es)`);
    }
    if (key === "allOf" && b.length > a.length) {
      breaks.push(`${describe(path)}: allOf gained ${b.length - a.length} member(s)`);
    }
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++)
      compareNode(a[i], b[i], [...path, `${key}[${i}]`], breaks, additions);
  }

  const baseProps = base.properties ?? {};
  const nextProps = next.properties ?? {};
  const baseRequired = new Set(base.required ?? []);
  const nextRequired = new Set(next.required ?? []);
  for (const key of Object.keys(baseProps)) {
    if (!(key in nextProps)) {
      breaks.push(`${describe([...path, key])}: property removed`);
      continue;
    }
    compareNode(baseProps[key], nextProps[key], [...path, key], breaks, additions);
  }
  for (const key of Object.keys(nextProps)) {
    if (!(key in baseProps)) {
      if (nextRequired.has(key)) breaks.push(`${describe([...path, key])}: new required property`);
      else additions.push(`${describe([...path, key])}: optional property added`);
    }
  }
  for (const key of nextRequired) {
    if (key in baseProps && !baseRequired.has(key)) {
      breaks.push(`${describe([...path, key])}: became required`);
    }
  }

  if (base.items !== undefined && next.items !== undefined) {
    compareNode(base.items, next.items, [...path, "[]"], breaks, additions);
  }
  if (
    base.additionalProperties &&
    typeof base.additionalProperties === "object" &&
    next.additionalProperties &&
    typeof next.additionalProperties === "object"
  ) {
    compareNode(
      base.additionalProperties,
      next.additionalProperties,
      [...path, "{}"],
      breaks,
      additions,
    );
  }
}

/**
 * @param {{ version: string, defs: Record<string, unknown> }} base
 * @param {{ version: string, defs: Record<string, unknown> }} next
 * @param {{ producerTag?: string, baseTag?: string }} [options] release tag of
 *   the producer that made `next`, and the tag the base mirror came from; a
 *   break is refused when either is at or past {@link ENFORCE_FROM}, or when
 *   `producerTag` is missing or unparseable
 * @returns {{ level: "none" | "patch" | "additive" | "breaking", versionBumped: boolean, enforced: boolean, ok: boolean, breaks: string[], additions: string[] }}
 */
export function compareContracts(base, next, options = {}) {
  const breaks = [];
  const additions = [];
  for (const name of Object.keys(base.defs)) {
    if (!(name in next.defs)) {
      breaks.push(`${name}: $def removed`);
      continue;
    }
    compareNode(base.defs[name], next.defs[name], [name], breaks, additions);
  }
  for (const name of Object.keys(next.defs)) {
    if (!(name in base.defs)) additions.push(`${name}: $def added`);
  }

  const versionBumped = Number(next.version) > Number(base.version);
  const changed = JSON.stringify(base.defs) !== JSON.stringify(next.defs);
  const level = breaks.length
    ? "breaking"
    : additions.length
      ? "additive"
      : changed
        ? "patch"
        : "none";
  const enforced =
    enforcesBreaks(options.producerTag) ||
    (options.baseTag !== undefined && enforcesBreaks(options.baseTag));
  return {
    level,
    versionBumped,
    enforced,
    ok: breaks.length === 0 || versionBumped || !enforced,
    breaks,
    additions,
  };
}
