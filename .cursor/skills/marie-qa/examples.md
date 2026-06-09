# Marie QA — Examples

## Anliegen mislabels (fix these in extraction)

| Call pattern | Wrong label | Correct label |
|--------------|-------------|---------------|
| New customer signup, first box setup | `box_or_product_change` | `new_customer_onboarding` |
| "Wo ist meine Lieferung?" / shipment timing | `box_or_product_change` | `order_status` |
| Krankenkasse / insurance question only | `box_or_product_change` | `general_information_question` or `authentication_problem` if stuck in verify |
| Reactivate paused box + adjust gloves | `cancel_or_pause` | `box_or_product_change` (sub-tag reactivation) |

## Finding examples (recall-first — show to reviewer)

**VNR interruption (prod Marie)**
> Caller: "Meine Versicherungsnummer ist A—"  
> Marie: "Danke, ich habe das notiert. Wie kann ich..."  
→ Finding: `caller_cut_off` / `premature_processing`, area `verify`, failure_mode `prompt`

**Birthday skip after phone match**
> System matched phone; Marie proceeds to order flow without DOB  
→ Finding: `birthday_skipped_after_phone_match`, area `verify`, failure_mode `routing` or `prompt`

**Correction not handled**
> Caller: "Nein, die letzte Ziffer war eine Sechs"  
> Marie repeats full VNR request from start  
→ Finding: `correction_not_handled`, area `verify`

**Order status without lookup**
> Caller asks delivery date; Marie: "Dazu habe ich gerade keine Information" and loops  
→ Finding: `missing_integration` or `unresolved_request`, area `delivery`

## Result examples

| Outcome | Result | Why |
|---------|--------|-----|
| Box order finalized after content changes | `yes` | Intent + workflow complete |
| Caller got answer but transfer promised and never happened | `no` | Operational failure |
| Auth completed, issue deferred to callback | `partially` | Not fully resolved on call |
| Awkward pacing but order completed correctly | `yes` | Conv issue → finding, not `partially` result |

## Successful call (no evidence is normal)

Reactivation + box adjustment, smooth verify, order confirmed — **0 AI evidence** is expected. Do not force findings. Still set Anliegen + `yes` accurately.

## Experiment note template

```
Change: [one prompt/node tweak]
Port target: Experimental VNR confirmation into prod architecture
Before calls: [prod IDs]
After calls: [test IDs]
Conv delta: better | same | worse
Ops delta: stable | degraded | improved
Decision: ship | reject | iterate
Golden rule: Does this improve conversation quality without risking operational stability?
```
