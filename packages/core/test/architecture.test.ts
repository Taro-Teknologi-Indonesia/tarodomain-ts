import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCoreLayers, readSourceTree, scanExportedNames, scanImports } from '../../../tools/architecture.js';

// Guardrail for spec §1.3 (IMPLEMENTATION_PLAN.md §2.2–2.3). When this fails, fix the
// import or move the code. Never weaken these checks to make a change pass.

const src = fileURLToPath(new URL('../src/', import.meta.url));

describe('§1.3 Layer dependencies', () => {
  it('src/ follows the layer import rules', () => {
    expect(checkCoreLayers(readSourceTree(src))).toEqual([]);
  });
});

describe('architecture checker', () => {
  const check = (files: Record<string, string>) => checkCoreLayers(new Map(Object.entries(files)));

  it('accepts imports from layers to the left', () => {
    expect(
      check({
        'kernel/errors.ts': 'export class FrameworkError extends Error {}',
        'domain/event.ts': "import { FrameworkError } from '../kernel/errors.js';",
        'persistence/event-store.ts': "import { DomainEvent } from '../domain/event.js';",
        'platform/local/memory-store.ts': "import type { EventStoreAdapter } from '../../persistence/contracts.js';",
      }),
    ).toEqual([]);
  });

  it('rejects an import from a layer to the right', () => {
    expect(check({ 'domain/event.ts': "import { EventStore } from '../persistence/event-store.js';" })).toEqual([
      expect.stringContaining('domain/event.ts:1 imports persistence/event-store.ts: domain may only import kernel, domain.'),
    ]);
  });

  it('rejects platform code that imports the framework (service locator)', () => {
    expect(check({ 'platform/local/provider.ts': "import type { Container } from '../../framework/container.js';" })).toEqual([
      expect.stringContaining('platform may only import'),
    ]);
  });

  it('lets persistence and handlers import the Event Bus contracts type-only', () => {
    expect(
      check({
        'persistence/repository.ts': "import type { EventBus } from '../dispatch/bus/contracts.js';",
        'handlers/projection/projection.ts': "import type { EventHandler } from '../../dispatch/bus/contracts.js';",
      }),
    ).toEqual([]);
  });

  it('rejects a runtime import of the Event Bus contracts from a lower layer', () => {
    expect(check({ 'handlers/command/handler.ts': "import { EventBus } from '../../dispatch/bus/contracts.js';" })).toEqual([
      expect.stringContaining('without `import type`'),
    ]);
  });

  it('keeps Domain off the Event Bus contracts', () => {
    expect(check({ 'domain/aggregate.ts': "import type { EventBus } from '../dispatch/bus/contracts.js';" })).toEqual([
      expect.stringContaining('domain may only import kernel, domain.'),
    ]);
  });

  it('keeps the Event Bus contracts free of runtime code and upper-layer imports', () => {
    expect(
      check({
        'dispatch/bus/contracts.ts': [
          "import type { DomainEvent } from '../../domain/event.js';",
          "import type { EventStore } from '../../persistence/event-store.js';",
          'export class NoopBus {}',
        ].join('\n'),
      }),
    ).toEqual([
      expect.stringContaining('dispatch/bus/contracts.ts:2: the Event Bus contracts may only use `import type` from domain/ and kernel/'),
      expect.stringContaining('no runtime code'),
    ]);
  });

  it('allows node:* only in platform/node/, and keeps platform/node/ out of the main entry', () => {
    expect(
      check({
        'platform/node/async-context.ts': "import { AsyncLocalStorage } from 'node:async_hooks';",
        'kernel/clock.ts': "import { setTimeout } from 'node:timers/promises';",
        'platform/index.ts': "export * from './node/async-context.js';",
      }),
    ).toEqual([
      expect.stringContaining('kernel/clock.ts:1 imports "node:timers/promises"'),
      expect.stringContaining('platform/index.ts:1 imports platform/node/async-context.ts'),
    ]);
  });

  it('rejects runtime dependencies', () => {
    expect(check({ 'kernel/uuid.ts': "import { v7 } from 'uuid';" })).toEqual([
      expect.stringContaining('@tarodomain/core has no runtime dependencies'),
    ]);
  });

  it('keeps testing/ and vitest out of the layers', () => {
    expect(
      check({
        'testing/event-store.ts': "import { describe } from 'vitest';\nimport type { EventStoreAdapter } from '../persistence/contracts.js';",
        'framework/builder.ts': "import { runEventStoreConformance } from '../testing/event-store.js';",
        'kernel/assert.ts': "import { expect } from 'vitest';",
      }),
    ).toEqual([
      expect.stringContaining('framework/builder.ts:1 imports testing/'),
      expect.stringContaining('kernel/assert.ts:1 imports vitest'),
    ]);
  });

  it('rejects barrel imports inside src/', () => {
    expect(check({ 'handlers/projection/projection.ts': "import { DomainEvent } from '../../domain/index.js';" })).toEqual([
      expect.stringContaining('imports the barrel domain/index.ts'),
    ]);
  });

  it('rejects files outside a layer directory', () => {
    expect(check({ 'utils.ts': 'export const x = 1;', 'helpers/strings.ts': 'export const y = 2;' })).toEqual([
      expect.stringContaining('utils.ts: every source file lives in a layer directory'),
      expect.stringContaining('"helpers/" is not a layer'),
    ]);
  });

  it('keeps the root barrel to `export *` of layer barrels', () => {
    expect(
      check({
        'index.ts': [
          "export * from './domain/index.js';",
          "export { TaroDomain as Builder } from './framework/index.js';",
          "export * from './testing/index.js';",
        ].join('\n'),
      }),
    ).toEqual([
      expect.stringContaining('index.ts:2: src/index.ts may only contain'),
      expect.stringContaining('index.ts:3: src/index.ts may only contain'),
      expect.stringContaining('index.ts:3 imports testing/'),
    ]);
  });

  it('requires explicit named exports in the framework and entry barrels', () => {
    expect(check({ 'framework/index.ts': "export * from './builder.js';" })).toEqual([
      expect.stringContaining('framework/index.ts: use explicit named exports'),
    ]);
  });

  it('ignores imports in comments and template literals', () => {
    expect(
      check({
        'domain/event.ts': [
          "// import { EventStore } from '../persistence/event-store.js';",
          "/* import '../framework/builder.js'; */",
          "const template = `import { TaroDomain } from '../framework/builder.js';`;",
        ].join('\n'),
      }),
    ).toEqual([]);
  });
});

describe('import scanner', () => {
  it('reads names, type-only imports and lines', () => {
    const source = [
      "import type { A, B as C } from './a.js';",
      'export { local };',
      'import D, {',
      '  type E,',
      '  F,',
      "} from './d.js';",
      "export * from './all.js';",
      "export * as ns from './ns.js';",
      "import './side-effect.js';",
      "const lazy = import('./lazy.js');",
    ].join('\n');

    expect(scanImports(source)).toEqual([
      { specifier: './a.js', line: 1, kind: 'import', typeOnly: true, names: ['A', 'B'], namespace: false, exportAll: false },
      { specifier: './d.js', line: 3, kind: 'import', typeOnly: false, names: ['default', 'E', 'F'], namespace: false, exportAll: false },
      { specifier: './all.js', line: 7, kind: 'export', typeOnly: false, names: [], namespace: true, exportAll: true },
      { specifier: './ns.js', line: 8, kind: 'export', typeOnly: false, names: [], namespace: true, exportAll: false },
      { specifier: './side-effect.js', line: 9, kind: 'side-effect', typeOnly: false, names: [], namespace: false, exportAll: false },
      { specifier: './lazy.js', line: 10, kind: 'dynamic', typeOnly: false, names: [], namespace: true, exportAll: false },
    ]);
  });

  it('reads exported names', () => {
    const source = [
      "export { TaroDomain, FrameworkBuilder as Builder } from './builder.js';",
      "export type { BuildOptions } from './options.js';",
      'export class Framework {}',
      'export abstract class Base {}',
      'export const enum Mode { Strong }',
      'export interface Settings {}',
      'export type Consistency = "strong" | "eventual";',
      'export async function build() {}',
    ].join('\n');

    expect(scanExportedNames(source)).toEqual({
      names: ['TaroDomain', 'Builder', 'BuildOptions', 'Framework', 'Base', 'Mode', 'Settings', 'Consistency', 'build'],
      hasExportStar: false,
    });
    expect(scanExportedNames("export * from './builder.js';").hasExportStar).toBe(true);
  });
});
