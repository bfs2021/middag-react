# src/ — Library Source

Source published as `@middag-io/react`.

## Layout

| Directory              | Contents                                                                     |
|------------------------|------------------------------------------------------------------------------|
| `app/`                 | ContractPage, registries, providers, register-defaults                       |
| `base/blocks/`         | block components (several lazy-loaded)                                       |
| `base/form/`           | FormField router, form-schema-builder (Zod), the registered field components |
| `base/layout/`         | StackLayout, SidebarLayout, DashboardLayout, WizardLayout                    |
| `base/shell/`          | BasicShell, ImmersiveShell, partials (sidebar, header, command palette)      |
| `base/theme/`          | Tokens, 4 CSS themes, theme-bridge, ThemeContext                             |
| `primitives/reui/`     | ReUI primitives (Radix/Base UI) — **DO NOT MODIFY**                          |
| `contracts/`           | TypeScript types (PageContract, BlockData, SharedProps, Navigation)          |
| `lib/`                 | Generic hooks and utils (cn, formatDate, etc.)                               |
| `assets/`              | Fonts (Figtree), Lottie animations                                           |
| `index.ts`             | Barrel export — public API of the library                                    |

## Rules

- `src/` never imports from `mock/`
- Changes to `contracts/` are breaking changes; check the impact first
- Removing an export from `index.ts` is a breaking change
- Imports use the `@/` alias for `src/`
- New components need tests
