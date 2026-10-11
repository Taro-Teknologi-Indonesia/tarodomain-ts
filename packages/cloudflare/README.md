# @tarodomain/cloudflare

> ⚠️ **Pre-release.** Not implemented yet — see the [implementation plan](https://github.com/Taro-Teknologi-Indonesia/tarodomain-ts/blob/main/IMPLEMENTATION_PLAN.md).

Cloudflare provider for the [TaroDomain framework](https://github.com/Taro-Teknologi-Indonesia/tarodomain):

- D1 (SQLite) adapters for the event store, snapshots, sagas, idempotency and dead letters
- A D1-backed unit of work, for strong consistency
- An event bus on Cloudflare Queues, for eventual consistency
- The `CloudflareWorker` entry point (`fetch`, `queue`, `scheduled`)

```sh
npm install @tarodomain/core @tarodomain/cloudflare
```

`@tarodomain/core` is a peer dependency, so install it alongside this package.

## License

MIT
