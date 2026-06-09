import { useCallback, useRef, useState } from 'react';
import type { TranscriptSegment } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { evidenceBySegment } from '../../utils/evidenceTranscript';
import { mergeSegmentSelection } from '../../utils/transcriptContext';
import { secondsToClock } from '../../utils/dates';

function speakerLabel(speaker?: TranscriptSegment['speaker']) {
  if (speaker === 'agent') return 'Marie';
  if (speaker === 'caller') return 'Caller';
  return null;
}

export function TranscriptReviewPanel({
  segments,
  filteredSegments,
  evidence,
  highlightedEvidenceId,
  onSelectRange,
  onScrollToEvidence,
  onJumpToTime,
  readOnly = false
}: {
  segments: TranscriptSegment[];
  filteredSegments: TranscriptSegment[];
  evidence: EvidenceMoment[];
  highlightedEvidenceId?: string;
  onSelectRange?: (merged: ReturnType<typeof mergeSegmentSelection>) => void;
  onScrollToEvidence?: (id: string) => void;
  onJumpToTime: (seconds: number) => void;
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const dragRef = useRef(false);
  const dragStart = useRef<number | null>(null);

  const indexOf = useCallback(
    (segment: TranscriptSegment) => segments.findIndex(s => s.start === segment.start && s.text === segment.text),
    [segments]
  );

  function applyRange(indices: number[]) {
    if (readOnly || !onSelectRange) return;
    const merged = mergeSegmentSelection(segments, indices);
    if (merged.text.length >= 3) onSelectRange(merged);
  }

  function toggleIndex(idx: number, extend: boolean) {
    if (readOnly) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (extend && anchor != null) {
        const lo = Math.min(anchor, idx);
        const hi = Math.max(anchor, idx);
        for (let i = lo; i <= hi; i++) next.add(i);
        applyRange([...next]);
        return next;
      }
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      setAnchor(idx);
      applyRange([...next]);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setAnchor(null);
    dragRef.current = false;
    dragStart.current = null;
  }

  function handleRowMouseDown(idx: number, e: React.MouseEvent) {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = true;
    dragStart.current = idx;
    if (e.shiftKey && anchor != null) {
      toggleIndex(idx, true);
      return;
    }
    const next = new Set<number>([idx]);
    setSelected(next);
    setAnchor(idx);
    applyRange([idx]);
  }

  function handleRowMouseEnter(idx: number) {
    if (readOnly || !dragRef.current || dragStart.current == null) return;
    const lo = Math.min(dragStart.current, idx);
    const hi = Math.max(dragStart.current, idx);
    const next = new Set<number>();
    for (let i = lo; i <= hi; i++) next.add(i);
    setSelected(next);
    applyRange([...next]);
  }

  function handleMouseUp() {
    dragRef.current = false;
  }

  return (
    <div className="transcript-panel-body" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      {filteredSegments.length ? (
        <div className="segment-list tall">
          {filteredSegments.map((segment, visIndex) => {
            const idx = indexOf(segment);
            const isSelected = idx >= 0 && selected.has(idx);
            const linked = evidenceBySegment(segment, evidence);
            const active = linked.some(e => e.id === highlightedEvidenceId);
            const label = speakerLabel(segment.speaker);
            return (
              <div
                id={`seg-${Math.round(segment.start)}`}
                className={[
                  'segment-row',
                  linked.length ? 'has-evidence' : '',
                  active ? ' highlighted' : '',
                  isSelected ? ' segment-selected' : '',
                  readOnly ? ' segment-readonly' : ''
                ].join('')}
                key={`${segment.start}-${visIndex}`}
                onMouseDown={e => idx >= 0 && handleRowMouseDown(idx, e)}
                onMouseEnter={() => idx >= 0 && handleRowMouseEnter(idx)}
              >
                <time
                  className="segment-time-btn"
                  role="button"
                  tabIndex={0}
                  onClick={e => {
                    e.stopPropagation();
                    onJumpToTime(segment.start);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onJumpToTime(segment.start);
                    }
                  }}
                >
                  {secondsToClock(segment.start)}
                </time>
                <div className="segment-main">
                  {label && <span className={`speaker-badge speaker-${segment.speaker}`}>{label}</span>}
                  <span>{segment.text}</span>
                  {linked.length > 0 && onScrollToEvidence && (
                    <div className="segment-evidence-badges">
                      {linked.map(e => (
                        <button
                          type="button"
                          key={e.id}
                          className={`evidence-seg-badge${e.source === 'ai' || e.source === 'ai_suggested' ? ' ai-suggested' : ''}`}
                          onClick={ev => {
                            ev.stopPropagation();
                            onScrollToEvidence(e.id);
                          }}
                        >
                          {e.reviewer_label || e.moment_type.replace(/_/g, ' ')}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={e => {
                      e.stopPropagation();
                      if (idx >= 0) {
                        setSelected(new Set([idx]));
                        setAnchor(idx);
                        applyRange([idx]);
                      }
                    }}
                  >
                    Select
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">No transcript segments.</p>
      )}
      {!readOnly && selected.size > 0 && (
        <div className="selection-footer row wrap">
          <span className="muted">{selected.size} line(s) selected</span>
          <button type="button" className="btn-sm" onClick={clearSelection}>
            Deselect
          </button>
        </div>
      )}
    </div>
  );
}
