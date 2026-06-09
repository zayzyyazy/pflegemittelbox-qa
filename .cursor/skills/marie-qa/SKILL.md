---
name: marie-qa
description: Marie/Pflegemittelbox voice-agent QA domain — Anliegen taxonomy, prod vs experimental bots, verification flows, workflow-area findings, recall-first extraction, dual-axis scoring, experiments. Use when reviewing Marie calls, building extraction, labeling Anliegen, detecting issues, scoring results, or working on Pflegemittelbox QA features.
---

# Marie QA Domain

## What this app answers

For every **production Marie** call (Pflegemittelbox / Leaping AI):

1. **Anliegen** — what did the caller want? (main category + optional sub-tags)
2. **Result** — did Marie complete the workflow correctly? (`yes` / `partially` / `no`)
3. **Findings** — what broke, in which **workflow area**, and **failure_mode**?
4. **Tracking** — link calls to **issues**, **pins**, and **experiments**

## Core principles (non-negotiable)

> **Intelligence ≠ reliability.** Most prod failures are workflow architecture, not conversational intelligence.

> **Production Marie ≠ Experimental Marie.** They are different agents. Tag every call `bot_version: production | experimental`. Never compare one's strengths to the other's weaknesses.

> **Hybrid goal:** Production architecture + Experimental conversation quality. Every experiment must pass: *Does this improve conversation quality without risking operational stability?*

> **Recall-first findings:** Surface candidate problems; reviewer confirms or dismisses. Prefer missing a weak signal over hiding a real one in "Advanced."

## Bot profiles

| Bot | Strengths (protect in prod) | Weaknesses (flag in prod QA) |
|-----|----------------------------|------------------------------|
| **Production** | Transfer, completion, CRM/tickets, operational outcome | VNR interruptions, partial VNR accepted, birthday skip after phone match, correction handling, robotic pacing, talking over pauses |
| **Experimental** | Pause patience, VNR confirm, corrections, calmer tone | Transfer reliability, completion/CRM, routing loops, dropped calls |

**Experimental calls** live in the **test workspace only** — never mix into production library views.

## Anliegen taxonomy

Use exactly these main categories (see `src/utils/anliegen.ts`):

| Key | Label | Do NOT confuse with |
|-----|-------|---------------------|
| `box_or_product_change` | Box / product change | Onboarding, order status, reactivation |
| `order_status` | Order status | Delivery *complaint* (sub-tag), box change |
| `cancel_or_pause` | Cancel / pause | Box change |
| `address_or_account_change` | Address / account change | Authentication |
| `authentication_problem` | Authentication problem | Any call that merely *mentions* auth during another Anliegen |
| `new_customer_onboarding` | New customer / onboarding | Box change for existing customers |
| `general_information_question` | General information | Specific operational intents |
| `other` | Other | Default when uncertain — **not** a dumping ground for lazy classification |

**Classification rules:**
- Classify from **caller opening intent**, not keywords anywhere in transcript ("Bestellung", "Pause" mid-call ≠ category switch).
- **Reactivation / box content adjustment** for existing customers → usually `box_or_product_change`, not onboarding.
- **Lieferstatus** → `order_status`; sub-tag delivery_question vs delivery_complaint when applicable.
- When unsure between two categories, pick the **narrower** one or `other` — never default to `box_or_product_change`.

**Known mislabel patterns** (always double-check):
- Onboarding call labeled box change
- Delivery/status call labeled box change
- Krankenkasse / insurance info labeled box change

## Verification flow (Marie context)

```
Phone lookup success → ask birthday ONLY (not insurance again)
Phone lookup ≠ full auth → birthday still mandatory
Insurance (VNR): 1 letter + 9 digits — collect patiently, validate after speech, confirm when complete
Birthday: verify immediately; re-ask only if unclear
Corrections ("No, that was a six"): update, repeat, confirm, continue — do NOT restart whole flow
Field failures (birthday_system empty) → likely routing/data_field, not prompt
```

**Production failure patterns to detect (recall-first):**

| Pattern | Workflow area | Finding types |
|---------|---------------|---------------|
| VNR interrupted mid-speech | `verify` | `caller_cut_off`, `premature_processing` |
| Partial VNR accepted | `verify` | `incomplete_vnr_accepted` |
| No VNR echo confirm | `verify` | `missing_vnr_confirmation` |
| Correction not handled | `verify` | `correction_not_handled` |
| Birthday skipped after phone match | `verify` | `birthday_skipped_after_phone_match` |
| Talks over older/slow caller | `verify` | `long_pause`, `caller_cut_off` |
| Transfer failed / wrong dest | `transfer` | `wrong_routing`, `escalation` |
| CRM/ticket not updated | `crm_update` / `completion` | `missing_integration`, `unresolved_request` |
| Dialogue loop | `dialogue_loop` | `repeated_question`, `wrong_workflow` |
| Lieferstatus wrong month framing | `delivery` | `wrong_answer` |
| VIP retention too early | `vip_retention` | `wrong_workflow` |

Tag each finding with **failure_mode**: `routing` | `prompt` | `integration` | `data_field`.

## Result scoring

- **`yes`** — caller intent addressed and workflow completed (transfer, ticket, order, or truthful closure).
- **`partially`** — only when something meaningful was done but outcome incomplete; **not** a default for "awkward but fine" calls.
- **`no`** — unresolved, wrong workflow, auth failure, or operational failure.

**Dual-axis scores** (when implementing extraction/UI):
- `conversational_quality` (1–10) — pacing, patience, clarity, correction handling
- `operational_reliability` (1–10) — transfer, completion, CRM, routing correctness

## Reviewer workflow (what the app must support)

```
Import batch → draft → surface findings FIRST → confirm/dismiss → save with status
Saved call → link to issue → pin if exemplar → optional experiment link
```

**Call tracking states** (target model): `imported` → `reviewed` → `flagged` → `pinned` → linked to `issue_id`

**Do not** bury evidence/findings behind "Advanced" or require scrolling past 8 form fields to see problems.

## Experiments

One **setting change** per experiment. Required framing:
- `change_type`: prompt | node | field_mapping | timing | other
- `port_target`: which Experimental behavior (e.g. VNR confirmation)
- `architecture_constraint`: Production architecture only
- Compare **before** (prod) vs **after** (hybrid test) on **both** score axes

| Conv quality | Ops reliability | Decision |
|--------------|-----------------|----------|
| Improved | Stable | Ship candidate |
| Improved | Broken | Fix ops first — routing/node |
| Same/worse | Broken | Reject |
| Improved | Slightly degraded | Iterate — smaller scope |

## Extraction implementation notes

- Input: Whisper text + timestamped segments; speaker-label when possible (Marie / Caller).
- Heuristics + AI merge **recall-first** — see `src/engine/extractCall.ts`, `src/utils/transcriptHeuristics.ts`.
- Evidence quotes must be **verbatim** from transcript; max ~3 AI-suggested moments unless reviewer adds more.
- Never invent Anliegen/result/issues without transcript support.

## Additional resources

- Full workflow-area table and lieferstatus rules: [reference.md](reference.md)
- Mislabel and finding examples: [examples.md](examples.md)
