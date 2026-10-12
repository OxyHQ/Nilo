import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkBunPin } from './check-bun-pin';

const DOCKERFILE = [
  'FROM oven/bun:1.4.3-slim AS builder',
  'RUN bun install --frozen-lockfile',
  'FROM oven/bun:1.4.3-slim AS production-deps',
  'FROM node:22-bookworm-slim AS runtime',
].join('\n');

const WORKFLOW = [
  'jobs:',
  '  test:',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: oven-sh/setup-bun@v2',
  '        with:',
  '          bun-version-file: package.json',
  '      - run: bun install --frozen-lockfile',
].join('\n');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'check-bun-pin-'));
  roots.push(root);
  const tree: Record<string, string> = {
    'package.json': JSON.stringify({ packageManager: 'bun@1.4.3' }),
    'apps/api/Dockerfile': DOCKERFILE,
    '.github/workflows/ci.yml': WORKFLOW,
    ...files,
  };
  for (const [path, content] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const errorsFor = (files: Record<string, string> = {}) => checkBunPin(repository(files)).errors;

test('the repository itself agrees with its pin', () => {
  expect(checkBunPin(join(import.meta.dir, '..')).errors).toEqual([]);
});

test('a consistent repository passes', () => {
  expect(errorsFor()).toEqual([]);
});

test('packageManager must be an exact bun pin', () => {
  for (const packageManager of [undefined, 'bun@1.4', 'bun@^1.4.3', 'npm@10.0.0']) {
    expect(errorsFor({ 'package.json': JSON.stringify({ packageManager }) })).toHaveLength(1);
  }
});

test('packageManager moving without the image fails', () => {
  const errors = errorsFor({ 'package.json': JSON.stringify({ packageManager: 'bun@1.4.4' }) });
  // Both image stages, and nothing about the workflow, which reads the pin.
  expect(errors).toHaveLength(2);
  expect(errors.every((error) => error.includes('oven/bun:1.4.3-slim'))).toBe(true);
});

test('an image stage on another bun fails, flags or no flags', () => {
  for (const line of [
    'FROM oven/bun:1.4.2-slim AS builder',
    'FROM --platform=linux/arm64 oven/bun:1.5.0 AS builder',
    'FROM oven/bun:1.4.2@sha256:0000 AS builder',
    'COPY --from=oven/bun:1.4.2-alpine /usr/local/bin/bun /usr/local/bin/bun',
  ]) {
    expect(errorsFor({ 'apps/api/Dockerfile': `${DOCKERFILE}\n${line}` })).toHaveLength(1);
  }
});

test('an untagged or variable-tagged image fails', () => {
  for (const line of ['FROM oven/bun AS builder', 'FROM oven/bun:$BUN_VERSION-slim']) {
    expect(errorsFor({ 'apps/api/Dockerfile': `${DOCKERFILE}\n${line}` })).toHaveLength(1);
  }
});

test('a pinned digest and a matching ARG pass', () => {
  const extra = 'ARG BUN_VERSION=1.4.3\nFROM oven/bun:1.4.3-slim@sha256:0000 AS extra';
  expect(errorsFor({ 'apps/api/Dockerfile': `${DOCKERFILE}\n${extra}` })).toEqual([]);
});

test('an ARG BUN_VERSION default on another bun fails', () => {
  expect(errorsFor({ 'apps/api/Dockerfile': `ARG BUN_VERSION=1.4.2\n${DOCKERFILE}` })).toHaveLength(
    1,
  );
});

test('a commented-out stage does not count, and no oven/bun at all fails', () => {
  const errors = errorsFor({
    'apps/api/Dockerfile': '# FROM oven/bun:1.4.3-slim AS builder\nFROM node:22 AS runtime',
  });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('measure nothing');
});

test('a setup-bun step on a literal other bun, or with no version, fails', () => {
  const literal = WORKFLOW.replace('bun-version-file: package.json', 'bun-version: "1.4.2"');
  expect(errorsFor({ '.github/workflows/ci.yml': literal })).toHaveLength(1);

  const unpinned = WORKFLOW.replace(/\n {8}with:\n {10}bun-version-file: package.json/u, '');
  expect(errorsFor({ '.github/workflows/ci.yml': unpinned })).toHaveLength(1);

  const otherFile = WORKFLOW.replace('package.json', '.bun-version');
  expect(errorsFor({ '.github/workflows/deploy.yml': otherFile })).toHaveLength(1);
});

test('a version on the NEXT step does not satisfy a setup-bun step without one', () => {
  const workflow = [
    'jobs:',
    '  test:',
    '    steps:',
    '      - name: Set up bun',
    '        uses: oven-sh/setup-bun@v2',
    '      - uses: some/action@v1',
    '        with:',
    '          bun-version-file: package.json',
  ].join('\n');
  expect(errorsFor({ '.github/workflows/ci.yml': workflow })).toHaveLength(1);
});

test('a literal that equals the pin, and a BUN_VERSION env, are held to it', () => {
  const literal = WORKFLOW.replace('bun-version-file: package.json', "bun-version: '1.4.3'");
  expect(errorsFor({ '.github/workflows/ci.yml': literal })).toEqual([]);

  const env = `env:\n  BUN_VERSION: "1.4.2"\n${WORKFLOW}`;
  expect(errorsFor({ '.github/workflows/ci.yml': env })).toHaveLength(1);
});
