import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkProviderLayers, readCoreUpperExports, readSourceTree } from '../../../tools/architecture.js';

// Guardrail for spec §1.3 (IMPLEMENTATION_PLAN.md §2.3). Code in platform/ must never use
// core's builder, Framework or DI container. When this fails, pass the dependency in
// through a constructor instead. Never weaken these checks to make a change pass.

const src = fileURLToPath(new URL('../src/', import.meta.url));
const coreSrc = fileURLToPath(new URL('../../core/src/', import.meta.url));

describe('§1.3 Layer dependencies', () => {
  it('src/ follows the layer import rules', () => {
    expect(checkProviderLayers(readSourceTree(src), readCoreUpperExports(coreSrc))).toEqual([]);
  });
});

describe('provider architecture checker', () => {
  const core = {
    framework: new Set(['TaroDomain', 'Framework', 'Container', 'Token']),
    entry: new Set(['generatePackageJson']),
  };
  const check = (files: Record<string, string>) => checkProviderLayers(new Map(Object.entries(files)), core);

  it('lets platform code import contracts and lower layers from core', () => {
    expect(
      check({
        'platform/d1-event-store.ts': [
          "import type { EventStoreAdapter, SerializedEvent } from '@tarodomain/core';",
          "import { InMemoryEventBus, OptimisticConcurrencyError } from '@tarodomain/core';",
          "import type { DomainEvent } from '@tarodomain/core/domain';",
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('rejects platform code that takes the DI container (service locator)', () => {
    expect(check({ 'platform/d1-event-store.ts': "import type { Container, EventStoreAdapter } from '@tarodomain/core';" })).toEqual([
      expect.stringContaining("platform/d1-event-store.ts:1 imports `Container` from @tarodomain/core, which belongs to core's framework layer"),
    ]);
  });

  it('rejects platform code that uses the builder', () => {
    expect(check({ 'platform/provider.ts': "import { TaroDomain } from '@tarodomain/core';" })).toEqual([
      expect.stringContaining('constructor parameters'),
    ]);
  });

  it('lets framework code extend the builder with the platform', () => {
    expect(
      check({
        'framework/use-cloudflare.ts': [
          "import { TaroDomain } from '@tarodomain/core';",
          "import { CloudflareProvider } from '../platform/provider.js';",
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('keeps core entry names out of platform/ and framework/', () => {
    expect(check({ 'framework/templates.ts': "import { generatePackageJson } from '@tarodomain/core';" })).toEqual([
      expect.stringContaining("which belongs to core's entry layer"),
    ]);
  });

  it('rejects namespace imports of core, which hide the names used', () => {
    expect(check({ 'platform/provider.ts': "import * as core from '@tarodomain/core';" })).toEqual([
      expect.stringContaining('import named bindings from @tarodomain/core'),
    ]);
  });

  it('enforces platform ◀─ framework ◀─ entry inside the package', () => {
    expect(
      check({
        'platform/provider.ts': "import { useCloudflare } from '../framework/use-cloudflare.js';",
        'entry/worker.ts': "import { useCloudflare } from '../framework/use-cloudflare.js';",
      }),
    ).toEqual([expect.stringContaining('platform/provider.ts:1 imports framework/use-cloudflare.ts: platform/ may not import framework/')]);
  });

  it('checks core export paths', () => {
    expect(
      check({
        'platform/provider.ts': [
          "import { runEventStoreConformance } from '@tarodomain/core/testing';",
          "import { TaroDomain } from '@tarodomain/core/src/framework/builder.js';",
        ].join('\n'),
      }),
    ).toEqual([
      expect.stringContaining('Conformance suites are for tests only'),
      expect.stringContaining("which is not one of core's export paths"),
    ]);
  });

  it('rejects files outside platform/, framework/ and entry/', () => {
    expect(check({ 'adapters/d1.ts': '' })).toEqual([expect.stringContaining('"adapters/" is not a provider layer')]);
  });
});
