# Contributing to @middag-io/react

## Prerequisites

```bash
node -v   # >= 18 (team uses Node 24)
npm -v    # >= 10
git --version
```

Run the doctor to validate your environment:

```bash
npm run doctor
```

## Setup

```bash
git clone git@github.com:middag-io/middag-react.git
cd middag-react
npm install
npm run dev        # demo harness (demo/) — http://localhost:5173
```

## Development workflow

1. Create a branch from `main`: `git checkout -b feat/my-feature`
2. Make changes in `src/` (lib) or `demo/` (demo harness)
3. Run checks before committing:
   ```bash
   npm run typecheck    # tsc --noEmit
   npm run lint:fix     # ESLint auto-fix
   npm test             # Vitest
   ```
4. Commit with Conventional Commits format (enforced by git hook):
   ```bash
   git commit -m "feat(blocks): add chart block type"
   ```
5. Push and open a PR against `main`

Versioning is automated: [release-please](https://github.com/googleapis/release-please)
scans Conventional Commits on `main` and opens the release PR. Your commit type
decides the bump (`feat`/breaking = minor, `fix` = patch) — no manual version step.

## Git hooks

Configured via `.githooks/` (activated by `npm run prepare`):

| Hook         | What it checks                            |
|--------------|-------------------------------------------|
| `pre-commit` | Typecheck + lint on staged files          |
| `commit-msg` | Conventional Commits format               |
| `pre-push`   | Typecheck + contract drift + lib build    |

Commit types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`

Format: `type(scope): description` or `type: description`

## What to modify

### Free to modify

- `demo/` — dev harness, not published
- `src/base/` — shells, layouts, blocks, hooks
- `src/lib/` — utils and generic hooks

### Modify with care (breaking changes)

- `src/contracts/` — types consumed by Moodle/WP hosts
- `src/index.ts` — barrel export (removing = breaking)
- `src/engine/registries.ts` — registration API

### Do NOT modify

- `src/primitives/reui/` — synced from ReUI registry
- `src/primitives/examples/` — synced via `npm run sync:examples` (dev-only gallery, not published)
- `src/contracts/generated/`, `packages/contracts/src/generated/` and
  `packages/contracts/schema/` — generated or mirrored from a php-ui release
  (`npm run gen:contracts`, `npm run contracts:mirror`); never hand-edit

## Adding a new block

1. Define data contract in `src/contracts/block-data/`
2. Create component in `src/base/blocks/` implementing `BlockProps<TData>`
3. Register in `src/engine/register-defaults.ts`: `registerBlock('type_key', Component)`
4. Add a demo page/fixture in `demo/` to preview the block
5. Add tests in `tests/blocks/`

## Contract codegen

The wire contract is owned by the backend value objects of
[`middag-io/ui`](https://github.com/middag-io/middag-php-ui), not hand-written
here. It lives in `packages/contracts` (`@middag-io/ui-contracts`):

- `packages/contracts/schema/` mirrors `schema/*.json` of a php-ui release tag,
  and `schema/SOURCE.json` records the repository, tag, commit and hashes.
- `packages/contracts-codegen` (`@middag-io/ui-contracts-codegen`) generates
  `packages/contracts/src/generated/` from that mirror.
- Until the engine depends on the published package, `src/contracts/generated/`
  is a copy of the generated types and zod schemas, and
  `docs/public/schemas/` a copy of the schemas.

Commands:

- `npm run gen:contracts` regenerates the package and both copies from the mirror.
- `npm run gen:contracts:check` gates drift in CI and in the pre-push hook.
- `npm run contracts:mirror -- vX.Y.Z` mirrors a php-ui release (normally done
  by the `Contracts mirror` workflow when php-ui releases).
- For an unreleased php-ui checkout:
  `node packages/contracts-codegen/bin/middag-contracts-gen.mjs --package packages/contracts --source ../middag-php-ui/schema`.
  The mirror is then marked local and the drift gate fails until a release is
  mirrored.

See `packages/contracts/README.md` for the versioning and compatibility rules.

## Code style

### TypeScript

- Strict mode (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- `no-explicit-any` as warning — avoid, use `_` prefix for unused params
- Types exported via barrel (`src/index.ts`)

### Naming

- **Components:** PascalCase (`DenseTableBlock.tsx`)
- **Functions/hooks:** camelCase (`useTranslation`, `registerBlock`)
- **Files:** kebab-case (`page-contract.ts`, `use-copy-to-clipboard.ts`)
- **Block type keys:** snake_case (`dense_table`, `metric_card`)

### CSS / Tailwind

- Tailwind CSS v4 with semantic tokens — never inline CSS
- Use `cn()` from `@/lib/utils` for conditional class merging
- Semantic tokens: `text-foreground`, `bg-background`, `text-muted-foreground`, `border`, `ring`
- Color space: OKLCH
- Grid: 8px
- Font: Figtree

### Imports

- Path alias: `@/` -> `src/`
- Always use aliases for cross-directory imports
- Never use relative paths (`../../`) to leave the current directory
- `src/` never imports from `demo/` (one-way dependency)

## i18n rules

- Every visible string must use i18n keys
- Internal lib strings use `middag.ui.*` keys with built-in EN defaults

### i18next workflow

The library runs on i18next (see [`src/i18n/MANIFEST.md`](src/i18n/MANIFEST.md)).
i18n keys are extracted via `npm run i18n:extract`. Author UI strings with
`t('key')` and add the pt-BR translations in `src/i18n/locales/pt-BR/*.json`.
Host strings come from the host (Moodle component / WP text-domain) at runtime —
never bundle them. Extraction is configured `keepRemoved: true` (additive), so it
scaffolds new keys but never deletes existing catalog entries.

## What to avoid

- Don't create `.md` files outside of `docs/`
- Don't install dependencies without justification (bundle size is critical)
- Don't modify contracts without checking consumer impact
- Don't use inline CSS — use Tailwind tokens
- Don't hardcode strings — use i18n keys
- Don't import from `demo/` inside `src/`
- Don't use `any` when a precise type exists
- Don't create abstractions without real need (DRY doesn't justify a single-use wrapper)

## Support

For questions or issues, open a GitHub issue. Security reports: see [`SECURITY.md`](./SECURITY.md).
