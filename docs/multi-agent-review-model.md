# Multi-Agent Review Output Model

This model is the foundation for richer extraction, dashboard queues, trends, reminders, and Ask AI. The app should generate a structured `ReviewObject` for each imported call before building more dashboard UI.

## Agent Split

Use four agents, not five. Keep reviewer action items as an aggregation layer so the pipeline does not produce overlapping “advice” from every agent.

1. `conversation_understanding`
   - Summarize the call, caller goal, final outcome, Anliegen, solved status, and key entities.
   - Answer: what happened?

2. `qa_process_compliance`
   - Review Marie workflow correctness, verification behavior, compliance/process rules, wrong routing, missing integration, and policy-sensitive misses.
   - Answer: did the process work correctly?

3. `customer_experience`
   - Review confusion, frustration, clarity, reassurance, empathy, repetition, and whether the caller had to work too hard.
   - Answer: how did this feel for the caller?

4. `audio_behavioral_signals`
   - Review audio-backed or timing-backed signals: interruptions, pauses, overtalk, robotic pacing, dead air, unclear STT/TTS moments, and “caller checks if agent is still there.”
   - Answer: what can be heard or inferred from timing, not just text?

## Aggregation Layer

After agents run, aggregate their findings into one `ReviewObject`:

- `candidate_findings`: everything useful enough for a reviewer to inspect.
- `verified_findings`: reviewer-confirmed or high-confidence findings accepted by policy.
- `dismissed_findings`: reviewer-dismissed candidates.
- `action_items`: deduplicated next steps derived from findings.
- `dashboard_signals`: counts, tags, and searchable terms used by the command center.

The aggregation layer owns reviewer action items. Do not add a fifth “Reviewer Action Items Agent” unless the action synthesis becomes complex enough to need a separate prompt.

## Finding Contract

Every candidate finding must include:

- `type`
- `severity`
- `confidence`
- `evidence` with timestamp(s) and quote/excerpt where available
- `explanation`
- `suggested_action`
- optional `customer_impact`, `operational_impact`, `linked_issue_suggestion`, and `tags`

Store low and medium-confidence items as candidates instead of dropping them. The reviewer should be able to confirm or dismiss them quickly.

## Design Rules

- Prefer recall for candidate findings and precision for verified findings.
- Keep agent outputs separate so the UI can explain where a finding came from.
- Deduplicate during aggregation, not inside each agent.
- Preserve evidence anchors even when the transcript speaker labels are uncertain.
- Ask AI should query `ReviewObject`, calls, transcripts, issues, evidence, and reviewer notes together.

## Phase Order

1. Define and store `ReviewObject`.
2. Update extraction to produce candidate findings from each agent.
3. Update review UI to confirm/dismiss candidates.
4. Promote Dashboard into the command center using `ReviewObject.dashboard_signals`.
5. Add reminders/tasks and full Ask AI over the structured review dataset.
