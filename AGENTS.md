# pi-olla-autodetect

Pi extension that auto-discovers LLM models from an Olla gateway endpoint and registers them as a provider.

## Maintenance
- Dependency upgrades and audit hygiene: follow `.pi/skills/repo-maintenance/SKILL.md`.
- Test command: `npm test` (vitest run, 7 tests in src/extension.test.ts).
- Typecheck: `npm run typecheck` (tsc --noEmit).
- Precommit: `npm run precommit` (typecheck + test in one shot).
- Never touch the `pi` manifest in package.json or the root `skills/` directory — those belong to extension users.
