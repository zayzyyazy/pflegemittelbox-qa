import { useEffect, useState } from 'react';
import type { CallReview, RootCauseCategory } from '../../types/CallReview';
import { callerRequestLabels } from '../../utils/anliegen';
import { MAIN_ISSUE_LABELS } from '../../utils/issueLabels';
import { Field } from '../ui/Field';

const ROOT_CAUSES: RootCauseCategory[] = [
  'Timing / endpointing',
  'Interruption behavior',
  'Prompt / instruction issue',
  'Workflow logic issue',
  'Missing integration',
  'Identification/auth issue',
  'Transcription / STT issue',
  'TTS / voice naturalness',
  'Knowledge gap',
  'Other'
];

export function EditableAnalysisPanel({
  call,
  mainIssue,
  onSave,
  onCancelEdit
}: {
  call: CallReview;
  mainIssue: string;
  onSave: (patch: Partial<CallReview>) => void;
  onCancelEdit?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    anliegen: call.anliegen,
    solved_status: call.solved_status,
    primary_issue_label: call.primary_issue_label || mainIssue,
    root_cause_category: call.root_cause_category,
    original_intent_summary: call.original_intent_summary || call.caller_context || '',
    final_outcome: call.final_outcome || '',
    call_summary: call.call_summary || '',
    reviewer_notes: call.reviewer_notes || ''
  });

  useEffect(() => {
    if (!editing) {
      setForm({
        anliegen: call.anliegen,
        solved_status: call.solved_status,
        primary_issue_label: call.primary_issue_label || mainIssue,
        root_cause_category: call.root_cause_category,
        original_intent_summary: call.original_intent_summary || call.caller_context || '',
        final_outcome: call.final_outcome || '',
        call_summary: call.call_summary || '',
        reviewer_notes: call.reviewer_notes || ''
      });
    }
  }, [call, mainIssue, editing]);

  if (!editing) {
    return (
      <section className="detail-section analysis-summary-section">
        <div className="row between">
          <h3>AI analysis (editable)</h3>
          <button type="button" className="btn-sm primary-soft" onClick={() => setEditing(true)}>
            Edit analysis
          </button>
        </div>
        <dl className="analysis-dl">
          <div>
            <dt>Customer intent</dt>
            <dd>{callerRequestLabels[call.anliegen]}</dd>
          </div>
          <div>
            <dt>Call result</dt>
            <dd>{call.solved_status}</dd>
          </div>
          <div>
            <dt>Main issue</dt>
            <dd>{mainIssue}</dd>
          </div>
          <div>
            <dt>Root cause</dt>
            <dd>{call.root_cause_category}</dd>
          </div>
          <div>
            <dt>Resolution / outcome</dt>
            <dd>{call.final_outcome || '—'}</dd>
          </div>
        </dl>
        {call.call_summary && <p className="analysis-summary-text">{call.call_summary}</p>}
        {call.ai_risk_hints && (
          <p className="ai-hint-block">
            <span className="ai-hint-label">AI risk hints</span> {call.ai_risk_hints}
          </p>
        )}
        {call.ai_moments_of_interest && (
          <p className="ai-hint-block">
            <span className="ai-hint-label">Worth reviewing</span> {call.ai_moments_of_interest}
          </p>
        )}
        {call.reviewer_notes && <p className="qa-notes-body">{call.reviewer_notes}</p>}
      </section>
    );
  }

  return (
    <section className="detail-section analysis-edit-section">
      <div className="row between">
        <h3>Edit analysis</h3>
        <button
          type="button"
          className="btn-sm"
          onClick={() => {
            setEditing(false);
            onCancelEdit?.();
          }}
        >
          Cancel
        </button>
      </div>
      <div className="form-grid compact">
        <Field label="Customer intent">
          <select
            value={form.anliegen}
            onChange={e => setForm(f => ({ ...f, anliegen: e.target.value as CallReview['anliegen'] }))}
          >
            {Object.entries(callerRequestLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Call result">
          <select
            value={form.solved_status}
            onChange={e => setForm(f => ({ ...f, solved_status: e.target.value as CallReview['solved_status'] }))}
          >
            <option value="yes">yes</option>
            <option value="partially">partially</option>
            <option value="no">no</option>
          </select>
        </Field>
        <Field label="Main issue">
          <select
            value={form.primary_issue_label}
            onChange={e => setForm(f => ({ ...f, primary_issue_label: e.target.value }))}
          >
            {MAIN_ISSUE_LABELS.map(o => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Root cause">
          <select
            value={form.root_cause_category}
            onChange={e =>
              setForm(f => ({ ...f, root_cause_category: e.target.value as RootCauseCategory }))
            }
          >
            {ROOT_CAUSES.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Customer intent (detail)">
          <input
            value={form.original_intent_summary}
            onChange={e => setForm(f => ({ ...f, original_intent_summary: e.target.value }))}
          />
        </Field>
        <Field label="Resolution / outcome">
          <input
            value={form.final_outcome}
            onChange={e => setForm(f => ({ ...f, final_outcome: e.target.value }))}
          />
        </Field>
        <Field label="Summary">
          <textarea
            value={form.call_summary}
            onChange={e => setForm(f => ({ ...f, call_summary: e.target.value }))}
            rows={3}
          />
        </Field>
        <Field label="Reviewer notes (AI-assisted)">
          <textarea
            value={form.reviewer_notes}
            onChange={e => setForm(f => ({ ...f, reviewer_notes: e.target.value }))}
            rows={4}
          />
        </Field>
      </div>
      <div className="row end">
        <button
          type="button"
          className="primary"
          onClick={() => {
            onSave({
              anliegen: form.anliegen,
              solved_status: form.solved_status,
              primary_issue_label: form.primary_issue_label,
              root_cause_category: form.root_cause_category,
              original_intent_summary: form.original_intent_summary,
              caller_context: form.original_intent_summary,
              final_outcome: form.final_outcome,
              call_summary: form.call_summary,
              reviewer_notes: form.reviewer_notes
            });
            setEditing(false);
          }}
        >
          Save analysis
        </button>
      </div>
    </section>
  );
}
