/**
 * Every test, check and typecheck this repository defines must be RUN by CI.
 *
 * `test:worker` sat in the root package.json, passing, while no workflow ever
 * ran it: a suite that is green and inert reports exactly what a suite that is
 * green and enforced reports. This fails when:
 *  - a workspace script named `test`, `test:*`, `check`, `check:*` or
 *    `typecheck` (other than the interactive `:watch` and the `:coverage`
 *    variant) is not invoked by `.github/workflows/ci.yml` — `bun run <name>`
 *    at the root, `bun run --filter <package> <name>` in a workspace;
 *  - a tracked `*.test.*` file outside the trees a runner owns (below) is not
 *    named by any root script, so no runner reaches it;
 *  - the command that runs an owned tree's runner is not invoked by CI;
 *  - it found fewer scripts or test files than exist today, i.e. it is
 *    looking at the wrong files.
 *
 * Comment lines in the workflow do not count as invoking anything.
 *
 * Usage: `bun run check:ci-wiring`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW = '.github/workflows/ci.yml';
/**
 * Trees whose every `*.test.*` file a runner finds by itself, and the CI
 * command that runs that runner. The API's vitest configs own `apps/api/src`
 * (unit and pgdb), the app's jest (jest-expo's default match) owns `apps/app`,
 * the end-to-end config (`e2e/vitest.config.ts`) owns `e2e`, and the SDK's
 * vitest owns `packages/sdk`.
 */
const OWNED_TREES = [
  { root: 'apps/api/src/', command: 'bun run --filter @nilo/api test' },
  { root: 'apps/app/', command: 'bun run --filter @nilo/app test' },
  { root: 'e2e/', command: 'bun run test:e2e' },
  { root: 'packages/sdk/', command: 'bun run --filter @oxy.so/nilo test' },
] as const;
const GATED_SCRIPT = /^(test|check|typecheck)(:.+)?$/u;
const EXEMPT_SCRIPT = /:(watch|coverage)$/u;
const TEST_FILE = /\.test\.(ts|tsx|js|jsx|mjs|cjs)$/u;

interface Manifest {
  name?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
}

const readJson = (path: string): Manifest => JSON.parse(readFileSync(path, 'utf8'));
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export function checkCiWiring(root: string): { errors: string[]; summary: string } {
  const errors: string[] = [];
  const workflow = readFileSync(join(root, WORKFLOW), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const invoked = (command: string) =>
    new RegExp(`(^|[\\s;&|(])${escapeRegExp(command)}($|[\\s;&|)])`, 'mu').test(workflow);

  const rootManifest = readJson(join(root, 'package.json'));
  const rootScripts = rootManifest.scripts ?? {};
  let scriptCount = 0;

  for (const [manifestPath, prefix] of [
    ['package.json', 'bun run'] as const,
    ...(rootManifest.workspaces ?? []).map((workspace) => {
      const path = join(workspace, 'package.json');
      return [path, `bun run --filter ${readJson(join(root, path)).name}`] as const;
    }),
  ]) {
    for (const name of Object.keys(readJson(join(root, manifestPath)).scripts ?? {})) {
      if (!GATED_SCRIPT.test(name) || EXEMPT_SCRIPT.test(name)) continue;
      scriptCount += 1;
      if (!invoked(`${prefix} ${name}`)) {
        errors.push(
          `${manifestPath} defines "${name}", but ${WORKFLOW} never runs \`${prefix} ${name}\`.`,
        );
      }
    }
  }

  const rootCommands = Object.values(rootScripts).join('\n');
  const testFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((path) => TEST_FILE.test(path));
  for (const tree of OWNED_TREES) {
    if (!invoked(tree.command)) {
      errors.push(`${WORKFLOW} never runs \`${tree.command}\`, the runner of ${tree.root}.`);
    }
  }
  const outside = testFiles.filter(
    (path) => !OWNED_TREES.some((tree) => path.startsWith(tree.root)),
  );
  for (const path of outside) {
    if (!rootCommands.includes(path)) {
      errors.push(`${path} is a test file no root package.json script names, so CI never runs it.`);
    }
  }

  // Vacuity floors: today's counts. Raise them when adding; never lower them to pass.
  if (scriptCount < 14)
    errors.push(`found only ${scriptCount} test/check/typecheck script(s); expected 14+`);
  if (outside.length < 2)
    errors.push(`found only ${outside.length} root test file(s); expected 2+`);

  return {
    errors,
    summary:
      `${scriptCount} test/check/typecheck scripts are all run by ${WORKFLOW}, and ` +
      `${outside.length} test file(s) outside ${OWNED_TREES.map((tree) => tree.root).join(', ')} ` +
      'are all named by a root script.',
  };
}

if (import.meta.main) {
  const { errors, summary } = checkCiWiring(join(import.meta.dir, '..'));
  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(summary);
}
