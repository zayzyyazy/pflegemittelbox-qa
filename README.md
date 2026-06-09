# Pflegemittelbox QA (Marie QA Cockpit)

Production-grade QA cockpit for German **Pflegebox / Pflegehilfsmittel** subscription phone calls handled by the Marie voice agent.

## What it does

- **Inbox pipeline** — drop WAV recordings, triage drafts, import from folders
- **Transcription & extraction** — caller intent (Anliegen), entities, friction signals
- **Multi-agent analysis** — acoustic engine, audio listener, signal engine
- **Evidence moments** — highlight transcript excerpts, flag issues, reviewer notes
- **Issue tracking** — patterns across calls, workflow-area tagging, investigations
- **Operator-first UX** — dashboard, calls, issues, settings; built for daily QA review

## Stack

| Layer | Tech |
|-------|------|
| Desktop | Tauri 2 |
| UI | React, TypeScript, Vite |
| Backend | Rust |
| AI | OpenAI API |
| Data | Local SQLite / file storage |

## Run locally

```bash
npm install
npm run tauri:dev
```

Set your OpenAI API key in **Settings**.

## Build desktop app

```bash
npm run build:desktop
```

## Eval & testing

```bash
npm run eval:reference   # reference call eval
npm run test:analysis    # analysis scenario tests
```

## Author

**zayzyyazy** — https://github.com/zayzyyazy
