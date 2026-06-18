import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { secondsToClock } from '../../utils/dates';
import { getEvidenceReviewStatus, isAiSuggested } from '../../utils/evidenceReview';
import { mergeEvidenceForDisplay } from '../../utils/operationalFailures';

function sourceBadge(source?: EvidenceMoment['source']) {
  if (source === 'system_rule') return 'Marie check';
  if (source === 'audio_listener') return 'Heard';
  if (source === 'ai_suggested' || source === 'ai') return 'AI';
  if (source === 'manual') return 'You';
  return 'Finding';
}

export function FindingsStrip({
  call,
  evidence,
  onConfirm,
  onDismiss,
  onJumpToTime,
  onSelectFinding,
  selectedFindingId
}: {
  call: Partial<CallReview>;
  evidence: Partial<EvidenceMoment>[];
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
  onJumpToTime?: (seconds: number) => void;
  onSelectFinding?: (id: string) => void;
  selectedFindingId?: string;
}) {
  const merged = mergeEvidenceForDisplay(call, evidence as EvidenceMoment[]);
  const visible = merged.filter(e => getEvidenceReviewStatus(e) !== 'dismissed');
  const structuredCount = visible.length;

  return (
    <section className="findings-strip panel">
      <h3>Findings {structuredCount > 0 && <span className="muted">({structuredCount})</span>}</h3>
      <p className="muted findings-strip-hint">
        One top workflow issue per call — repeated auth, missing verification, ticket gaps. Phone lookup misses are hidden.
      </p>

      {structuredCount === 0 && (
        <p className="findings-ok muted">No operational failure detected — highlight transcript text to add a manual finding.</p>
      )}

      {visible.map(e => {
        const status = getEvidenceReviewStatus(e);
        const evId = e.id || '';
        const selected = selectedFindingId === evId;
        const isSynthetic = evId.startsWith('ops:');
        return (
          <article
            className={`finding-row${status === 'confirmed' ? ' confirmed' : ''}${isAiSuggested(e) ? ' ai-suggested' : ''}${selected ? ' selected' : ''}`}
            key={evId || e.quote_or_transcript_excerpt}
            role={isSynthetic ? undefined : 'button'}
            tabIndex={isSynthetic ? undefined : 0}
            onClick={() => {
              if (isSynthetic) return;
              if (evId) onSelectFinding?.(evId);
              if (e.timestamp_start_seconds != null) onJumpToTime?.(e.timestamp_start_seconds);
            }}
            onKeyDown={ev => {
              if (isSynthetic) return;
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                if (evId) onSelectFinding?.(evId);
                if (e.timestamp_start_seconds != null) onJumpToTime?.(e.timestamp_start_seconds);
              }
            }}
          >
            <div className="row between wrap">
              <div className="row wrap">
                <span className={`badge ${e.severity === 'high' ? 'red' : e.severity === 'medium' ? 'yellow' : 'neutral'}`}>
                  {sourceBadge(e.source)}
                </span>
                <span className="badge gray">{e.moment_type?.replace(/_/g, ' ') || 'finding'}</span>
                {e.timestamp_start_seconds != null && (
                  <span className="finding-time">{secondsToClock(e.timestamp_start_seconds)}</span>
                )}
              </div>
              {status === 'pending' && evId && !isSynthetic && (
                <div className="row wrap finding-actions" onClick={ev => ev.stopPropagation()}>
                  <button type="button" className="btn-sm primary-soft" onClick={() => onConfirm(evId)}>
                    Confirm
                  </button>
                  <button type="button" className="btn-sm" onClick={() => onDismiss(evId)}>
                    Dismiss
                  </button>
                </div>
              )}
              {status === 'confirmed' && <span className="badge green">Confirmed</span>}
            </div>
            {e.quote_or_transcript_excerpt && (
              <blockquote className="finding-quote">{e.quote_or_transcript_excerpt}</blockquote>
            )}
            {e.explanation && <p className="finding-explanation">{e.explanation}</p>}
          </article>
        );
      })}
    </section>
  );
}
