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

| Dimension      | Rule                                      | Checked by                                                                                                                     | Runs at                      | Why                                                                                                                                     |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Types (TS)     | Zero type errors                          | `tsc --noEmit`                                                                                                                 | every edit                   | Strict mode is the cheapest bug filter we have                                                                                          |
| Types (Rust)   | Zero errors                               | `cargo check --manifest-path src-tauri/Cargo.toml`                                                                             | task end                     | Too slow for every edit; runs before handing back                                                                                       |
| Lint (TS)      | Zero errors                               | `eslint <changed files>`                                                                                                       | every edit                   | Includes the `no-restricted-globals: fetch` rule: network calls only from `src/lib/jellyfin/`                                           |
| Lint (Rust)    | Zero warnings                             | `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`                                                             | task end                     | Warnings that never block pile up and get ignored                                                                                       |
| Format         | No diff                                   | `prettier --check .` and `cargo fmt --manifest-path src-tauri/Cargo.toml --check`                                              | task end                     | Keeps diffs to real changes                                                                                                             |
| Secrets        | No findings                               | `gitleaks detect --redact --no-banner`                                                                                         | every edit, CI               | Jellyfin tokens are bearer credentials. `--redact` keeps the value out of agent transcripts                                             |
| Floor          | No violations                             | `node scripts/floor-guard.mjs`                                                                                                 | every edit, CI               | See Floor above                                                                                                                         |
| Coverage       | Changed lines ≥ 80% covered (TS and Rust) | `vitest run --coverage` + `cargo llvm-cov --lcov`, then `diff-cover <lcov files> --compare-branch=origin/main --fail-under=80` | task end, CI                 | High enough to force a test, low enough to allow a config line                                                                          |
| Security: deps | Nothing at high or above                  | `osv-scanner scan source -r .` (reads `pnpm-lock.yaml` and `Cargo.lock`)                                                       | CI                           | Below high is mostly noise. External check: a vulnerability database, not our own opinion                                               |
| Security: code | No high findings                          | `semgrep scan --config p/default --config p/typescript --config p/rust <changed files>`                                        | task end, CI                 | The app parses untrusted archives (CBZ/CBR) and holds credentials                                                                       |
| Accessibility  | Zero critical or serious violations       | `axe http://localhost:1420 --tags wcag2a,wcag2aa,wcag21aa --exit` against the Vite dev server                                  | task end when UI changed, CI | Moderate and minor are often debatable. External check: WCAG                                                                            |
| Architecture   | Zero violations                           | `depcruise --validate .dependency-cruiser.cjs src`                                                                             | task end, CI                 | Rules: no circular imports; HTTP clients (`@tauri-apps/plugin-http`, `ky`, `axios`) only imported inside `src/lib/jellyfin/`            |
| Bundle         | Main JS entry ≤ 500 kB gzipped            | `size-limit`                                                                                                                   | task end, CI                 | Loaded from disk, so parse time matters more than download. A React + shadcn baseline is about 150 kB, which leaves room for the reader |

Every row names the command that produces the verdict. A rule with no command is an aspiration, not a constraint.

**Time budgets:** every-edit checks stay under 5 s and only look at changed files. The task-end set (`check:task`) must finish within 3 minutes. CI has no limit. A check that blows its budget moves to a later stage; it doesn't get turned off.

**Caveat on accessibility:** axe runs in Chromium, while the shipped app renders in each platform's webview (WebKit on macOS/iOS, WebView2 on Windows). It catches markup and ARIA problems, not rendering differences between webviews.

## Measured, not yet enforced

| Metric                      | Today            | Direction                                                          |
| --------------------------- | ---------------- | ------------------------------------------------------------------ |
| Project coverage (TS)       | n/a, no code yet | record on first run, then must not fall (tolerance 0.5%)           |
| Project coverage (Rust)     | n/a, no code yet | record on first run, then must not fall (tolerance 0.5%)           |
| Bundle size (main, gzipped) | n/a, no code yet | record on first build, then must not grow without a note in the PR |

## Exceptions

| ID  | Rule | Path | Reason | Owner | Expires |
| --- | ---- | ---- | ------ | ----- | ------- |

Exceptions default to a 90-day lifetime; none may run more than a year.

## Setup status

The project isn't scaffolded yet, so only the floor guard exists. When the Tauri app is created:

- [ ] `git init` and an initial commit (the floor guard needs a merge base)
- [ ] Dev deps: `vitest @vitest/coverage-v8 eslint prettier dependency-cruiser size-limit @size-limit/preset-app @axe-core/cli`
- [ ] Rust: `cargo install cargo-llvm-cov`, `rustup component add clippy rustfmt llvm-tools-preview`
- [ ] Machine-wide or CI only: `gitleaks`, `osv-scanner`, `semgrep`, `diff-cover`
- [ ] Write `.dependency-cruiser.cjs` and the ESLint `fetch` restriction for the rules above
- [ ] Add `check:fast`, `check:task` and `check:full` scripts to `package.json`, mirroring this file (this file wins if they drift)
- [ ] Wire `check:fast` into a Claude Code post-edit hook and `check:full` into CI
- [ ] Record first-run values in "Measured, not yet enforced"
