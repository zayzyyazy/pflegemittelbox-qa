import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { secondsToClock } from '../../utils/dates';
import { getEvidenceReviewStatus, isAiSuggested } from '../../utils/evidenceReview';

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
  const visible = evidence.filter(e => getEvidenceReviewStatus(e) !== 'dismissed');
  const riskHints = call.ai_risk_hints?.trim();
  const cappedHints = riskHints
    ? riskHints.split(/\n+/).map(l => l.trim()).filter(Boolean).slice(0, 2).join('\n')
    : '';
  const moments = call.ai_moments_of_interest?.trim();
  const structuredCount = visible.length;

  return (
    <section className="findings-strip panel">
      <h3>Findings {structuredCount > 0 && <span className="muted">({structuredCount})</span>}</h3>

      {cappedHints && (
        <div className="finding-hint-block">
          <span className="badge yellow">AI risk hints</span>
          <p>{cappedHints}</p>
        </div>
      )}

      {moments && (
        <div className="finding-hint-block">
          <span className="badge blue">Worth a look</span>
          <p>{moments}</p>
        </div>
      )}

      {structuredCount === 0 && !cappedHints && !moments && (
        <p className="findings-ok muted">No structured findings yet — confirm AI suggestions or highlight transcript text.</p>
      )}

      {visible.map(e => {
        const status = getEvidenceReviewStatus(e);
        const evId = e.id || '';
        const selected = selectedFindingId === evId;
        return (
          <article
            className={`finding-row${status === 'confirmed' ? ' confirmed' : ''}${isAiSuggested(e) ? ' ai-suggested' : ''}${selected ? ' selected' : ''}`}
            key={evId || e.quote_or_transcript_excerpt}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (evId) onSelectFinding?.(evId);
              if (e.timestamp_start_seconds != null) onJumpToTime?.(e.timestamp_start_seconds);
            }}
            onKeyDown={ev => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                if (evId) onSelectFinding?.(evId);
                if (e.timestamp_start_seconds != null) onJumpToTime?.(e.timestamp_start_seconds);
              }
            }}
          >
            <div className="row between wrap">
              <div className="row wrap">
                {e.source === 'audio_listener' && <span className="badge purple">Heard</span>}
                {e.source === 'ai_suggested' && <span className="badge yellow">AI suggested</span>}
                {e.source === 'manual' && <span className="badge blue">Reviewer</span>}
                {e.source === 'ai' && <span className="badge gray">Read</span>}
                <span className="badge gray">{e.moment_type?.replace(/_/g, ' ') || 'finding'}</span>
                {e.timestamp_start_seconds != null && (
                  <span className="finding-time">{secondsToClock(e.timestamp_start_seconds)}</span>
                )}
              </div>
              {status === 'pending' && evId && (
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
            <blockquote className="finding-quote">{e.quote_or_transcript_excerpt}</blockquote>
            {e.voice_cue_notes && e.source === 'audio_listener' && (
              <p className="finding-audio-heard"><strong>Audio heard:</strong> {e.voice_cue_notes}</p>
            )}
            {e.explanation && <p className="muted finding-explanation">{e.explanation}</p>}
          </article>
        );
      })}
    </section>
  );
}
