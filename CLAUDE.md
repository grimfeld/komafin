# Project: jellyfin-comics-reader

A cross-platform desktop/mobile app for reading comics from a Jellyfin server.

## Tech Stack

- Tauri (Rust shell) + React + TypeScript
- UI: shadcn/ui + Tailwind CSS

## Commands

Package manager: **pnpm**.

- Dev (desktop app): `pnpm tauri dev` (Vite alone: `pnpm dev`, port 1420)
- Build: `pnpm tauri build` (frontend only: `pnpm build`)
- Type-check: `pnpm typecheck`
- Test: `pnpm test` (Vitest)
- Format: `pnpm exec prettier --write .`
- Floor guard: `node scripts/floor-guard.mjs`

The pre-commit hook (Husky) runs lint-staged (Prettier), then the type-check, the tests and the floor guard. Never bypass it with `--no-verify`. No ESLint or Rust checks yet; see `CONSTRAINTS.md` → Setup status.

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
