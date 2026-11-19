# @middag-io/ui-contracts

TypeScript types and zod schemas of the MIDDAG UI wire contract: the page
contract and fragment payloads a PHP host sends to the React frontend through
Inertia.

The source of truth is PHP. The value objects of
[`middag-io/ui`](https://github.com/middag-io/middag-php-ui) emit JSON Schema
(draft 2020-12) with `composer emit:schemas`; this package mirrors those
schemas from a tagged release and generates the TypeScript from them. Nothing
here is written by hand.

```
middag-io/ui value objects -> schema/*.json (php-ui release tag)
  -> packages/contracts/schema/ (mirror + SOURCE.json)
  -> @middag-io/ui-contracts-codegen
  -> src/generated/ -> dist/ -> npm
```

## Install

```bash
npm install @middag-io/ui-contracts zod
```

Published to public npm, with a copy on GitHub Packages. `zod` is an optional
peer: the types alone (`@middag-io/ui-contracts/types`) need no runtime.

## Use

```ts
import type { PageContract, Fragment } from "@middag-io/ui-contracts";
import { PageContractSchema, pageContractSchemaCore } from "@middag-io/ui-contracts";
import { CONTRACT_VERSION, SCHEMA_HASH, PRODUCER } from "@middag-io/ui-contracts/meta";
import pageContract from "@middag-io/ui-contracts/schemas/page-contract.json";
```

| Entry | Contents |
|---|---|
| `.` | types, zod schemas and contract metadata |
| `./types` | types only |
| `./meta` | `CONTRACT_VERSION`, `SCHEMA_HASH`, `PRODUCER` (repository, tag and commit of the mirrored release) |
| `./schemas/*.json` | the raw JSON Schemas and `SOURCE.json` |

Every `$def` has a type (`PageContract`) and a zod schema (`PageContractSchema`).
`pageContractSchemaCore` and `fragmentSchemaCore` are kept as aliases of the two
roots.

The zod schemas are lenient: an object strips unknown keys instead of rejecting
them, so a newer producer or a host overlay does not break validation. The
TypeScript types keep the strict shape.

## Versioning

The package versions on its own, not with `@middag-io/react` or the PHP library.

| Wire change | npm |
|---|---|
| breaking (`x-contract-version` goes up) | major (minor while 0.x) |
| additive: new `$def`, new optional field, new enum value | minor |
| regeneration with no wire change | patch |

A new enum value is additive. A `switch` over a contract enum needs a `default`
branch.

The compatibility gate compares a new mirror with the previous one and fails
when a `$def` or field is removed, a field becomes required or a type narrows
without an `x-contract-version` bump.

## FREE and PRO

This package carries only what `middag-io/ui` emits (`$id` under
`https://ui-docs.middag.io/`). The premium contract lives in
`@middag-io/ui-contracts-pro`, generated from `middag-io/core`, which depends on
this package as a peer and references its types instead of copying them. The
generator refuses a schema with a premium `$id`, and `pack-check` fails if the
tarball mentions the premium host or declares a `$def` the FREE schemas do not
define.

## Updating the mirror

A php-ui release dispatches an event to this repository; the
`Contracts mirror` workflow copies `schema/` from the tag, records it in
`schema/SOURCE.json`, regenerates the sources and opens a pull request. Nothing
happens when the release carries the same schemas.

By hand, from the repository root:

```bash
npm run contracts:mirror -- --ref v1.10.1
```

For local development against an unreleased php-ui checkout:

```bash
node packages/contracts-codegen/bin/middag-contracts-gen.mjs --package packages/contracts --source ../middag-php-ui/schema
```

That marks `SOURCE.json` as local, and the drift gate fails until a release is
mirrored, so a local mirror cannot be merged by accident.

## Gates (repository root)

| Command | Checks |
|---|---|
| `npm run gen:contracts:check` | generated sources, orphans, `SOURCE.json` hashes, engine copy |
| `npm run contracts:verify-source` | the mirror equals the files at the recorded php-ui commit (network) |
| `npm run contracts:build` + `npm run contracts:pack-check` | build and tarball contents |
