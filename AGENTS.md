# Pflegemittelbox QA (Marie QA Cockpit)

Tauri 2 desktop app: React + TypeScript + Vite frontend, Rust backend. See `README.md` for product overview and the full command list.

## Cursor Cloud specific instructions

### Architecture notes that matter for running/testing
- The app's entire data layer (calls, issues, evidence, settings) is stored in the browser `localStorage` (see `src/services/storageService.ts`). The React frontend therefore runs fully in a plain browser via the Vite dev server — no Rust backend is required to exercise core QA workflows.
- The Rust/Tauri backend (`src-tauri/src/lib.rs`) only provides audio file storage/playback. Frontend calls to it are guarded by `'__TAURI_INTERNALS__' in window` (see `src/services/audioStorageService.ts`), so outside Tauri those features simply no-op rather than crash.
- On first load the DB is auto-seeded with demo calls/issues, so the UI is populated without any setup.

### Running in the cloud (Linux) — preferred path
- Use the web frontend for development and testing: `npm run dev` serves the app at `http://127.0.0.1:1420/`. Test it in Chrome.
- Do NOT rely on `npm run tauri:dev` / `npm run build:desktop` here: those target macOS (`build:desktop` copies a `.app` to `~/Desktop` and uses `xattr`) and the full Tauri desktop build needs webkit2gtk system libraries that are not installed. Rust toolchain (`cargo`) is present if you only need to type-check Rust.

### Checks (all run offline, no OpenAI key needed)
- Build / typecheck: `npm run build` (`tsc && vite build`).
- Analysis scenario tests: `npm run test:analysis`.
- Reference-call eval: `npm run eval:reference` (uses transcript fixtures in `fixtures/reference-calls/`).
- There is no separate lint script; `tsc` (via `npm run build`) is the type-level check.

### Gotchas
- OpenAI-powered features (transcription, AI analysis/investigation) require an API key entered in the app's Settings page; they are optional and not needed to run/test the core UI or the offline checks above.
- `npm run ui:explore` / `ui:explore:full` depend on a personal skill script at `~/.cursor/skills/ui-explore/scripts/ui-explore.mjs` that is not present in a fresh cloud VM; prefer manual browser testing instead.
