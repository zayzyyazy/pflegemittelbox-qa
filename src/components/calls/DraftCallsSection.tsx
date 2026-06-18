import { useState } from 'react';
import type { Database } from '../../services/storageService';
import type { DraftCall } from '../../types/DraftCall';
import type { CallReview } from '../../types/CallReview';
import { resolveEvidenceForSave } from '../../utils/evidenceReview';
import { acceptDraft, acceptAllReadyDrafts, removeFailedDrafts } from '../../services/draftService';
import { callerRequestLabels } from '../../utils/anliegen';
import { CallReviewShell } from './CallReviewShell';

function draftLabel(d: DraftCall) {
  const id = d.call.call_id || d.file_name.replace(/-call-recording\.(wav|mp3|m4a)$/i, '');
  return id.length > 36 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;
}

function ReadyRow({
  d,
  onSave,
  onReview
}: {
  d: DraftCall;
  onSave: () => void;
  onReview: () => void;
}) {
  const anliegen = d.call.anliegen ? callerRequestLabels[d.call.anliegen] : '—';
  const result = d.call.solved_status || '—';
  const findingCount = d.evidence.filter(e => e.reviewer_status !== 'dismissed').length;

  return (
    <div className="inbox-ready-row">
      <button type="button" className="link-button inbox-row-id" onClick={onReview}>
        {draftLabel(d)}
      </button>
      <span className="muted inbox-row-meta">{anliegen}</span>
      <span className={`inbox-row-result result-${result}`}>{result}</span>
      {findingCount > 0 && <span className="badge yellow">{findingCount} findings</span>}
      {d.call.workspace === 'test' && <span className="badge blue">Test</span>}
      {d.duplicate_warning && <span className="badge gray">dup?</span>}
      <div className="inbox-row-actions">
        <button type="button" className="btn-sm primary" onClick={onSave}>Save</button>
        <button type="button" className="btn-sm" onClick={onReview}>Review</button>
      </div>
    </div>
  );
}

export function DraftCallsSection({
  db,
  setDb,
  readyDrafts,
  failedDrafts,
  onReprocess,
  onRetryAllFailed,
  openSettings,
  onCallSaved
}: {
  db: Database;
  setDb: (db: Database) => void;
  readyDrafts: DraftCall[];
  failedDrafts: DraftCall[];
  onReprocess?: (draft: DraftCall) => void;
  onRetryAllFailed?: () => void;
  openSettings?: () => void;
  onCallSaved?: (call: Partial<CallReview>) => void;
}) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [failedOpen, setFailedOpen] = useState(false);
  const review = reviewId ? [...readyDrafts, ...failedDrafts].find(d => d.id === reviewId) : null;
  const readyIds = readyDrafts.map(d => d.id);
  const missingKey = !db.settings.openaiApiKey.trim();

  if (!readyDrafts.length && !failedDrafts.length) return null;

  function saveDraft(d: DraftCall) {
    const evidence = resolveEvidenceForSave(d.evidence) as DraftCall['evidence'];
    setDb(acceptDraft(db, { ...d, evidence }));
    onCallSaved?.(d.call);
  }

  function saveAllReady() {
    const withDup = readyDrafts.filter(d => d.duplicate_warning);
    if (withDup.length && !window.confirm(`${withDup.length} may be duplicates. Save all anyway?`)) return;
    setDb(acceptAllReadyDrafts(db));
    readyDrafts.forEach(d => onCallSaved?.(d.call));
  }

  function saveAndNext() {
    if (!review) return;
    const evidence = resolveEvidenceForSave(review.evidence) as DraftCall['evidence'];
    setDb(acceptDraft(db, { ...review, evidence }));
    onCallSaved?.(review.call);
    const idx = readyIds.indexOf(review.id);
    const nextId = idx >= 0 && idx < readyIds.length - 1 ? readyIds[idx + 1] : null;
    setReviewId(nextId);
  }

  return (
    <>
      {readyDrafts.length > 0 && (
        <section className="panel inbox-ready-section">
          <div className="row between wrap">
            <div>
              <h2>Ready to save ({readyDrafts.length})</h2>
              <p className="muted">1-click Save — open Review only when something looks wrong.</p>
            </div>
            <button type="button" className="primary" onClick={saveAllReady}>
              Save all ({readyDrafts.length})
            </button>
          </div>
          <div className="inbox-ready-list">
            {readyDrafts.map(d => (
              <ReadyRow
                key={d.id}
                d={d}
                onSave={() => saveDraft(d)}
                onReview={() => setReviewId(d.id)}
              />
            ))}
          </div>
        </section>
      )}

      {failedDrafts.length > 0 && (
        <section className="panel inbox-failed-section">
          <button type="button" className="inbox-failed-toggle row between" onClick={() => setFailedOpen(v => !v)}>
            <span>
              <strong>{failedDrafts.length} failed import{failedDrafts.length !== 1 ? 's' : ''}</strong>
              {missingKey && <span className="muted"> — add API key in Settings</span>}
            </span>
            <span className="muted">{failedOpen ? 'Hide' : 'Show'}</span>
          </button>
          {failedOpen && (
            <>
              <div className="row wrap inbox-failed-actions">
                {missingKey && openSettings && (
                  <button type="button" className="btn-sm primary-soft" onClick={openSettings}>Open Settings</button>
                )}
                {!missingKey && onRetryAllFailed && (
                  <button type="button" className="btn-sm primary-soft" onClick={onRetryAllFailed}>
                    Retry all failed
                  </button>
                )}
                <button type="button" className="btn-sm" onClick={() => setDb(removeFailedDrafts(db))}>
                  Dismiss all failed
                </button>
              </div>
              <ul className="inbox-failed-list">
                {failedDrafts.map(d => (
                  <li key={d.id}>
                    <span className="clamp-cell">{draftLabel(d)}</span>
                    <span className="error clamp-cell">{d.error || 'Import failed'}</span>
                    {onReprocess && !missingKey && (
                      <button type="button" className="btn-sm" onClick={() => onReprocess(d)}>Retry</button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {review && (
        <CallReviewShell
          mode="modal"
          db={db}
          setDb={setDb}
          draft={review}
          onClose={() => setReviewId(null)}
          onSaveAndNext={saveAndNext}
          hasNextDraft={readyIds.indexOf(review.id) >= 0 && readyIds.indexOf(review.id) < readyIds.length - 1}
          onSaved={call => onCallSaved?.(call || review.call)}
        />
      )}
    </>
  );
}
