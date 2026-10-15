/**
 * Layer dependency checks: spec §1.3, IMPLEMENTATION_PLAN.md §2.2–2.3.
 *
 * Used by the architecture tests in `@tarodomain/core` and `@tarodomain/cloudflare`.
 * TypeScript 7 has no JavaScript parser API, so this scans source text. Comments and
 * template literals are blanked first, so code that generates source (templates) and
 * commented-out imports are ignored.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

/** Core layers in dependency order: a layer may import only itself and layers to its left. */
export const CORE_LAYERS = [
  'kernel',
  'domain',
  'persistence',
  'handlers',
  'dispatch',
  'platform',
  'framework',
  'entry',
] as const;
export type CoreLayer = (typeof CORE_LAYERS)[number];

/** Layers a provider package (such as `@tarodomain/cloudflare`) may contain. */
export const PROVIDER_LAYERS = ['platform', 'framework', 'entry'] as const;

const BUS_CONTRACTS = 'dispatch/bus/contracts.ts';
const NODE_ONLY_DIR = 'platform/node/';
const CORE_PACKAGE = '@tarodomain/core';
const CORE_SUBPATHS: Readonly<Record<string, CoreLayer | 'testing'>> = {
  domain: 'domain',
  'async-context': 'platform',
  testing: 'testing',
};
const SEE_RULES = 'See spec §1.3 and IMPLEMENTATION_PLAN.md §2.2.';

/** Relative POSIX path (from `src/`) → file contents. */
export type SourceTree = ReadonlyMap<string, string>;

export interface ImportRef {
  specifier: string;
  line: number;
  kind: 'import' | 'export' | 'side-effect' | 'dynamic';
  /** `import type …` or `export type … from`. Erased at runtime. */
  typeOnly: boolean;
  /** Names taken from the target module (`default` for a default import). */
  names: string[];
  /** `import * as ns`, `export *` or a dynamic import: the names used can't be seen. */
  namespace: boolean;
  /** `export * from '…'` without an alias. */
  exportAll: boolean;
}

export interface ExportedNames {
  names: string[];
  /** Contains `export * from '…'`, which hides the names it re-exports. */
  hasExportStar: boolean;
}

/** Names exported by core's Framework and Entry layers, which provider `platform/` code must not import. */
export interface CoreUpperExports {
  framework: ReadonlySet<string>;
  entry: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Scanning

/** Blanks comments and template literals (keeping newlines and length), so offsets and lines still match. */
export function stripNonCode(source: string): string {
  const out = source.split('');
  const blank = (index: number): void => {
    if (index < out.length && out[index] !== '\n') out[index] = ' ';
  };
  // Code inside a template literal's `${…}` is blanked too; `depth` tracks its braces.
  const stack: { kind: 'code' | 'template'; depth: number; blanked: boolean }[] = [
    { kind: 'code', depth: 0, blanked: false },
  ];
  let i = 0;
  while (i < source.length) {
    const ctx = stack[stack.length - 1]!;
    const ch = source[i];
    const next = source[i + 1];

    if (ctx.kind === 'template') {
      blank(i);
      if (ch === '\\') {
        blank(i + 1);
        i += 2;
      } else if (ch === '`') {
        stack.pop();
        i += 1;
      } else if (ch === '$' && next === '{') {
        blank(i + 1);
        stack.push({ kind: 'code', depth: 0, blanked: true });
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') blank(i++);
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) blank(i++);
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (ctx.blanked) blank(i);
      i += 1;
      while (i < source.length && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') {
          if (ctx.blanked) blank(i);
          i += 1;
        }
        if (ctx.blanked) blank(i);
        i += 1;
      }
      if (ctx.blanked) blank(i);
      i += 1;
      continue;
    }
    if (ch === '`') {
      blank(i);
      stack.push({ kind: 'template', depth: 0, blanked: true });
      i += 1;
      continue;
    }
    if (ch === '{') ctx.depth += 1;
    if (ch === '}') {
      if (ctx.depth === 0 && stack.length > 1) {
        blank(i);
        stack.pop();
        i += 1;
        continue;
      }
      ctx.depth -= 1;
    }
    if (ctx.blanked) blank(i);
    i += 1;
  }
  return out.join('');
}

// import/export … from '…'. The clause is spelled out (default, `{ … }`, `* as x`) so an
// `export { a }` with no `from` can't swallow the next statement.
const FROM_RE =
  /(?:^|;)[ \t]*(import|export)\b(?:\s+(type)(?=[\s{*]))?(?:\s+([\w$]+)\s*,?)?\s*(\{[^}]*\}|\*(?:\s*as\s+[\w$]+)?)?\s*from\s*(['"])([^'"\n]+)\5/gm;
const SIDE_EFFECT_RE = /(?:^|;)[ \t]*import\s*(['"])([^'"\n]+)\1/gm;
const DYNAMIC_RE = /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g;

const EXPORT_LIST_RE = /(?:^|;)[ \t]*export\b(?:\s+type\b)?\s*\{([^}]*)\}/gm;
const EXPORT_STAR_RE = /(?:^|;)[ \t]*export\b(?:\s+type\b)?\s*\*\s*(?:as\s+([\w$]+))?/gm;
const EXPORT_DECL_RE =
  /(?:^|;)[ \t]*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\*?|const\s+enum|const|let|var|interface|type|enum|namespace)\s+([\w$]+)/gm;
const EXPORT_DEFAULT_RE = /(?:^|;)[ \t]*export\s+default\b/m;
const RUNTIME_DECL_RE =
  /(?:^|;)[ \t]*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|enum|namespace)\b/m;

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line += 1;
  return line;
}

function listItems(braces: string): string[] {
  return braces
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^type\s+/, ''))
    .filter((item) => item.length > 0);
}

export function scanImports(source: string): ImportRef[] {
  const code = stripNonCode(source);
  const refs: ImportRef[] = [];

  for (const m of code.matchAll(FROM_RE)) {
    const kind = m[1] as 'import' | 'export';
    const star = m[4]?.startsWith('*') ? m[4] : undefined;
    const braces = m[4]?.startsWith('{') ? m[4] : undefined;
    const names = braces ? listItems(braces).map((item) => item.split(/\s+as\s+/)[0]!.trim()) : [];
    if (m[3]) names.unshift('default');
    refs.push({
      specifier: m[6]!,
      line: lineAt(code, (m.index ?? 0) + m[0].indexOf(kind)),
      kind,
      typeOnly: m[2] === 'type',
      names,
      namespace: star !== undefined,
      exportAll: kind === 'export' && star !== undefined && !/\bas\b/.test(star),
    });
  }
  for (const m of code.matchAll(SIDE_EFFECT_RE)) {
    refs.push({
      specifier: m[2]!,
      line: lineAt(code, (m.index ?? 0) + m[0].indexOf('import')),
      kind: 'side-effect',
      typeOnly: false,
      names: [],
      namespace: false,
      exportAll: false,
    });
  }
  for (const m of code.matchAll(DYNAMIC_RE)) {
    refs.push({
      specifier: m[2]!,
      line: lineAt(code, m.index ?? 0),
      kind: 'dynamic',
      typeOnly: false,
      names: [],
      namespace: true,
      exportAll: false,
    });
  }
  return refs.sort((a, b) => a.line - b.line);
}

export function scanExportedNames(source: string): ExportedNames {
  const code = stripNonCode(source);
  const names: string[] = [];
  let hasExportStar = false;

  for (const m of code.matchAll(EXPORT_LIST_RE)) {
    for (const item of listItems(m[1]!)) names.push(item.split(/\s+as\s+/).pop()!.trim());
  }
  for (const m of code.matchAll(EXPORT_STAR_RE)) {
    if (m[1]) names.push(m[1]);
    else hasExportStar = true;
  }
  for (const m of code.matchAll(EXPORT_DECL_RE)) names.push(m[1]!);
  if (EXPORT_DEFAULT_RE.test(code)) names.push('default');

  return { names: [...new Set(names)], hasExportStar };
}

/** Reads every `.ts` file under `dir`, keyed by its POSIX path relative to `dir`. Missing dir → empty. */
export function readSourceTree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) files.set(relative(dir, full).split(sep).join('/'), readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return files;
}

/** Reads the names exported by core's `framework/index.ts` and `entry/index.ts`. */
export function readCoreUpperExports(coreSrc: string): CoreUpperExports {
  const read = (layer: 'framework' | 'entry'): Set<string> => {
    const path = join(coreSrc, layer, 'index.ts');
    if (!existsSync(path)) return new Set();
    const { names, hasExportStar } = scanExportedNames(readFileSync(path, 'utf8'));
    if (hasExportStar) {
      throw new Error(
        `core/src/${layer}/index.ts uses \`export *\`. Use explicit named exports so provider layer checks can see them.`,
      );
    }
    return new Set(names);
  };
  return { framework: read('framework'), entry: read('entry') };
}

// ---------------------------------------------------------------------------
// Rules

function topDir(path: string): string | null {
  const slash = path.indexOf('/');
  return slash === -1 ? null : path.slice(0, slash);
}

function isCoreLayer(name: string | null): name is CoreLayer {
  return name !== null && (CORE_LAYERS as readonly string[]).includes(name);
}

function rank(layer: CoreLayer): number {
  return CORE_LAYERS.indexOf(layer);
}

function allowedFor(layer: CoreLayer): string {
  return CORE_LAYERS.slice(0, rank(layer) + 1).join(', ');
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** Resolves a relative specifier to a `src/`-relative `.ts` path, or `null` if it leaves `src/`. */
function resolveRelative(file: string, specifier: string): string | null {
  const joined = posix.normalize(posix.join(posix.dirname(file), specifier));
  if (joined === '..' || joined.startsWith('../')) return null;
  return joined.replace(/\.js$/, '.ts');
}

function isBarrel(path: string): boolean {
  return path === 'index.ts' || path.endsWith('/index.ts');
}

/** Checks `packages/core/src/` against the layer rules. Returns one message per violation. */
export function checkCoreLayers(files: SourceTree): string[] {
  const out: string[] = [];

  for (const [file, source] of files) {
    const layer = topDir(file);
    if (layer === null) {
      if (file !== 'index.ts') {
        out.push(`${file}: every source file lives in a layer directory (${CORE_LAYERS.join(', ')}) or testing/.`);
      }
    } else if (layer !== 'testing' && !isCoreLayer(layer)) {
      out.push(`${file}: "${layer}/" is not a layer. Layers are ${CORE_LAYERS.join(', ')}, plus testing/.`);
    }

    for (const ref of scanImports(source)) {
      const at = `${file}:${ref.line}`;

      if (!isRelative(ref.specifier)) {
        if (ref.specifier.startsWith('node:')) {
          if (!file.startsWith(NODE_ONLY_DIR)) {
            out.push(`${at} imports "${ref.specifier}". node:* built-ins are allowed only in ${NODE_ONLY_DIR}, so core runs on Workers.`);
          }
        } else if (ref.specifier === 'vitest' || ref.specifier.startsWith('vitest/')) {
          if (layer !== 'testing') out.push(`${at} imports vitest. Only testing/ may import it.`);
        } else {
          out.push(`${at} imports the package "${ref.specifier}". @tarodomain/core has no runtime dependencies.`);
        }
        continue;
      }

      const target = resolveRelative(file, ref.specifier);
      if (target === null) {
        out.push(`${at} imports "${ref.specifier}", which is outside src/.`);
        continue;
      }
      const targetLayer = topDir(target);

      if (file === 'index.ts') {
        const barrelLayer = /^\.\/([a-z]+)\/index\.js$/.exec(ref.specifier)?.[1] ?? null;
        if (!ref.exportAll || !isCoreLayer(barrelLayer)) {
          out.push(
            `${at}: src/index.ts may only contain \`export * from './<layer>/index.js'\`, so every public name maps to one layer (provider layer checks rely on this).`,
          );
        }
      }
      if (isBarrel(target) && !isBarrel(file)) {
        out.push(`${at} imports the barrel ${target}. Inside src/, import the module file directly; barrels are for the public API.`);
      }
      if (targetLayer === 'testing' && layer !== 'testing') {
        out.push(`${at} imports testing/. Conformance suites are for tests only (the ./testing export).`);
      }
      if (target.startsWith(NODE_ONLY_DIR) && !file.startsWith(NODE_ONLY_DIR)) {
        out.push(`${at} imports ${target}. ${NODE_ONLY_DIR} is reachable only through the ./async-context export, so the main entry stays free of node:* imports.`);
      }

      if (file === BUS_CONTRACTS) {
        const allowed = targetLayer === 'domain' || targetLayer === 'kernel';
        if (!allowed || !ref.typeOnly) {
          out.push(`${at}: the Event Bus contracts may only use \`import type\` from domain/ and kernel/. ${SEE_RULES}`);
        }
      }

      if (isCoreLayer(layer) && isCoreLayer(targetLayer) && rank(targetLayer) > rank(layer)) {
        const contractsException = target === BUS_CONTRACTS && (layer === 'persistence' || layer === 'handlers');
        if (!contractsException) {
          out.push(`${at} imports ${target}: ${layer} may only import ${allowedFor(layer)}. ${SEE_RULES}`);
        } else if (!ref.typeOnly) {
          out.push(`${at} imports the Event Bus contracts without \`import type\`. ${layer} may use them type-only. ${SEE_RULES}`);
        }
      }
    }

    if (file === BUS_CONTRACTS && RUNTIME_DECL_RE.test(stripNonCode(source))) {
      out.push(`${file}: the Event Bus contracts hold only interfaces and types, no runtime code. ${SEE_RULES}`);
    }
    if ((file === 'framework/index.ts' || file === 'entry/index.ts') && scanExportedNames(source).hasExportStar) {
      out.push(`${file}: use explicit named exports, not \`export *\`, so provider layer checks can see these names.`);
    }
  }
  return out;
}

/**
 * Checks a provider package's `src/` (such as `@tarodomain/cloudflare`): its own
 * `platform ◀─ framework ◀─ entry` order, and which core names each directory may import.
 */
export function checkProviderLayers(files: SourceTree, core: CoreUpperExports): string[] {
  const out: string[] = [];
  const providerLayer = (name: string | null): CoreLayer | null =>
    name !== null && (PROVIDER_LAYERS as readonly string[]).includes(name) ? (name as CoreLayer) : null;

  for (const [file, source] of files) {
    const dir = topDir(file);
    const layer = providerLayer(dir);
    if (dir === null && file !== 'index.ts') {
      out.push(`${file}: every source file lives in ${PROVIDER_LAYERS.join('/, ')}/.`);
    } else if (dir !== null && layer === null) {
      out.push(`${file}: "${dir}/" is not a provider layer. Use ${PROVIDER_LAYERS.join('/, ')}/.`);
    }

    for (const ref of scanImports(source)) {
      const at = `${file}:${ref.line}`;

      if (isRelative(ref.specifier)) {
        const target = resolveRelative(file, ref.specifier);
        const targetLayer = target === null ? null : providerLayer(topDir(target));
        if (layer !== null && targetLayer !== null && rank(targetLayer) > rank(layer)) {
          out.push(`${at} imports ${target}: ${layer}/ may not import ${targetLayer}/. ${SEE_RULES}`);
        }
        continue;
      }

      if (ref.specifier === CORE_PACKAGE) {
        if (ref.namespace) {
          out.push(`${at}: import named bindings from ${CORE_PACKAGE}, not a namespace or \`export *\`, so the layer check can see them.`);
          continue;
        }
        for (const name of ref.names) {
          if (layer === 'platform' && core.framework.has(name)) {
            out.push(
              `${at} imports \`${name}\` from ${CORE_PACKAGE}, which belongs to core's framework layer. Code in platform/ receives its dependencies through constructor parameters, never from the builder, Framework or DI container. ${SEE_RULES}`,
            );
          }
          if ((layer === 'platform' || layer === 'framework') && core.entry.has(name)) {
            out.push(`${at} imports \`${name}\` from ${CORE_PACKAGE}, which belongs to core's entry layer. Only entry/ may use it. ${SEE_RULES}`);
          }
        }
        continue;
      }

      if (ref.specifier.startsWith(`${CORE_PACKAGE}/`)) {
        const subpath = ref.specifier.slice(CORE_PACKAGE.length + 1);
        const mapped = CORE_SUBPATHS[subpath];
        if (mapped === undefined) {
          out.push(`${at} imports "${ref.specifier}", which is not one of core's export paths.`);
        } else if (mapped === 'testing') {
          out.push(`${at} imports ${ref.specifier}. Conformance suites are for tests only.`);
        } else if (layer !== null && rank(mapped) > rank(layer)) {
          out.push(`${at} imports ${ref.specifier}: ${layer}/ may not import core's ${mapped} layer. ${SEE_RULES}`);
        }
      }
    }
  }
  return out;
}
