/**
 * One bun for everything: the root `packageManager` pin.
 *
 * CI's setup-bun reads that pin (`bun-version-file: package.json`), but a
 * Dockerfile's `FROM oven/bun:<tag>` is a literal. A bump that misses it builds
 * the API image with a different bun from the one that wrote bun.lock and that
 * CI tested with. The image's `--frozen-lockfile` install then either fails in
 * the deploy, or passes on a bun nobody tested.
 *
 * This fails when:
 *  - `packageManager` is not `bun@<x.y.z>`;
 *  - any Dockerfile `FROM oven/bun…` stage, `COPY --from=oven/bun…` or
 *    `ARG BUN_VERSION=` names another version, or names none (an untagged
 *    image is `latest`);
 *  - no Dockerfile references oven/bun at all, so the check would measure
 *    nothing;
 *  - a workflow's setup-bun step does not read `bun-version-file: package.json`
 *    or states a literal `bun-version` that differs from the pin, or any
 *    workflow `BUN_VERSION` literal differs.
 *
 * Usage: `bun run check:bun-pin`. The test is `scripts/check-bun-pin.test.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.worktrees', 'dist', '.expo']);

function findDockerfiles(root: string, directory = root): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...findDockerfiles(root, join(directory, entry.name)));
      }
    } else if (/^Dockerfile(\..+)?$/u.test(entry.name)) {
      found.push(relative(root, join(directory, entry.name)));
    }
  }
  return found.sort();
}

function findWorkflows(root: string): string[] {
  const directory = join(root, '.github', 'workflows');
  try {
    return readdirSync(directory)
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort()
      .map((name) => join('.github', 'workflows', name));
  } catch {
    return [];
  }
}

/** `1.4.3-slim@sha256:…` → `1.4.3`; no tag → `latest`. */
function bunVersionOfTag(tag: string | undefined): string {
  return (tag ?? 'latest').split('@')[0].split('-')[0];
}

const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/u, '$2');

export function checkBunPin(root: string): { errors: string[]; summary: string } {
  const errors: string[] = [];
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    packageManager?: unknown;
  };
  const pinned = /^bun@(\d+\.\d+\.\d+)$/u.exec(String(manifest.packageManager ?? ''))?.[1];
  if (!pinned) {
    return {
      errors: [
        'root package.json must pin `packageManager` as bun@<x.y.z>; without it nothing else can be checked.',
      ],
      summary: '',
    };
  }

  let imageReferences = 0;
  for (const file of findDockerfiles(root)) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (line.startsWith('#')) return;
      const where = `${file}:${index + 1}`;
      const image =
        /^FROM\s+(?:--\S+\s+)*oven\/bun(?::(\S+))?(?:\s|$)/iu.exec(line) ??
        /^COPY\s+(?:--\S+\s+)*--from=oven\/bun(?::(\S+))?(?:\s|$)/iu.exec(line);
      if (image) {
        imageReferences += 1;
        const tag = image[1];
        if (tag?.includes('$')) {
          errors.push(
            `${where} builds on oven/bun:${tag}; spell the version literally so it can be checked against bun@${pinned}.`,
          );
        } else if (bunVersionOfTag(tag) !== pinned) {
          errors.push(
            `${where} uses oven/bun:${tag ?? '(untagged = latest)'}, but package.json pins bun@${pinned}. ` +
              'The image must run the bun that wrote bun.lock and that CI tests with.',
          );
        }
      }
      const argument = /^ARG\s+BUN_VERSION=(\S+)/iu.exec(line);
      if (argument && unquote(argument[1]) !== pinned) {
        errors.push(
          `${where} defaults BUN_VERSION to ${argument[1]}, but package.json pins bun@${pinned}.`,
        );
      }
    });
  }
  if (imageReferences === 0) {
    errors.push(
      'found no `FROM oven/bun` or `COPY --from=oven/bun` in any Dockerfile; the image pin check would measure nothing.',
    );
  }

  let setupSteps = 0;
  for (const file of findWorkflows(root)) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      const environment = /^\s*BUN_VERSION:\s*(\S+)/u.exec(line);
      if (environment && unquote(environment[1]) !== pinned) {
        errors.push(
          `${where} sets BUN_VERSION to ${environment[1]}, but package.json pins bun@${pinned}.`,
        );
      }

      const step = /^(\s*)(-\s+)?uses:\s*oven-sh\/setup-bun@/u.exec(line);
      if (!step) return;
      setupSteps += 1;
      // The step is every following line indented deeper than its list dash:
      // the dash is on this line (`- uses:`) or two columns left of it.
      const stepIndent = step[2] ? step[1].length : step[1].length - 2;
      let versionFile: string | undefined;
      let version: string | undefined;
      for (let next = index + 1; next < lines.length; next += 1) {
        const body = lines[next];
        if (body.trim() === '' || body.trim().startsWith('#')) continue;
        if (body.length - body.trimStart().length <= stepIndent) break;
        versionFile ??= /^\s*bun-version-file:\s*(.+)$/u.exec(body)?.[1];
        version ??= /^\s*bun-version:\s*(.+)$/u.exec(body)?.[1];
      }
      if (version !== undefined) {
        if (unquote(version) !== pinned) {
          errors.push(
            `${where} installs bun ${unquote(version)}, but package.json pins bun@${pinned}; use \`bun-version-file: package.json\`.`,
          );
        }
      } else if (versionFile === undefined || unquote(versionFile) !== 'package.json') {
        errors.push(
          `${where} sets up bun without \`bun-version-file: package.json\`, so it would not install the pinned bun@${pinned}.`,
        );
      }
    });
  }

  return {
    errors,
    summary:
      `bun@${pinned} is the one pin: ${imageReferences} oven/bun image reference(s) and ` +
      `${setupSteps} setup-bun step(s) agree with it.`,
  };
}

if (import.meta.main) {
  const { errors, summary } = checkBunPin(join(import.meta.dir, '..'));
  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(summary);
}
