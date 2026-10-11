# tarodomain-ts

TypeScript implementation of the [TaroDomain framework](https://github.com/Taro-Teknologi-Indonesia/tarodomain): event sourcing, CQRS and DDD with strong and eventual consistency, on Cloudflare, AWS or locally.

> Status: scaffolding. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the roadmap.

## Layout

| Path | Package | Purpose |
|---|---|---|
| `packages/core` | `@tarodomain/core` | Platform-agnostic framework, in-memory adapters, `LocalProvider` |
| `packages/cloudflare` | `@tarodomain/cloudflare` | D1 adapters, Queues event bus, Worker entry point |
| `packages/aws` | `@tarodomain/aws` | DynamoDB adapters, SQS event bus, Lambda entry points |
| `packages/tarodomain-spec` | — | Design spec (git submodule, not a workspace package) |
| `examples/bank-account` | — | Reference application |

## Getting started

```sh
git clone --recurse-submodules <this repo>   # or: git submodule update --init
pnpm install
pnpm build       # build all packages (dependency order)
pnpm typecheck   # typecheck packages, tests and examples
pnpm test        # run all tests with vitest
```

Requires Node.js ≥ 22.13 and pnpm 10.

## Releasing

Each package under `packages/` is versioned and published to npm independently, using [Changesets](https://github.com/changesets/changesets):

```sh
pnpm changeset   # describe a change: pick packages and bump types
```

The **Release** GitHub workflow is currently manual (`workflow_dispatch`). Run it once to open a "Version Packages" PR. Run it again after merging that PR to publish. Publishing needs an `NPM_TOKEN` repository secret. See [IMPLEMENTATION_PLAN.md §8](IMPLEMENTATION_PLAN.md#8-publishing).

## Notes

Workspace packages export a `source` condition that points at `src/index.ts`. Typechecking and tests use it, so you never need to build before testing. Published builds resolve to `dist/`.
