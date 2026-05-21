# AGENTS.md

## Cursor Cloud specific instructions

This is an Obsidian community plugin (TypeScript/esbuild). It has no backend services or Docker dependencies — all tests run locally via Vitest with mocked Obsidian APIs.

### Key commands

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Run tests | `pnpm test` |
| Run tests (watch) | `pnpm test:watch` |
| Build (typecheck + bundle) | `pnpm build` |
| Dev (esbuild watch) | `pnpm dev` |
| Format | `pnpm format` |

### Notes

- `pnpm install` requires `pnpm.onlyBuiltDependencies` in `package.json` to allow esbuild's postinstall script to run non-interactively. Without this, pnpm 10+ blocks the build scripts and esbuild won't have its binary available.
- The dev command (`pnpm dev`) starts esbuild in watch mode and outputs `main.js` to the working directory (or `OUTPUT_PATH` if set via `.env`).
- Tests use Vitest with a mocked Obsidian API (`tests/__mocks__/obsidian.ts`). No external services or API keys are needed to run the test suite.
- Git hooks (husky): `pre-commit` runs `lint-staged` (prettier on `.ts` files); `commit-msg` runs commitlint (conventional commits format).
- The CJS build deprecation warning from Vite during `pnpm test` is cosmetic and does not affect test results.
