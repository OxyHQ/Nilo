/**
 * Every test and check this repository defines must be RUN by CI.
 *
 * `test:worker` sat in the root package.json, passing, while no workflow ever
 * ran it: a suite that is green and inert reports exactly what a suite that is
 * green and enforced reports. This fails when:
 *  - a workspace script named `test`, `test:*`, `check` or `check:*` (other
 *    than the interactive `:watch` and the `:coverage` variant) is not invoked
 *    by `.github/workflows/ci.yml` — `bun run <name>` at the root,
 *    `bun run --filter <package> <name>` in a workspace;
 *  - a tracked `*.test.*` file outside `apps/api/src` (which the API's vitest
 *    configs own) is not named by any root script, so no runner reaches it;
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
const API_VITEST_ROOT = 'apps/api/src/';
const GATED_SCRIPT = /^(test|check)(:.+)?$/u;
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
  const outside = testFiles.filter((path) => !path.startsWith(API_VITEST_ROOT));
  for (const path of outside) {
    if (!rootCommands.includes(path)) {
      errors.push(`${path} is a test file no root package.json script names, so CI never runs it.`);
    }
  }

  // Vacuity floors: today's counts. Raise them when adding; never lower them to pass.
  if (scriptCount < 6) errors.push(`found only ${scriptCount} test/check script(s); expected 6+`);
  if (outside.length < 2)
    errors.push(`found only ${outside.length} root test file(s); expected 2+`);

  return {
    errors,
    summary:
      `${scriptCount} test/check scripts are all run by ${WORKFLOW}, and ` +
      `${outside.length} test file(s) outside ${API_VITEST_ROOT} are all named by a root script.`,
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
