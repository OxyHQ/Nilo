# Build and CI rules

Rules moved out of `AGENTS.md`.

- Every `test*`, `check*` and `typecheck` script must be run by `ci.yml`;
  `bun run check:ci-wiring` enforces it.
- A boot or migration failure must exit non-zero: never defer a fatal exit to
  an unref'd timer. `bun run check:api-entrypoints` executes the built
  artefacts under bun, the image's runtime, to hold that.
- `packageManager` in `package.json` is the one bun pin; the image and
  workflows obey it (`bun run check:bun-pin`).
- Commit manifest and `bun.lock` changes together.
- The web export requires an explicit HTTPS `EXPO_PUBLIC_API_URL`; there is no
  implicit production API hostname. Local development may use an explicit HTTP
  origin.
- Formatting-only commits go in `.git-blame-ignore-revs`.
- Biome only (root `biome.json`): no ESLint or Prettier. `bun run lint` checks
  the whole repo as CI's `biome ci .` does. See
  [lint and format](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/lint-and-format.md).
- Deployment state and migration commands: [deployment](../deployment.md).
