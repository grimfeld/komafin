# Constraints

Last reviewed: 2026-11-08 by @grimfeld

This file is the project's quality bar. Every check **blocks**: a red check means fix the code, or add an Exceptions row with an owner and an expiry. Never edit a threshold down to make a change pass. Tightening the bar needs no discussion; loosening it does.

## Floor (always enforced, no setup required)

- No new suppression comments: `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `istanbul`/`c8`/`v8 ignore`, `#[allow(...)]`, `#[expect(...)]`, `nosemgrep`, `gitleaks:allow`
- No unimplemented stubs: `throw new Error("Not implemented")`, empty `catch {}`, `todo!()`, `unimplemented!()`, `TODO` standing in for an implementation
- No skipped or deleted tests without a reason in the commit message: `.skip`, `.todo`, `#[ignore]`
- No secrets in source: Jellyfin access tokens, API keys, server URLs with embedded credentials
- This file does not get weakened to make a change pass

Checked by: `node scripts/floor-guard.mjs` (scoped to the diff; exit 0 clean, 1 violation, 2 could not run, and a 2 never counts as clean).

## Enforced with numbers

| Dimension      | Rule                                      | Checked by                                                                                                                                                                            | Runs at                    | Why                                                                                                                                                                  |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types (TS)     | Zero type errors                          | `tsc --noEmit`                                                                                                                                                                        | every edit                 | Strict mode is the cheapest bug filter we have                                                                                                                       |
| Types (Rust)   | Zero errors                               | covered by `cargo clippy` (Lint (Rust) row), which type-checks as it lints                                                                                                            | task end                   | Too slow for every edit; runs before handing back                                                                                                                    |
| Lint (TS)      | Zero errors                               | `eslint .` (`eslint.config.js`)                                                                                                                                                       | every edit                 | Includes `no-restricted-globals` for `fetch`/`XMLHttpRequest`: network calls only from `src/lib/jellyfin/`                                                           |
| Lint (Rust)    | Zero warnings                             | `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`                                                                                                                    | task end                   | Warnings that never block pile up and get ignored                                                                                                                    |
| Format         | No diff                                   | `prettier --check .` and `cargo fmt --manifest-path src-tauri/Cargo.toml --check`                                                                                                     | task end                   | Keeps diffs to real changes                                                                                                                                          |
| Secrets        | No findings                               | `gitleaks git --pre-commit --redact --no-banner` (uncommitted changes); `gitleaks git --redact --no-banner` (full history)                                                            | every edit; history in CI  | Jellyfin tokens are bearer credentials. `--redact` keeps the value out of agent transcripts                                                                          |
| Floor          | No violations                             | `node scripts/floor-guard.mjs`                                                                                                                                                        | every edit, pre-commit, CI | See Floor above                                                                                                                                                      |
| Coverage       | Changed lines ≥ 80% covered (TS and Rust) | `pnpm check:coverage`: `vitest run --coverage` + `cargo llvm-cov --lcov`, then `scripts/coverage-diff.sh`, which runs `diff-cover <lcov files> --compare-branch=main --fail-under=80` | task end, CI               | High enough to force a test, low enough to allow a config line                                                                                                       |
| Security: deps | Nothing at CVSS ≥ 7.0 (high or critical)  | `node scripts/osv-gate.mjs` (osv-scanner over `pnpm-lock.yaml` and `src-tauri/Cargo.lock`; lists lower and unscored findings without blocking)                                        | CI                         | Below high is mostly noise. External check: a vulnerability database, not our own opinion                                                                            |
| Security: code | No ERROR-severity findings                | `semgrep scan --error --severity ERROR --config p/default --config p/typescript --config p/rust src src-tauri/src`                                                                    | task end, CI               | The app parses untrusted archives (CBZ/CBR) and holds credentials. Scans whole source dirs while they're small; scope it to changed files once it exceeds the budget |
| Accessibility  | Zero critical or serious violations       | `node scripts/a11y.mjs`: axe-core in Playwright Chromium against the Vite dev server at `http://localhost:1420` (started if needed), tags `wcag2a,wcag2aa,wcag21aa`                   | task end, CI               | Moderate and minor are often debatable. External check: WCAG                                                                                                         |
| Architecture   | Zero violations                           | `depcruise --validate .dependency-cruiser.cjs src`                                                                                                                                    | task end, CI               | Rules: no circular imports; HTTP clients (`@tauri-apps/plugin-http`, `ky`, `axios`) only imported inside `src/lib/jellyfin/`                                         |
| Bundle         | Main JS entry ≤ 500 kB gzipped            | `vite build && size-limit` (`.size-limit.json`)                                                                                                                                       | task end, CI               | Loaded from disk, so parse time matters more than download. A React + shadcn baseline is about 150 kB, which leaves room for the reader                              |

Every row names the command that produces the verdict. A rule with no command is an aspiration, not a constraint.

**Time budgets:** every-edit checks stay under 5 s (`check:fast` measures about 2 s). The task-end set (`check:task`) must finish within 3 minutes (about 25 s with warm caches). CI has no limit. A check that blows its budget moves to a later stage; it doesn't get turned off. Exception: the first Rust build after a clean or a dependency change takes about 2 minutes each for clippy and llvm-cov, because they use separate target dirs. That one-off cold run doesn't count against the budget.

**Scripts** (`package.json`) mirror this file, and this file wins if they drift:

- `pnpm check:fast`: TS types, ESLint, floor guard, secrets in uncommitted changes. Run after edits.
- `pnpm check:task`: `check:fast` plus formatting, Rust lint, coverage, architecture, bundle, Semgrep and accessibility. Run before declaring a task done.
- `pnpm check:full`: `check:task` plus dependency vulnerabilities and a secrets scan of the full git history. For CI.

**Caveat on accessibility:** axe runs in Chromium, while the shipped app renders in each platform's webview (WebKit on macOS/iOS, WebView2 on Windows). It catches markup and ARIA problems, not rendering differences between webviews.

## Measured, not yet enforced

| Metric                         | Today (2026-11-08)                                                                                                                                     | Direction                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Project coverage (TS)          | 0% of 8 lines (only the create-tauri-app demo, no tests yet)                                                                                           | must not fall (tolerance 0.5%)         |
| Project coverage (Rust)        | 0% of 14 lines (only the demo `greet` command, no tests yet)                                                                                           | must not fall (tolerance 0.5%)         |
| Bundle size (main, gzipped)    | 68.4 kB                                                                                                                                                | must not grow without a note in the PR |
| Dependency findings below high | 2 medium (`glib` 0.18 via Tauri's Linux GTK stack, `minimatch` via dev tooling), 4 unscored "unmaintained" crate advisories (all transitive via Tauri) | must not grow without a note in the PR |

## Exceptions

| ID  | Rule | Path | Reason | Owner | Expires |
| --- | ---- | ---- | ------ | ----- | ------- |

Exceptions default to a 90-day lifetime; none may run more than a year.

## Setup status

- [x] `git init` and an initial commit
- [x] Dev deps, Rust components, scanners (gitleaks, osv-scanner, semgrep, diff-cover) installed
- [x] ESLint `fetch` restriction, `.dependency-cruiser.cjs`, `.size-limit.json`, `vitest.config.ts`
- [x] `check:fast`, `check:task` and `check:full` scripts; all pass on the current tree (2026-11-08)
- [x] Pre-commit hook: lint-staged/Prettier, typecheck, test, floor guard
- [x] First-run values recorded in "Measured, not yet enforced"
- [ ] Wire `check:fast` into a Claude Code post-edit hook (`.claude/settings.json`)
- [ ] CI workflow running `pnpm check:full` (needs the GitHub repo; Linux runners also need Tauri's system packages for the Rust checks)
