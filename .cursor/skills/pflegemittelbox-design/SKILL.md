---
name: pflegemittelbox-design
description: UI/UX design standards for Pflegemittelbox Marie QA Cockpit — operator-first layouts, issue-first review, call pipeline tracking, anti-patterns to avoid. Use when designing or implementing UI in pflegemittelbox-qa, reviewing UX, adding pages/components, or when the user says the app feels unusable, cluttered, or lacks tracking.
---

# Pflegemittelbox Design

## Product shape

**One daily loop:** Import → triage drafts → save/flag → browse library → link issues → pin examples.

| Area | Job | Not for |
|------|-----|---------|
| **Inbox** | Pipeline + batch progress + fast save/flag | Browsing saved library |
| **Calls** | Saved library, filters, grouped browse | Import or drafts |
| **Issues** | Recurring problems + linked call evidence | Primary call review |

Nav stays **4 items max**: Inbox · Calls · Issues · Settings. No dashboard bloat, no chat-first panels in core path.

## Design north star

Build an **operator tool**, not an admin dashboard or AI demo.

- **Signal over noise** — every pixel earns its place
- **Problems first** — findings visible before Save, not buried in Advanced
- **Pipeline visible** — user always knows where they are in a batch
- **One review shell** — same layout for draft and saved call
- **Speed for clean calls, friction for suspicious ones** — 1-click save only when no open findings

## Layout rules

### Call review shell (canonical)

```
[Sticky: Save | Save & next | Flag issue | Reject/Done]

[Audio player — always visible]

[Anliegen] [Result] [Status badge: reviewed/flagged/new]

[Findings strip — AI + heuristic hits, confirm/dismiss each]

[One-line summary — read-only]

[Transcript — speaker badges, timestamps seek audio]

[Advanced collapsed: call ID, ratings, evidence detail, power tools]
```

**Above the fold must include:** audio + at least one finding OR explicit "No issues detected" + transcript start.

### Inbox pipeline header (required metrics)

Show live counts, e.g.:
`Processing 3 · Ready 12 · Saved today 28 · Flagged 4 · Linked to issues 2`

Empty states explain next action — not motivational filler.

### Calls library

- Group by **Anliegen** default; table view secondary
- Row/card: short call ID · Anliegen tag · Result · issue indicator · evidence count
- Filters must work — broken filters are a **P0 bug**
- Workspace toggle: Production | Test — never separate nav page

## Interaction rules

| Action | Pattern |
|--------|---------|
| Save clean draft | 1 click on card |
| Save with findings unreviewed | Block or confirm — never silent ignore |
| Flag issue | 1 click from review shell → pick/create issue |
| Batch import | API key gate before queue; clear error per file |
| Keyboard | Cmd/Ctrl+Enter save; Esc close; `j/k` optional next/prev draft |

## Visual style

- Clean, restrained color — tags carry color (Anliegen, Result, severity), not entire rows
- **No giant cards**, no Streamlit density, no duplicate labels (don't show "Caller request" label + same text 3 times)
- Teal accent (`#215c68`) for primary actions — existing app palette
- Speaker badges: Marie (teal), Caller (neutral gray)
- Status badges: queued/processing/ready/failed — small, top-right of cards

## Anti-patterns (never ship)

- ❌ Raw `<pre>` transcript wall without speakers/timestamps
- ❌ Review modal without audio when `audio_local_path` exists
- ❌ 8+ form fields before Save button
- ❌ Ask AI / Investigation chat in default review path
- ❌ 9 sidebar pages for a 3-step workflow
- ❌ Import creates 20 failed cards when API key missing
- ❌ Evidence/findings only in collapsed Advanced
- ❌ "Review draft" as only way to save
- ❌ Calls page that also imports, shows drafts, pinned strip, and library

## Issue-first UX (critical gap to close)

Issues must **surface during review**, not only on Issues page:

1. Show finding cards inline with quote + timestamp
2. Confirm → links evidence to call; Dismiss → hides for this call
3. "Flag issue" creates/links issue with one flow
4. Calls filter: **Has open finding** · **Not reviewed** · **Linked to issue**

## Tracking model (UI must reflect)

| Field | Purpose |
|-------|---------|
| `review_status` | `new` \| `reviewed` \| `flagged` |
| `import_batch_id` / date | Group imports |
| `linked_issue_ids` | Bridge to Issues page |
| `pinned` + `pin_note` | Dashboard exemplars |
| `call_id` | CRM ID prominent — not UUID filename |

## Component reuse

- `CallReviewShell` — all call detail/draft review
- `CallAudioPlayer` — shared audio
- `TranscriptReviewPanel` — segments + speaker badges; read-only in draft mode
- Do not fork second review modals

## When implementing UI changes

1. Read this skill + [marie-qa](../marie-qa/SKILL.md) for domain
2. Sketch which **pipeline metric** or **finding** the change exposes
3. Default to **less UI** — remove before adding
4. Test with batch of 10+ imports: can user finish without rage-scrolling?

## Additional resources

- Layout and component patterns: [patterns.md](patterns.md)
