import type { Database } from '../../services/storageService';
import type { EvidenceMoment, EvidenceMomentType } from '../../types/EvidenceMoment';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';

const momentTypes: EvidenceMomentType[] = [
  'repeated_authentication',
  'missing_alternative_verification',
  'caller_cut_off',
  'long_pause',
  'wrong_workflow',
  'unresolved_request',
  'escalation',
  'product_availability',
  'missing_integration',
  'manual_highlight',
  'other'
];

const reviewerFlags: EvidenceMoment['reviewer_flag'][] = [
  '',
  'important_moment',
  'training_example',
  'needs_escalation'
];

export function HighlightNoteModal({
  draft,
  db,
  onChange,
  onCancel,
  onSave,
  onGenerateAiNote,
  onAskAi
}: {
  draft: EvidenceMoment;
  db: Database;
  onChange: (patch: Partial<EvidenceMoment>) => void;
  onCancel: () => void;
  onSave: () => void;
  onGenerateAiNote?: () => void | Promise<void>;
  onAskAi?: (prompt: string) => void;
}) {
  return (
    <Modal title="Investigation highlight" onClose={onCancel} wide stacked>
      <p className="muted">
        Tag this moment for QA review. Saved highlights appear on the evidence timeline and transcript.
      </p>
      <blockquote className="highlight-quote">{draft.quote_or_transcript_excerpt}</blockquote>
      <div className="form-grid compact">
        <Field label="Moment type">
          <select
            value={draft.moment_type}
            onChange={e => onChange({ moment_type: e.target.value as EvidenceMomentType })}
          >
            {momentTypes.map(t => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select
            value={draft.severity}
            onChange={e => onChange({ severity: e.target.value as EvidenceMoment['severity'] })}
          >
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </Field>
        <Field label="Reviewer flag">
          <select
            value={draft.reviewer_flag || ''}
            onChange={e => onChange({ reviewer_flag: e.target.value as EvidenceMoment['reviewer_flag'] })}
          >
            {reviewerFlags.map(f => (
              <option key={f || 'none'} value={f}>
                {f ? f.replace(/_/g, ' ') : '—'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Link to issue (optional)">
          <select
            value={draft.issue_id || draft.linked_issue_id || ''}
            onChange={e => onChange({ issue_id: e.target.value || undefined, linked_issue_id: e.target.value || undefined })}
          >
            <option value="">—</option>
            {db.issues.map(i => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Why this matters (customer + ops)">
          <textarea
            rows={3}
            value={draft.explanation}
            onChange={e => onChange({ explanation: e.target.value })}
            placeholder="What went wrong for the caller?"
          />
        </Field>
        <Field label="Customer impact">
          <textarea
            rows={2}
            value={draft.customer_impact || ''}
            onChange={e => onChange({ customer_impact: e.target.value })}
          />
        </Field>
        <Field label="Engineering impact">
          <textarea
            rows={2}
            value={draft.engineering_impact || ''}
            onChange={e => onChange({ engineering_impact: e.target.value })}
          />
        </Field>
        <Field label="Suggested fix">
          <textarea
            rows={3}
            value={draft.recommended_fix}
            onChange={e => onChange({ recommended_fix: e.target.value })}
            placeholder="Concrete workflow or prompt change"
          />
        </Field>
        <Field label="Voice / pacing notes (optional)">
          <textarea
            rows={2}
            value={draft.voice_cue_notes || ''}
            onChange={e => onChange({ voice_cue_notes: e.target.value })}
          />
        </Field>
      </div>
      {onGenerateAiNote && (
        <div className="row wrap">
          <button type="button" className="btn-sm primary-soft" onClick={() => void onGenerateAiNote()}>
            Fill note with AI
          </button>
        </div>
      )}
      {onAskAi && (
        <div className="highlight-ai-actions">
          <span className="muted">AI follow-up</span>
          <div className="row wrap">
            <button type="button" className="btn-sm" onClick={() => onAskAi('Explain why this moment matters operationally.')}>
              Explain why this matters
            </button>
            <button type="button" className="btn-sm" onClick={() => onAskAi('Suggest a concrete workflow fix for this moment.')}>
              Suggest fix
            </button>
            <button type="button" className="btn-sm" onClick={() => onAskAi('What similar failure patterns might exist in other calls?')}>
              Find similar patterns
            </button>
            <button type="button" className="btn-sm" onClick={() => onAskAi('Write a short engineering summary for this highlight.')}>
              Engineering summary
            </button>
          </div>
        </div>
      )}
      <div className="row end">
        <button type="button" onClick={onCancel}>
          Discard
        </button>
        <button type="button" className="primary" onClick={onSave}>
          Save highlight
        </button>
      </div>
    </Modal>
  );
}
