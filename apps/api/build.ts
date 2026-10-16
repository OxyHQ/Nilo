import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ROOT_MODULES = resolve(import.meta.dirname, '../../node_modules');

/** `zod` of `zod/v4`, `@scope/name` of `@scope/name/sub`. */
const packageName = (path: string) =>
  path
    .split('/')
    .slice(0, path.startsWith('@') ? 2 : 1)
    .join('/');

/**
 * Whether `importer`, a file of a bundled package, has its own copy of
 * `path`'s package in a nested node_modules. Left external, the import would
 * resolve from dist/ to the hoisted copy instead — another major for
 * `@oxy.so/mcp`'s zod 4 next to the API's zod 3, which fails only at startup.
 */
function hasOwnCopy(importer: string, path: string): boolean {
  const name = packageName(path);
  for (let dir = dirname(importer); dir.startsWith(ROOT_MODULES); dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return true;
  }
  return false;
}

await esbuild.build({
  // The migrator is a SECOND entry point, not part of the server bundle: the
  // deploy runs it as its own process, and `drizzle-kit migrate` is not an
  // option because drizzle-kit is a devDependency and the production image
  // installs with --production. Without this line `dist/` has no migrator at
  // all, which a passing build says nothing about.
  // The Noted import (`src/scripts/import-noted.ts`) is a third, and the
  // capability catalog registration a fourth: one-shots run with this image,
  // so they have to be in it.
  entryPoints: [
    'src/index.ts',
    'src/db/migrate.ts',
    'src/scripts/import-noted.ts',
    'src/scripts/register-capability-catalog.ts',
  ],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  outbase: 'src',
  // Keep node_modules external except @oxy.so/* (their ESM builds have broken imports)
  plugins: [
    {
      name: 'externalize-except-oxyhq',
      setup(build) {
        // Let @oxy.so/* packages be bundled (their ESM has missing .js extensions)
        build.onResolve({ filter: /^@oxyhq\// }, () => undefined);
        // Externalize all other bare imports (node_modules)
        build.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@oxy.so/')) return undefined;
          // Workspace packages ship TypeScript source: bundle them.
          if (args.path.startsWith('@nilo/')) return undefined;
          // A bundled package's own copy of a dependency is bundled with it.
          if (hasOwnCopy(args.importer, args.path)) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

// The generated SQL. `src/db/migrate.ts` resolves this folder relative to its
// own module URL and throws when no journal is there, so a build that silently
// skipped this step fails loudly at migrate time instead of reporting a clean
// run over zero migrations. Deliberately NOT wrapped in try/catch: a build that
// cannot ship the migrations must fail, not warn.
await cp('src/drizzle', 'dist/drizzle', { recursive: true });
