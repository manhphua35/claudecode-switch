# claudecode-switch

A lightweight desktop app for managing and switching between AI providers used by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Built with **Tauri v2 + Rust** — small binary, native performance, no Node runtime required.

Configure multiple providers (Anthropic-compatible endpoints such as your own proxy, OpenRouter, Ollama, etc.), pick the active one in a click, and the app writes the corresponding environment variables straight to `~/.claude/settings.json` so Claude Code picks them up on the next run.

## Features

- Store any number of providers, each with its own `baseUrl`, `authToken`, and per-role model mapping (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`).
- One-click apply — the active provider's settings are merged into Claude Code's `settings.json`.
- Fetch available models from the provider's `/v1/models` endpoint (OpenAI-compatible) and pick them from a dropdown.
- Local-only: data lives under your OS user data directory; no telemetry, no cloud sync.
- Single static-file frontend (HTML/CSS/JS, no bundler), Rust backend over Tauri IPC.

## Screenshots

The UI is a single window with the saved providers list on top and an editor form below. Active provider is highlighted; applying re-writes `settings.json` atomically.

## Download (no build required)

Pre-built installers are published on the [GitHub Releases page](https://github.com/manhphua35/claudecode-switch/releases). Grab the asset for your OS:

- **Windows** — `*-setup.exe` (NSIS) or `*.msi`
- **macOS** — `*.dmg` (universal binary, Intel + Apple Silicon)
- **Linux** — `*.AppImage` or `*.deb`

New releases are produced automatically by GitHub Actions whenever a `v*` tag is pushed (see [`.github/workflows/release.yml`](.github/workflows/release.yml)). If you only want to *use* the app, you can stop reading here — the rest of the README is for building from source.

## Requirements

### Windows

1. **Rust toolchain** (stable) — install via [rustup](https://rustup.rs/).
2. **Microsoft Visual Studio C++ Build Tools** with the "Desktop development with C++" workload.
3. **WebView2 Runtime** — already shipped with Windows 11.
4. **Tauri CLI**:
   ```powershell
   cargo install tauri-cli --version "^2"
   ```

### macOS / Linux

The codebase is portable, but the rest of this README focuses on Windows. On macOS you need Xcode command-line tools; on Linux you need `webkit2gtk` and the usual build deps — see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

## Run in development

```powershell
cd src-tauri
cargo tauri dev
```

The first run fetches all crates (this can take several minutes). After that, edits to `dist/*` hot-reload in the running window; Rust changes trigger a recompile.

## Build a release binary

```powershell
cd src-tauri
cargo tauri build
```

Artifacts:

- **Standalone executable**: `src-tauri/target/release/claudecode-switch.exe`
- **Installers**: `src-tauri/target/release/bundle/`
  - `msi/*.msi` — Windows Installer
  - `nsis/*-setup.exe` — NSIS setup

> The Windows MSI bundler needs a real `.ico` file. The repo already ships one under `src-tauri/icons/icon.ico`; if you replace it, regenerate the full icon set with `cargo tauri icon path/to/new-icon.png`.

## Project structure

```
claudecode-switch-rs/
├── dist/                       # Static frontend (no bundler)
│   ├── index.html
│   ├── index.css
│   └── index.js
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json         # Window config + bundle icons
    ├── capabilities/default.json
    ├── icons/                  # All platform icons (PNG / ICO / ICNS)
    └── src/
        ├── main.rs             # Entrypoint (calls lib::run)
        └── lib.rs              # Tauri builder + #[tauri::command] handlers
```

## How it works

The frontend talks to Rust through Tauri's `invoke` bridge. Available commands:

| Command          | Payload                              | Returns                                                  |
| ---------------- | ------------------------------------ | -------------------------------------------------------- |
| `list_providers` | —                                    | `{ providers: Provider[], activeId?: string }`           |
| `create_provider`| `{ body: ProviderInput }`            | `Provider`                                               |
| `update_provider`| `{ id, data: ProviderInput }`        | `Provider`                                               |
| `delete_provider`| `{ id }`                             | `{ success: true }`                                      |
| `apply_provider` | `{ id }`                             | `{ success, activeId, settingsPath }`                    |
| `get_settings`   | —                                    | `{ env: Record<string,string> }`                         |
| `fetch_models`   | `{ baseUrl, authToken }`             | `{ models: [{ id }] }` — queried from `<baseUrl>/v1/models` |

`apply_provider` is the only command that mutates Claude Code's actual settings file — everything else operates on the provider store.

## Runtime file locations

- **Claude Code settings (modified by Apply)**: `%USERPROFILE%\.claude\settings.json`
- **Provider store (read/written by this app)**: `%APPDATA%\switcher.claudecode.dev\providers.json`
  - macOS: `~/Library/Application Support/switcher.claudecode.dev/providers.json`
  - Linux: `~/.local/share/switcher.claudecode.dev/providers.json`

> The provider store contains your auth tokens in plain text. It lives in your user-only app data folder; it is not encrypted. Don't commit it, don't share it.

## Configuration notes

- `withGlobalTauri: true` in `tauri.conf.json` lets the frontend call `window.__TAURI__.core.invoke` directly without a bundler.
- `security.csp` is set to `null` to allow Google Fonts imports from CSS. Tighten this if you replace the fonts with local files.
- The provider store schema is forward-compatible: unknown fields are ignored on read, so older versions of the app can still load files written by newer ones.

## Development tips

- Frontend edits live in `dist/` — no build step, just refresh.
- Backend handlers are all in `src-tauri/src/lib.rs`. Add a new command by writing a `#[tauri::command]` fn and registering it in `tauri::generate_handler![…]` inside `run()`.
- The `~/.claude` directory is created on demand when you apply a provider; you don't need to install Claude Code itself to develop against this app, but obviously you'll want it to actually use the resulting settings.

## License

MIT — see [LICENSE](LICENSE) if present, otherwise treat it as MIT for personal use.
