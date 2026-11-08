# Project: jellyfin-comics-reader

A cross-platform desktop/mobile app for reading comics from a Jellyfin server.

## Tech Stack

- Tauri 2 (Rust shell) + React 19 + TypeScript (strict) + Vite, pnpm
- UI: shadcn/ui + Tailwind CSS. **Planned, not installed yet.** Until it is, there are no `@/components/ui/*` modules and no Tailwind classes; don't import or use them.

## Layout

- `src/`: React frontend. `main.tsx` is the entry point. `App.tsx`/`App.css` are create-tauri-app demo code, so don't copy their patterns.
- `src/lib/jellyfin/`: the single Jellyfin API client (**planned**, doesn't exist yet). All network access goes here.
- `src-tauri/src/lib.rs`: Tauri builder and `#[tauri::command]`s. `greet` is demo code. `main.rs` only calls `run()`.
- `src-tauri/capabilities/default.json`: webview permissions (currently `core:default`, `opener:default`).
- `src-tauri/tauri.conf.json`: app config (id `com.grimfeld.jellyfin-comics-reader`, dev URL `http://localhost:1420`).
- `scripts/floor-guard.mjs`: diff-scoped quality floor, see `CONSTRAINTS.md`.
- `docs/agents/`: config for the agent skills (issue tracker, labels, domain docs).

There's no real feature code yet, so there's no in-repo pattern to follow. Ask rather than invent one, and once the first real component or command lands, add it here as the reference example.

## Commands

Package manager: **pnpm**.

- Dev (desktop app): `pnpm tauri dev` (Vite alone: `pnpm dev`, port 1420)
- Build: `pnpm tauri build` (frontend only: `pnpm build`)
- Type-check: `pnpm typecheck`
- Test: `pnpm test` (Vitest)
- Format: `pnpm exec prettier --write .`
- Lint: `pnpm lint`
- Floor guard: `node scripts/floor-guard.mjs`
- Quality checks (see `CONSTRAINTS.md`): `pnpm check:fast` after edits (~2 s), `pnpm check:task` before declaring a task done (~25 s warm), `pnpm check:full` in CI

The pre-commit hook (Husky) runs lint-staged (Prettier), then the type-check, the tests and the floor guard. Never bypass it with `--no-verify`. Rust checks run in `check:task`, not in the hook.

CI (`.github/workflows/ci.yml`) runs `pnpm check:full` on every PR and push to main. When it fails, read the failing step with `gh run view --log-failed`, reproduce it locally with the same `pnpm check:*` script, fix the code, and push. Never disable a check or edit `CONSTRAINTS.md` to get green. The Rust toolchain is pinned in `rust-toolchain.toml`.

**Known issue on this machine (2026-11-08):** `xcrun` selects the macOS 27.0 SDK, which the installed Command Line Tools 26.6 linker can't read (`tapi error: malformed file … unknown architecture`). Rust builds fail until the CLT are updated. Workaround: `export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`.

## Code Conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- Functional React components with hooks.
- Build UI from shadcn/ui primitives before writing custom components; style with Tailwind utilities.
- Keep Jellyfin API access behind one client module, not scattered `fetch` calls in components.
- Use Tauri commands (Rust) only for what the webview can't do well (filesystem, archive extraction, native APIs); keep the rest in TypeScript.

## Constraints

Read `CONSTRAINTS.md` before writing code. Do not weaken it to make a change pass.

## Boundaries

- Never commit secrets, Jellyfin server URLs with credentials, or access tokens.
- Ask before adding a dependency (npm or Cargo).
- Ask before widening Tauri capabilities/permissions (`src-tauri/capabilities/`).
- Run type-check and tests before declaring a task done.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
