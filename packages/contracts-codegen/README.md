# @middag-io/ui-contracts-codegen

Generator of the MIDDAG contracts packages (`@middag-io/ui-contracts`,
`@middag-io/ui-contracts-pro`). It reads the JSON Schemas a PHP producer
emits, mirrored in the package's `schema/` directory, and writes TypeScript
types and zod schemas. Development dependency only.

## Package layout

```
contracts.config.json   settings
schema/*.json           mirror of the producer's schemas
schema/SOURCE.json      repository, tag, commit and sha256 of each mirrored file
src/generated/          output: types.ts, schemas.ts, meta.ts, index.ts
```

`contracts.config.json`:

| Key                | Meaning                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `schemas`          | mirrored files, in hash order                                          |
| `idPrefix`         | every schema `$id` must start with it                                  |
| `forbiddenIds`     | text that must not appear in the mirror (the other tier's `$id`)       |
| `out`              | output directory                                                       |
| `producer`         | Composer package of the producer                                       |
| `externals`        | `$ref` prefix of another contracts package -> module to import from    |
| `aliases`          | extra zod export -> `$def`                                             |
| `relaxBareObjects` | render a bare `{ "type": "object" }` as a string-keyed record          |
| `disjointWith`     | contracts package directories whose `$def` names must not be redefined |
| `commands`         | regenerate and check commands printed in the generated header          |

## CLI

```bash
middag-contracts-gen [generate] [--package <dir>] [--source <dir>]
middag-contracts-gen check [--package <dir>]
middag-contracts-gen compat --base <dir> [--package <dir>]
middag-contracts-gen mirror --repository <owner/name> --ref <tag> [--path schema] [--package <dir>]
middag-contracts-gen verify-source [--package <dir>]
```

- `generate` reads the mirror only. `--source` copies a local directory into the
  mirror first, with a warning, and marks `SOURCE.json` as local.
- `check` fails on stale or orphaned output, on a mirror that does not match
  `SOURCE.json`, on a local mirror and on a `$def` name shared with a
  `disjointWith` package.
- `compat` compares a previous mirror with the current one and fails on a
  breaking change without an `x-contract-version` bump.
- `mirror` fetches the schemas at a tag from GitHub, records the provenance,
  reports the compatibility level and regenerates. It does nothing when the tag
  carries the same schemas.
- `verify-source` fetches the files at the recorded commit and compares them
  with the mirror.

`mirror` and `verify-source` send `GITHUB_TOKEN` when it is set (needed for a
private producer). In GitHub Actions, `compat` and `mirror` write `level`
(`none`, `patch`, `additive`, `breaking`) and `changed` to `GITHUB_OUTPUT`.

## Output

- `types.ts`: one type per `$def` (json-schema-to-typescript).
- `schemas.ts`: one zod schema per `$def`, `<Name>Schema`, declared in
  dependency order; a recursive `$def` uses `z.lazy` and a `z.ZodType<Name>`
  annotation. Objects strip unknown keys.
- `meta.ts`: `CONTRACT_VERSION`, `SCHEMA_HASH` and `PRODUCER`.
- `index.ts`: barrel.

A `$ref` that matches an `externals` prefix becomes an import from the other
package (`import type` for the types, the `<Name>Schema` value for zod).
