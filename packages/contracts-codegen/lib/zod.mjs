/**
 * Zod emitter: one exported schema per JSON Schema $def.
 *
 * json-schema-to-zod has no $ref parser and cannot inline cycles, so the
 * schemas are emitted here. Defs are declared in dependency order (topological);
 * a reference to an already-declared def is a direct reference, and a back-edge
 * (a recursive def such as NavigationNode) becomes z.lazy(() => XSchema).
 * Recursive defs get an explicit z.ZodType<T> annotation so TypeScript does not
 * infer `any` on the self-reference.
 *
 * Objects are lenient: `additionalProperties: false` is not turned into
 * .strict(), so unknown keys (forward-compat fields, host overlays) are
 * stripped instead of rejected. The strict shape lives in the TypeScript types.
 */

const LOCAL_REF = /^#\/\$defs\/(.+)$/;

/**
 * Resolve a $ref against the local defs and the configured externals.
 * @returns {{ kind: "local", name: string } | { kind: "external", name: string, module: string }}
 */
export function resolveRef(ref, externals) {
  const local = ref.match(LOCAL_REF);
  if (local) return { kind: "local", name: local[1] };
  for (const [prefix, module] of Object.entries(externals ?? {})) {
    if (!ref.startsWith(prefix)) continue;
    const hash = ref.indexOf("#");
    const pointer = hash >= 0 ? ref.slice(hash) : "";
    const match = pointer.match(LOCAL_REF);
    if (match) return { kind: "external", name: match[1], module };
  }
  throw new Error(`contracts-codegen: unsupported $ref "${ref}" (not local, no matching external)`);
}

/** Every $ref string found anywhere in a node. */
export function collectRefs(node, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const n of node) collectRefs(n, acc);
  } else if (node && typeof node === "object") {
    if (typeof node.$ref === "string") acc.add(node.$ref);
    for (const [k, v] of Object.entries(node)) {
      if (k !== "$ref") collectRefs(v, acc);
    }
  }
  return acc;
}

const pad = (depth) => "  ".repeat(depth);

function primitive(type) {
  switch (type) {
    case "string":
      return "z.string()";
    case "integer":
      return "z.number().int()";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array":
      return "z.array(z.unknown())";
    case "object":
      return "z.record(z.string(), z.unknown())";
    default:
      return "z.unknown()";
  }
}

/** An open enum must be a top-level $def that is a non-empty string enum. */
export function isStringEnum(node) {
  return (
    Boolean(node) &&
    Array.isArray(node.enum) &&
    node.enum.length > 0 &&
    node.enum.every((e) => typeof e === "string")
  );
}

export function assertOpenEnums(defs, openEnums) {
  for (const name of openEnums) {
    if (!isStringEnum(defs[name])) {
      throw new Error(
        `contracts-codegen: openEnums entry "${name}" is not a top-level string enum $def`,
      );
    }
  }
}

function union(members) {
  if (members.length === 1) return members[0];
  return `z.union([${members.join(", ")}])`;
}

/**
 * @param {object} options
 * @param {Record<string, unknown>} options.defs     merged $defs
 * @param {Record<string, string>} [options.externals] $ref prefix -> module
 * @param {string} options.typesModule               module of the generated types (for recursive annotations)
 * @param {Record<string, string>} [options.aliases]  extra export name -> def name
 * @param {string[]} [options.openEnums]              top-level string-enum $defs that also accept any other string
 * @returns {{ body: string, order: string[], recursive: string[] }}
 */
export function emitZod({ defs, externals = {}, typesModule, aliases = {}, openEnums = [] }) {
  assertOpenEnums(defs, openEnums);
  const names = Object.keys(defs);
  const externalImports = new Map();

  const deps = Object.fromEntries(
    names.map((name) => {
      const local = new Set();
      for (const ref of collectRefs(defs[name])) {
        const resolved = resolveRef(ref, externals);
        if (resolved.kind === "local") {
          if (!(resolved.name in defs)) {
            throw new Error(`contracts-codegen: unknown $ref target "${resolved.name}" in ${name}`);
          }
          local.add(resolved.name);
        }
      }
      return [name, local];
    }),
  );

  const visited = new Set();
  const order = [];
  const visit = (name) => {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dep of deps[name]) if (dep !== name) visit(dep);
    order.push(name);
  };
  for (const name of names) visit(name);
  const rank = Object.fromEntries(order.map((n, i) => [n, i]));

  const isRecursive = (name) => {
    const seen = new Set();
    const stack = [...deps[name]];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === name) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...deps[cur]);
    }
    return false;
  };
  const recursive = new Set(names.filter(isRecursive));

  const expr = (node, owner, depth) => {
    if (node === true || node === undefined) return "z.unknown()";
    if (node === false) return "z.never()";
    if (node === null || typeof node !== "object") return "z.unknown()";

    if (typeof node.$ref === "string") {
      const resolved = resolveRef(node.$ref, externals);
      if (resolved.kind === "external") {
        const list = externalImports.get(resolved.module) ?? new Set();
        list.add(`${resolved.name}Schema`);
        externalImports.set(resolved.module, list);
        return `${resolved.name}Schema`;
      }
      const ref = `${resolved.name}Schema`;
      const backEdge = resolved.name === owner || rank[resolved.name] >= rank[owner];
      return backEdge ? `z.lazy(() => ${ref})` : ref;
    }
    if (Array.isArray(node.allOf)) {
      const parts = node.allOf.map((s) => expr(s, owner, depth));
      return parts.reduce((acc, part) => `z.intersection(${acc}, ${part})`);
    }
    if (Array.isArray(node.oneOf)) return union(node.oneOf.map((s) => expr(s, owner, depth)));
    if (Array.isArray(node.anyOf)) return union(node.anyOf.map((s) => expr(s, owner, depth)));
    if (node.const !== undefined) return `z.literal(${JSON.stringify(node.const)})`;
    if (Array.isArray(node.enum)) {
      if (node.enum.length > 0 && node.enum.every((e) => typeof e === "string")) {
        return `z.enum([${node.enum.map((e) => JSON.stringify(e)).join(", ")}])`;
      }
      return union(node.enum.map((e) => `z.literal(${JSON.stringify(e)})`));
    }
    if (Array.isArray(node.type)) {
      return union(node.type.map((t) => typed(node, t, owner, depth)));
    }
    if (typeof node.type === "string") return typed(node, node.type, owner, depth);
    if (node.properties) return object(node, owner, depth);
    return "z.unknown()";
  };

  const typed = (node, type, owner, depth) => {
    switch (type) {
      case "string": {
        let out = "z.string()";
        if (Number.isInteger(node.minLength)) out += `.min(${node.minLength})`;
        if (Number.isInteger(node.maxLength)) out += `.max(${node.maxLength})`;
        if (typeof node.pattern === "string")
          out += `.regex(new RegExp(${JSON.stringify(node.pattern)}))`;
        return out;
      }
      case "integer":
      case "number": {
        let out = primitive(type);
        if (typeof node.minimum === "number") out += `.gte(${node.minimum})`;
        if (typeof node.maximum === "number") out += `.lte(${node.maximum})`;
        return out;
      }
      case "array": {
        let out = `z.array(${node.items !== undefined ? expr(node.items, owner, depth) : "z.unknown()"})`;
        if (Number.isInteger(node.minItems)) out += `.min(${node.minItems})`;
        if (Number.isInteger(node.maxItems)) out += `.max(${node.maxItems})`;
        return out;
      }
      case "object":
        return object(node, owner, depth);
      default:
        return primitive(type);
    }
  };

  const object = (node, owner, depth) => {
    const props = node.properties ?? {};
    const extra = node.additionalProperties;
    if (Object.keys(props).length === 0) {
      if (extra && typeof extra === "object") {
        return `z.record(z.string(), ${expr(extra, owner, depth)})`;
      }
      return "z.record(z.string(), z.unknown())";
    }
    const required = new Set(node.required ?? []);
    const lines = Object.entries(props).map(([key, sub]) => {
      let out = expr(sub, owner, depth + 1);
      if (!required.has(key)) out += ".optional()";
      return `${pad(depth + 1)}${JSON.stringify(key)}: ${out},`;
    });
    let out = `z.object({\n${lines.join("\n")}\n${pad(depth)}})`;
    if (extra === true) out += ".catchall(z.unknown())";
    else if (extra && typeof extra === "object") out += `.catchall(${expr(extra, owner, depth)})`;
    return out;
  };

  const decls = order.map((name) => {
    const body = openEnums.includes(name)
      ? `z.union([${expr(defs[name], name, 0)}, z.string()])`
      : expr(defs[name], name, 0);
    return recursive.has(name)
      ? `export const ${name}Schema: z.ZodType<${name}> = ${body};`
      : `export const ${name}Schema = ${body};`;
  });

  const aliasLines = Object.entries(aliases).map(([alias, def]) => {
    if (!(def in defs))
      throw new Error(`contracts-codegen: alias "${alias}" targets unknown def "${def}"`);
    return `export const ${alias} = ${def}Schema;`;
  });

  const recursiveTypes = order.filter((n) => recursive.has(n));
  const imports = ['import { z } from "zod";'];
  if (recursiveTypes.length) {
    imports.push(`import type { ${recursiveTypes.join(", ")} } from "${typesModule}";`);
  }
  for (const [module, list] of [...externalImports].sort(([a], [b]) => a.localeCompare(b))) {
    imports.push(`import { ${[...list].sort().join(", ")} } from "${module}";`);
  }

  const body = [
    ...imports,
    "",
    decls.join("\n\n"),
    ...(aliasLines.length ? ["", ...aliasLines] : []),
    "",
  ].join("\n");

  return { body, order, recursive: recursiveTypes };
}
