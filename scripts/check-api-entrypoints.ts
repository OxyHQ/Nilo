/**
 * A failed start of either API entrypoint must END THE PROCESS NON-ZERO.
 *
 * Executes the BUILT artefacts the way the production image runs them —
 * `bun apps/api/dist/index.js` (the image's CMD) and
 * `bun apps/api/dist/db/migrate.js` (the deploy's one-shot task, whose exit
 * code `.github/scripts/deploy-ecs.sh` reads) from the repository root with
 * `NODE_ENV=production` — never `src/`, which is a different file from the
 * bundle the image ships.
 *
 * Why it exists: the process-level `uncaughtException` handler once deferred its
 * exit to an unref'd 5 s timer. Registering the handler stops the runtime
 * exiting on its own, and an unref'd timer does not keep the event loop alive, so a throw
 * at boot (with no socket or pool open yet) drained the loop and the process
 * exited 0 — a crashed boot every orchestrator read as success.
 *
 * Every failure scenario asserts BOTH the exit code and a log line proving the
 * process reached the failure being tested: a module that cannot even load also
 * exits non-zero, and would otherwise satisfy this check vacuously. The
 * positive controls boot the server against a real database and shut it down
 * cleanly, and dry-run the migrator to its last line, so "non-zero" cannot be
 * explained by "this artefact never runs".
 *
 * Usage: `bun run check:api-entrypoints` (builds first). Requires
 * `NILO_TEST_DATABASE_URL`, the same database `test:pgdb` uses.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SERVER = 'apps/api/dist/index.js';
const MIGRATOR = 'apps/api/dist/db/migrate.js';
// The image's runtime. Override only to compare runtimes, e.g. RUNTIME_BINARY=node.
const RUNTIME = process.env.RUNTIME_BINARY || 'bun';

interface Outcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  timedOut: boolean;
}

interface Run {
  /** Resolves with the outcome once the process has exited (or been killed on timeout). */
  done: Promise<Outcome>;
  output: () => string;
  kill: (signal: NodeJS.Signals) => void;
}

function start(argv: string[], env: Record<string, string>, timeoutMs: number): Run {
  // Inherit nothing that could decide the scenario: PATH and HOME only, then
  // what the scenario sets. A developer's DATABASE_URL or PORT must not leak in.
  const child = spawn(RUNTIME, argv, {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'production',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  const done = new Promise<Outcome>((resolve, reject) => {
    child.on('error', reject);
    // 'close', not 'exit': 'exit' can precede the last piped chunk.
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output, timedOut });
    });
  });
  return { done, output: () => output, kill: (signal) => child.kill(signal) };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

const failures: string[] = [];

function check(scenario: string, condition: boolean, message: string, outcome?: Outcome): void {
  if (condition) return;
  failures.push(`${scenario}: ${message}`);
  if (outcome) {
    console.error(`--- ${scenario}: output (last 40 lines) ---`);
    console.error(outcome.output.split('\n').slice(-40).join('\n'));
  }
}

/** A failure: non-zero, not by timeout, after reaching every `reached` line. */
async function expectFailure(
  scenario: string,
  argv: string[],
  env: Record<string, string>,
  reached: string[],
): Promise<void> {
  const outcome = await start(argv, env, 20_000).done;
  check(scenario, !outcome.timedOut, 'still running after 20 s instead of exiting', outcome);
  check(
    scenario,
    outcome.code !== 0,
    `exited with code ${outcome.code} (signal ${outcome.signal}); a failure must be non-zero`,
    outcome,
  );
  for (const line of reached) {
    check(scenario, outcome.output.includes(line), `never logged ${JSON.stringify(line)}`, outcome);
  }
  console.log(`${scenario}: exit ${outcome.code}${outcome.timedOut ? ' (timed out)' : ''}`);
}

async function waitForLive(port: number, run: Run, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`);
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    if (run.output().includes('shutting down')) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.NILO_TEST_DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      '::error::NILO_TEST_DATABASE_URL is required (the positive control boots for real).',
    );
    process.exit(1);
  }
  for (const entry of [SERVER, MIGRATOR]) {
    try {
      readFileSync(join(ROOT, entry));
    } catch {
      console.error(`::error::${entry} does not exist; run \`bun run build:api\` first.`);
      process.exit(1);
    }
  }

  // 1. A throw at module top level, after the process handlers are registered,
  //    with nothing yet holding the event loop open: exactly the case the
  //    unref'd timer turned into exit 0. `DATABASE_URL` is set EMPTY rather
  //    than unset, so Bun's own .env loading cannot fill it from a developer's
  //    .env in the working directory (the repo root, see `start`).
  //    Asserting the handler's own line keeps this scenario measuring the
  //    handler: if boot is restructured so this throw no longer reaches it,
  //    this fails and a scenario that does must replace it.
  await expectFailure('server: missing DATABASE_URL', [SERVER], { DATABASE_URL: '', PORT: '0' }, [
    'DATABASE_URL is required.',
    '[Process] Uncaught exception',
  ]);

  // 2. A listen error that is not EADDRINUSE. Only EADDRINUSE used to exit;
  //    EACCES left the process alive, listening on nothing, held open by the
  //    Postgres pool. Port 80 is privileged for a non-root user while
  //    ip_unprivileged_port_start is above it; refuse rather than skip when not.
  const unprivilegedStart = Number(
    readFileSync('/proc/sys/net/ipv4/ip_unprivileged_port_start', 'utf8').trim(),
  );
  if (process.getuid?.() === 0 || !(unprivilegedStart > 80)) {
    failures.push(
      `server: listen EACCES: cannot provoke EACCES here (uid ${process.getuid?.()}, ` +
        `ip_unprivileged_port_start ${unprivilegedStart}); run as a non-root user`,
    );
  } else {
    await expectFailure(
      'server: listen EACCES',
      [SERVER],
      { DATABASE_URL: databaseUrl, PORT: '80' },
      ['EACCES', '[Server] Could not listen'],
    );
  }

  // 3. Positive control: the same artefact boots, answers, and a SIGTERM
  //    shutdown still reports success.
  const port = await freePort();
  const run = start([SERVER], { DATABASE_URL: databaseUrl, PORT: String(port) }, 60_000);
  const live = await waitForLive(port, run, 20_000);
  check('server: boots and shuts down', live, `never answered /health/live on port ${port}`);
  run.kill('SIGTERM');
  const outcome = await run.done;
  check('server: boots and shuts down', !outcome.timedOut, 'did not exit after SIGTERM', outcome);
  check(
    'server: boots and shuts down',
    outcome.code === 0,
    `a graceful shutdown exited with code ${outcome.code} (signal ${outcome.signal})`,
    outcome,
  );
  check(
    'server: boots and shuts down',
    outcome.output.includes('Graceful shutdown complete'),
    'never logged "Graceful shutdown complete"',
    outcome,
  );
  console.log(`server: boots and shuts down: live=${live}, exit ${outcome.code}`);

  // 4. The migrator refuses a run with no --phase, and says why.
  const targetDatabase = new URL(databaseUrl).pathname.slice(1);
  await expectFailure(
    'migrator: missing --phase',
    [MIGRATOR, `--target-database=${targetDatabase}`],
    { DATABASE_URL: databaseUrl },
    ['--phase is required', 'Migration run failed'],
  );

  // 5. Positive control: a dry run reaches its report and exits 0, writing nothing.
  //    `--phase=all`, not `pre`: on a fresh database (CI's), a release's pre-deploy
  //    migration sits behind the previous release's post-deploy one, and `pre`
  //    rightly refuses to skip it. Production never meets that order, because the
  //    previous deploy ran its post phase; this control is about exiting 0.
  const dryRun = await start(
    [MIGRATOR, `--target-database=${targetDatabase}`, '--phase=all', '--dry-run'],
    { DATABASE_URL: databaseUrl },
    60_000,
  ).done;
  check('migrator: dry run', dryRun.code === 0, `exited with code ${dryRun.code}`, dryRun);
  check(
    'migrator: dry run',
    dryRun.output.includes('DRY RUN'),
    'never reached its "DRY RUN" report',
    dryRun,
  );
  console.log(`migrator: dry run: exit ${dryRun.code}`);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`::error::${failure}`);
    process.exit(1);
  }
  console.log(
    'Both built API entrypoints exit non-zero on every failure tested, and 0 when they succeed.',
  );
}

await main();
