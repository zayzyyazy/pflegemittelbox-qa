import { useState } from 'react';
import type { Database } from '../../services/storageService';
import type { DraftCall } from '../../types/DraftCall';
import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { callerRequestLabels } from '../../utils/anliegen';
import { deriveMainIssue } from '../../utils/issueLabels';
import { findDuplicate } from '../../services/duplicateService';
import { removeDraft, saveDraftAsCall, updateDraft } from '../../services/draftService';
import { CallerRequestTag } from './CallerRequestTag';
import { ResultPill } from './ResultPill';

export function DraftReviewModal({
  db,
  setDb,
  draft,
  onClose
}: {
  db: Database;
  setDb: (db: Database) => void;
  draft: DraftCall;
  onClose: () => void;
}) {
  const [call, setCall] = useState<Partial<CallReview>>({ ...draft.call });
  const [evidence] = useState<Partial<EvidenceMoment>[]>(draft.evidence);
  const [notes, setNotes] = useState(call.reviewer_call_notes || '');
  const [dup, setDup] = useState<{ call: CallReview; reason: string } | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const mainIssue = deriveMainIssue(call as CallReview, evidence as EvidenceMoment[]);

  const update = (p: Partial<CallReview>) => setCall(c => ({ ...c, ...p }));

  function reject() {
    setDb(removeDraft(db, draft.id));
    onClose();
  }

  function save(anyway = false) {
    const full = { ...call, reviewer_call_notes: notes } as CallReview;
    const match = findDuplicate(full, db.calls.filter(c => c.id !== full.id));
    if (match && !anyway) {
      setDup(match);
      return;
    }
    setDb(saveDraftAsCall(db, { ...draft, call: full, evidence }, full, evidence as EvidenceMoment[]));
    onClose();
  }

  function saveEdits() {
    setDb(updateDraft(db, draft.id, { call: { ...call, reviewer_call_notes: notes }, evidence }));
  }

  return (
    <Modal title={`Review draft · ${draft.file_name}`} onClose={onClose} wide stacked>
      <div className="batch-review">
        <div className="kpi-strip">
          <div><span className="label">Caller request</span><CallerRequestTag category={call.anliegen || 'other'} /></div>
          <div><span className="label">Result</span><ResultPill status={call.solved_status || 'no'} /></div>
          <div><span className="label">Rating</span><b>{call.overall_rating ?? '—'}/10</b></div>
          <div><span className="label">Main issue</span><b>{mainIssue}</b></div>
        </div>

        <section className="form-grid">
          <Field label="Call ID">
            <input value={call.call_id || ''} onChange={e => update({ call_id: e.target.value })} />
          </Field>
          <Field label="Caller request">
            <select value={call.anliegen || 'other'} onChange={e => update({ anliegen: e.target.value as CallReview['anliegen'] })}>
              {Object.entries(callerRequestLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Result">
            <select value={call.solved_status || 'no'} onChange={e => update({ solved_status: e.target.value as CallReview['solved_status'] })}>
              <option value="yes">yes</option>
              <option value="partially">partially</option>
              <option value="no">no</option>
            </select>
          </Field>
          <Field label="Rating">
            <input type="number" min={1} max={10} value={call.overall_rating ?? 5} onChange={e => update({ overall_rating: Number(e.target.value) })} />
          </Field>
          <Field label="Main issue">
            <input value={call.primary_issue_label || mainIssue} onChange={e => update({ primary_issue_label: e.target.value as CallReview['primary_issue_label'] })} />
          </Field>
          <Field label="Full call notes">
            <textarea className="call-notes-area" value={notes} onChange={e => setNotes(e.target.value)} placeholder="What happened in this call..." />
          </Field>
          <Field label="Reviewer notes">
            <textarea value={call.reviewer_notes || ''} onChange={e => update({ reviewer_notes: e.target.value })} />
          </Field>
        </section>

        {call.call_summary && (
          <section className="detail-section">
            <h3>Summary</h3>
            <p>{call.call_summary}</p>
          </section>
        )}

        <section className="detail-section">
          <h3>Evidence ({evidence.length})</h3>
          {evidence.length ? (
            <div className="evidence-events compact-timeline">
              {evidence.map(e => (
                <article className="evidence-event ai-suggested" key={e.id}>
                  <span className="badge gray">AI suggested</span>
                  <span className="badge yellow">{e.moment_type?.replace(/_/g, ' ')}</span>
                  <blockquote>{e.quote_or_transcript_excerpt}</blockquote>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">No AI evidence — normal for successful calls.</p>
          )}
        </section>

        <section className="detail-section">
          <button type="button" className="btn-text" onClick={() => setShowTranscript(v => !v)}>
            {showTranscript ? 'Hide transcript' : 'View transcript'}
          </button>
          {showTranscript && (
            <pre className="transcript tall">{draft.transcript || call.transcript || 'No transcript'}</pre>
          )}
        </section>

        {draft.duplicate_warning && (
          <p className="error">⚠ Possible duplicate — confirm before saving.</p>
        )}

        <div className="row end wrap">
          <button type="button" className="btn-danger-soft" onClick={reject}>Reject draft</button>
          <button type="button" onClick={saveEdits}>Save edits</button>
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" className="primary" onClick={() => save(false)}>Save call</button>
        </div>

        {dup && (
          <div className="duplicate">
            <p>Duplicate: {dup.call.call_id} ({dup.reason})</p>
            <button type="button" onClick={() => save(true)}>Save anyway</button>
            <button type="button" onClick={() => setDup(null)}>Cancel</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
