# Komafin

A cross-platform reader for comics and manga hosted on [Jellyfin](https://jellyfin.org), built with Tauri, React and TypeScript.

_Koma_ (コマ) is the Japanese word for a manga panel.

> Early development. Not affiliated with the Jellyfin project.

## Development

Requires Node 22, pnpm, and Rust (version pinned in `rust-toolchain.toml`) plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
pnpm install
pnpm tauri dev
```

Quality checks are defined in [`CONSTRAINTS.md`](CONSTRAINTS.md): `pnpm check:fast`, `pnpm check:task` and `pnpm check:full`.
