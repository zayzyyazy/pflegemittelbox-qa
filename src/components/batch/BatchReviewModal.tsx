import { useState } from 'react';
import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { callerRequestLabels } from '../../utils/anliegen';
import { Modal } from '../ui/Modal';
import { CallerRequestTag } from '../calls/CallerRequestTag';
import { ResultPill } from '../calls/ResultPill';
import { deriveMainIssue } from '../../utils/issueLabels';

export function BatchReviewModal({
  fileName,
  draft,
  draftEvidence,
  transcript,
  onClose,
  onSave
}: {
  fileName: string;
  draft: Partial<CallReview>;
  draftEvidence: EvidenceMoment[];
  transcript?: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const call = draft as CallReview;
  const mainIssue = deriveMainIssue(call, draftEvidence);

  return (
    <Modal title={`Review draft · ${fileName}`} onClose={onClose} wide stacked>
      <div className="batch-review">
        <div className="kpi-strip">
          <div>
            <span className="label">Caller request</span>
            <CallerRequestTag category={call.anliegen || 'other'} />
          </div>
          <div>
            <span className="label">Result</span>
            <ResultPill status={call.solved_status || 'no'} />
          </div>
          <div>
            <span className="label">Rating</span>
            <b>{call.overall_rating ?? '—'}/10</b>
          </div>
          <div>
            <span className="label">Main issue</span>
            <b>{mainIssue}</b>
          </div>
        </div>

        {call.call_summary && (
          <section className="detail-section">
            <h3>Summary</h3>
            <p>{call.call_summary}</p>
          </section>
        )}

        {(call.original_intent_summary || call.final_outcome) && (
          <section className="detail-section">
            <h3>Intent & outcome</h3>
            {call.original_intent_summary && <p><b>Intent:</b> {call.original_intent_summary}</p>}
            {call.final_outcome && <p><b>Outcome:</b> {call.final_outcome}</p>}
          </section>
        )}

        <section className="detail-section">
          <div className="row between">
            <h3>Evidence ({draftEvidence.length})</h3>
          </div>
          {draftEvidence.length ? (
            <div className="evidence-events">
              {draftEvidence.map(e => (
                <article className="evidence-event" key={e.id}>
                  <div className="evidence-event-head">
                    <span className="ev-time">{e.moment_type.replace(/_/g, ' ')}</span>
                    <span className="badge yellow">{e.severity}</span>
                  </div>
                  <blockquote>{e.quote_or_transcript_excerpt}</blockquote>
                  {e.explanation && <p>{e.explanation}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">No evidence moments — normal for successful calls.</p>
          )}
        </section>

        <section className="detail-section">
          <button type="button" className="btn-text" onClick={() => setShowTranscript(v => !v)}>
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
          {showTranscript && (
            <pre className="transcript tall">{transcript || call.transcript || 'No transcript'}</pre>
          )}
        </section>

        <p className="muted">
          Anliegen: {callerRequestLabels[call.anliegen || 'other']} · Call ID: {call.call_id || '—'}
          {call.audio_local_path ? ' · Audio stored in app' : ''}
        </p>

        <div className="row end">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" onClick={onSave}>
            Save call to library
          </button>
        </div>
      </div>
    </Modal>
  );
}
