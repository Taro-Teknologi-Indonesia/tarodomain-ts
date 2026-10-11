# @tarodomain/core

> ⚠️ **Pre-release.** Not implemented yet — see the [implementation plan](https://github.com/Taro-Teknologi-Indonesia/tarodomain-ts/blob/main/IMPLEMENTATION_PLAN.md).

Core of the [TaroDomain framework](https://github.com/Taro-Teknologi-Indonesia/tarodomain) for TypeScript: DDD primitives, event sourcing, CQRS, projections, sagas (process managers), idempotency, dependency injection and the framework builder.

Platform-agnostic, with zero runtime dependencies. Includes in-memory adapters and a `LocalProvider` for development and tests. For production persistence, add a provider package:

- [`@tarodomain/cloudflare`](https://www.npmjs.com/package/@tarodomain/cloudflare): D1, Queues, Workers
- [`@tarodomain/aws`](https://www.npmjs.com/package/@tarodomain/aws): DynamoDB, SQS, Lambda

```sh
npm install @tarodomain/core
```

## License

MIT
