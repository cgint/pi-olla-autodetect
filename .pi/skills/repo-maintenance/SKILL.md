---
name: repo-maintenance
description: Self-sufficient routine for dependency upgrades, audit hygiene and verified push in this repository. For agents working on this repo; never deployed to extension users.
---

# Repository maintenance routine (self-sufficient)

This skill is the single source of truth for maintaining this repository.
It must remain fully self-sufficient: never depend on resources outside
this repository (no central skill, no external memory).

## Goal & hard rules
- All npm dependencies at latest published versions, MAJOR bumps included.
- npm audit green (exit 0), fixed at ROOT CAUSE (upgrade the vulnerable
  package itself). Never via: lowered audit level, --force, npm audit
  ignore/suppressions, overrides that mask advisories, or downgrade-to-dodge.
- NO restrictions may be loosened to get green. If a temporary measure is
  truly unavoidable, flag it explicitly in the evidence file and name the
  real fix.
- Never bend a test to pass. Failures are either pre-existing (prove it via
  a stash/HEAD baseline) or regressions (fix root cause or stop and report).

## Procedure
1. git fetch origin; ensure local branch is even with origin before starting.
2. Record BEFORE-state: package versions (npm ls --depth=0), npm audit
   output, full test verdict on the clean tree.
3. Bump deps to latest (majors included). Regenerate lockfile fresh
   (remove package-lock.json, npm install).
4. Typecheck/build + full test suite. Compare against BEFORE-state; any
   new failure is a regression. Investigate root cause before touching code.
5. npm audit must exit 0.
6. Commit (conventional message) and push ONLY when: tests no worse than
   baseline, audit exit 0, tree clean.

## Evidence contract
Commit agent/dep-refresh-YYYYMMDD.md containing: before/after table per
changed package, audit before/after, test verdict incl. pre-existing
failures with proof they pre-date the change, residual risks/overrides
kept and why.

## Acceptance protocol (verifier duties - NEVER trust a worker self-report)
- git fetch, then HEAD == origin on the working branch
- zero dirty tracked files
- re-run npm audit (expect exit 0)
- inspect the diff for loosened restrictions (audit config, skipped
  tests, downgraded pins)
- spot-check the evidence file exists and matches reality

## Repo-specific facts
- **Typecheck**: `npm run typecheck` (tsc --noEmit, strict mode, noEmit).
- **Tests**: `npm test` (vitest run, single file src/extension.test.ts, 7 tests). No vitest.config; vitest auto-discovers *.test.ts.
- **Precommit**: `npm run precommit` runs typecheck + test in one shot.
- **Node**: no engines field in package.json; node v22.22.1 / npm 9.2.0 verified working. No native modules.
- **Dependencies**: only devDependencies (5 packages) + peerDependencies (2, not installed). No runtime deps, no optionalDependencies, no overrides.
- **DevDeps** (verified from package.json): @earendil-works/pi-coding-agent ^1.5.0, @types/node ^26.6.6, @vitest/runner ^4.1.11, typescript ^7.0.2, vitest ^5.1.0.
- **Peers**: @earendil-works/pi-coding-agent ^1.0.0 (range must stay compatible with devDep), @sinclair/typebox * (transitive via pi-coding-agent, not directly imported).
- **bumpdeps.sh**: scripts/bumpdeps.sh pins all 5 devDeps to exact latest. Run it as the canonical bump step. It does NOT regenerate the lockfile fresh — do that separately.
- **No overrides, no audit suppressions, no engines pin in package.json.** Lockfile contains transitive engines fields only; they are not ours to manage.
- **Known constraint**: bumping pi-coding-agent MAJOR may shift its public API surface (types, export names). The extension imports `registerOllaProvider`, `buildRegisteredModels`, `discoverModels` from src/extension.js — if a major bump changes those, the typecheck step will fail; fix the import, do not suppress.
- **Baseline (2026-07-21)**: typecheck clean, 7/7 tests pass, npm audit exit 0.
