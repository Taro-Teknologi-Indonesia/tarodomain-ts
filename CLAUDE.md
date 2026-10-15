# CLAUDE.md

TypeScript implementation of the TaroDomain framework. The spec, [`packages/tarodomain-spec/README.md`](packages/tarodomain-spec/README.md), is the source of truth. [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) maps it to code.

## Layer rules (spec §1.3, plan §2.2)

Every file in `packages/core/src/` lives in one layer directory. A module may import only from its own layer or from layers to its left:

```
kernel ◀─ domain ◀─ persistence ◀─ handlers ◀─ dispatch ◀─ platform ◀─ framework ◀─ entry
```

- **Domain imports only Kernel.** Domain code never touches persistence, buses or platforms.
- **Adapters and providers take their dependencies through constructor parameters.** Code in `platform/`, in core and in `@tarodomain/cloudflare`, never imports the builder (`TaroDomain`), `Framework`, `Container` or DI tokens. No service locators.
- **Persistence and Handlers may use `dispatch/bus/contracts.ts`** (`EventBus`, `EventHandler`), with `import type` only. No other layer gets this exception.
- **`@tarodomain/cloudflare` follows `platform ◀─ framework ◀─ entry`.** Import named bindings from `@tarodomain/core`, never `import * as`.
- **Core has no runtime dependencies.** `node:*` imports belong only in `platform/node/`.
- **Inside `src/`, import module files directly**, never a layer's `index.ts`. `src/index.ts` only has `export * from './<layer>/index.js'`. `framework/index.ts` and `entry/index.ts` use explicit named exports.

## Guardrails

`test/architecture.test.ts` in core and in cloudflare enforce these rules, using `tools/architecture.ts`. When a check fails, fix the import or move the code.

**Never weaken, skip or edit the architecture checks** (`tools/architecture.ts` and both `architecture.test.ts` files) to make a change pass. If a rule seems wrong, stop and ask.

## Conventions

- ESM only, with `.js` extensions in relative imports. No default exports, no decorators.
- Run `pnpm typecheck && pnpm test` before you finish a change.
