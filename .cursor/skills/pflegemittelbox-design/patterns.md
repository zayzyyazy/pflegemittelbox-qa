# Pflegemittelbox — UI Patterns

## Inbox page

```
┌─ Inbox ──────────────────────────────────────────────┐
│ Pipeline: Processing 2 · Ready 8 · Saved 45 · Flagged 3 │
├──────────────────────────────────────────────────────┤
│ [Drop zone: WAV / folder]                            │
├──────────────────────────────────────────────────────┤
│ Processing                                           │
│  • file.wav — Transcribing                           │
├──────────────────────────────────────────────────────┤
│ Needs review                    [Save all ready (8)] │
│ ┌──────────┐ ┌──────────┐                           │
│ │ Box chg  │ │ Order st │                           │
│ │ yes      │ │ partially│                           │
│ │ ⚠ 1 find │ │          │                           │
│ │[Save][Rev]│ │[Save][Rev]│                          │
│ └──────────┘ └──────────┘                           │
└──────────────────────────────────────────────────────┘
```

Card shows: Anliegen tag · Result · finding count · Save primary · Review secondary.

## Review shell (two column)

```
┌─ Review ───────────────────────────────────────────── [Save & next] ─┐
│ ▶ Audio player                                                       │
│ Anliegen [▼]  Result [▼]  Note [________]                            │
│ ── Findings ──────────────────────────────────────────────────────── │
│ ⚠ VNR interrupted (0:42)  [Confirm] [Dismiss]                        │
│ ✓ No other issues detected                                           │
│ Summary: Caller reactivated box and adjusted contents.               │
├──────────────────────────┬───────────────────────────────────────────┤
│ (optional narrow meta)   │ Transcript                              │
│                          │ 0:12 Marie  Guten Tag...                  │
│                          │ 0:18 Caller Ich wollte...               │
└──────────────────────────┴───────────────────────────────────────────┘
```

## Calls grouped view

```
▼ Box / product change (23)
  abc123 · yes · No major issue · 0 ev
  def456 · yes · ⚠ Auth issue · 2 ev · linked #issue_3
▼ Order status (11)
  ...
```

## Issue card (minimal)

```
┌─────────────────────────────────────┐
│ HIGH · Active                       │
│ Authentication repeats DOB          │
│ 8 calls · latest 2026-05-08         │
│ "Bitte nennen Sie Ihr Gebu..."      │
│ [Open issue]                        │
└─────────────────────────────────────┘
```

No Ask AI button. No 3-paragraph AI summary on card.

## Empty states

| Page | Message |
|------|---------|
| Inbox empty | Drop WAV files above. Saved calls appear under Calls. |
| Calls empty | No saved calls yet. Import from Inbox. |
| No findings | No issues detected — normal for successful calls. |

## CSS conventions (existing)

- `.panel` — section container
- `.compact-card-grid` — draft/issue cards
- `.call-review-shell`, `.call-review-sticky-bar`, `.call-review-grid` — review layout
- `.speaker-badge.speaker-agent` / `.speaker-caller` — transcript
- `.badge.green|red|blue` — status

Extend existing `globals.css` — do not introduce a second design system.

## Responsive

- Review shell: two columns ≥900px; stack on narrow
- Sticky save bar always visible when modal open
