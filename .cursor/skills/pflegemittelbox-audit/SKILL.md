---
name: pflegemittelbox-audit
description: Mandatory pre-change checklist for Pflegemittelbox QA app. Use before any UI, extraction, or data model change in pflegemittelbox-qa. Ensures marie-qa and pflegemittelbox-design skills are followed and audit gaps are not regressed.
---

# Pflegemittelbox Audit Checklist

Before changing UI, extraction, or backend in `pflegemittelbox-qa`:

1. Read [marie-qa](../marie-qa/SKILL.md) and [pflegemittelbox-design](../pflegemittelbox-design/SKILL.md)
2. Confirm change serves: **import → triage → flag → track → issues**
3. Verify checklist below — do not ship if any P0 item regresses

## P0 (must not break)

- [ ] Findings visible in review **before** Save (not only in Advanced)
- [ ] `ai_risk_hints` / evidence shown in FindingsStrip
- [ ] Confirm / dismiss on AI-suggested evidence
- [ ] Save blocked or confirmed when unreviewed AI findings exist
- [ ] Flag issue flow from review shell
- [ ] Transcript highlight → manual evidence still works
- [ ] Audio player in draft + saved review

## P1 (tracking)

- [ ] Inbox pipeline bar shows processing / ready / saved / flagged counts
- [ ] `review_status` on calls after save
- [ ] Calls filters: has evidence, has issue, review status

## Extraction

- [ ] Prompt is recall-first (candidates for reviewer, not empty by default)
- [ ] Run `npm run eval:reference` before desktop build when touching extraction

## Anti-patterns (never reintroduce)

- Raw `<pre>` transcript as primary view
- 8+ form fields before Save
- Ask AI in default review path
- Evidence only in collapsed Advanced
- 1-click Save with zero finding review on drafts with AI evidence
