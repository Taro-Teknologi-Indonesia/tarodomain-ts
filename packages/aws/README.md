# @tarodomain/aws

> ⚠️ **Pre-release.** Not implemented yet — see the [implementation plan](https://github.com/Taro-Teknologi-Indonesia/tarodomain-ts/blob/main/IMPLEMENTATION_PLAN.md).

AWS provider for the [TaroDomain framework](https://github.com/Taro-Teknologi-Indonesia/tarodomain):

- DynamoDB adapters for the event store, snapshots, sagas, idempotency and dead letters
- An event bus on SQS (standard and FIFO), for eventual consistency
- The `AwsLambda` entry points (API Gateway, SQS, EventBridge)

```sh
npm install @tarodomain/core @tarodomain/aws
```

`@tarodomain/core` is a peer dependency, so install it alongside this package.

## License

MIT
