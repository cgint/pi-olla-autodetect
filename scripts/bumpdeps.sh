#!/usr/bin/env bash
# Reusable dep-bump helper: pins every devDep to its registry-latest exact version.
set -euo pipefail
cd "$(dirname "$0")/.."
npm install --save-dev \
  "@earendil-works/pi-coding-agent@1.5.0" \
  "@types/node@26.6.6" \
  "@vitest/runner@4.1.11" \
  "typescript@7.0.2" \
  "vitest@5.1.0"
grep -E '"name"|"version"' package.json | head -3
