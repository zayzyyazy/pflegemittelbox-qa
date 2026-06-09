# Marie QA — Reference

## Workflow areas (editable taxonomy target)

| Area | Covers |
|------|--------|
| `identify` | Initial intent capture, wrong opening routing |
| `verify` | VNR, birthday, phone lookup, corrections, interruptions |
| `delivery` | Lieferstatus, shipment timing, approval dates |
| `box_change` | Pflegebox contents, sizes, product swaps |
| `reactivation` | Re-enable paused/cancelled box |
| `cancel_pause` | Cancel or pause subscription |
| `tickets` | Ticket creation, follow-up |
| `transfer` | Handoff to human, wrong destination |
| `email` | Email capture/send failures |
| `crm_update` | CRM field updates |
| `completion` | Call end state, wrap-up |
| `field_mapping` | Missing/wrong system fields (e.g. birthday_system) |
| `dialogue_loop` | Repeated questions, stuck loops |
| `integration` | External system unavailable |
| `vip_retention` | VIP offers — only after answer + visible frustration |

## Lieferstatus sub-domain

- Sub-tags: `delivery_question` vs `delivery_complaint`
- Approval dates (`box_genehmigt`, `gen_pg54_ab`, etc.) matter more than generic tracking
- **Past months ≠ future months** — wrong framing = lieferstatus logic failure
- VIP (`rein_vip`) is retention — not at first mention

## Finding types (EvidenceMoment)

Common `moment_type` values in codebase:
- `authentication_friction`, `caller_cut_off`, `long_pause`, `repeated_question`
- `wrong_workflow`, `wrong_routing`, `wrong_answer`, `robotic_pacing`
- `missing_integration`, `escalation`, `unresolved_request`, `other`

Severity: `high` | `medium` | `low` — VNR/auth/interruption on older callers often **high**.

## German call language cues

| Caller says (approx) | Likely Anliegen |
|------------------------|-----------------|
| Pflegebox / Handschuhe / Desinfektion / Inhalt ändern | `box_or_product_change` |
| Wann kommt / Lieferung / Status / Sendung | `order_status` |
| Kündigen / pausieren / nicht mehr | `cancel_or_pause` |
| Adresse / Umzug / Kontodaten | `address_or_account_change` |
| Versicherungsnummer / Geburtsdatum / erkennt mich nicht | Often part of verify — only `authentication_problem` if auth IS the Anliegen |
| Neukunde / erstes Mal / Registrierung | `new_customer_onboarding` |
| Was ist Pflegemittelbox / allgemeine Frage | `general_information_question` |

## Issue linking

- Issues aggregate **pattern threads** from repeated findings (`issuePatternService`)
- Every **flagged** call should link to `issue_id` or create manual issue
- Pinned calls need **why pinned** note + optional experiment link
- Issue cards: title, severity, call count, latest evidence snippet — not essay-length AI prose

## Eval fixtures (build against these)

Minimum production scenarios:
1. VNR interrupted mid-speech
2. Customer corrects last digit — Marie confused or restarts
3. Phone match → Marie skips birthday
4. Older caller long pause → Marie talks over them
5. Order status without shipment lookup — truthful fallback vs loop
6. Reactivation + box content change (should NOT label as onboarding)

When changing extraction, run `npm run test:analysis` and compare Anliegen/result on reference library before shipping desktop build.
