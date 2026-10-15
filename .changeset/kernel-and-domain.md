---
'@tarodomain/core': minor
---

Add the Kernel and Domain layers: the error hierarchy (all 51 codes), UUIDv7, backoff with jitter, stable hashing, `Clock`, `Logger` and ambient context storage; `DomainEvent`, `Command`, `ValueObject`, `AggregateId`, `AggregateRoot` and `ExecutionContext`. Domain models can import from the new `@tarodomain/core/domain` entry point.
