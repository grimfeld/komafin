#!/bin/sh
# Changed-line coverage (CONSTRAINTS.md): reads the lcov files the test runs already wrote and
# intersects them with the diff against main. Usage: scripts/coverage-diff.sh [compare-branch]
set -e
BASE="${1:-$(git rev-parse --verify --quiet origin/main >/dev/null && echo origin/main || echo main)}"
FILES=""
[ -f coverage/lcov.info ] && FILES="$FILES coverage/lcov.info"
[ -f src-tauri/lcov.info ] && FILES="$FILES src-tauri/lcov.info"
[ -n "$FILES" ] || { echo "coverage-diff: no lcov files; run the tests with coverage first" >&2; exit 2; }
diff-cover $FILES --compare-branch="$BASE" --fail-under=80
