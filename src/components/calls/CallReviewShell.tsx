import { useEffect, useMemo, useState } from 'react';
import type { Database } from '../../services/storageService';
import type { CallReview, TranscriptSegment } from '../../types/CallReview';
import type { DraftCall } from '../../types/DraftCall';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { callerRequestLabels } from '../../utils/anliegen';
import { deriveMainIssue } from '../../utils/issueLabels';
import { formatFriction } from '../../utils/friction';
import { shortCallId, id } from '../../utils/text';
import { findDuplicate } from '../../services/duplicateService';
import { acceptDraft, removeDraft, updateDraft } from '../../services/draftService';
import { upsertCall, deleteCallWithAudio } from '../../services/callsService';
import { toggleCallFlag } from '../../services/callTriageService';
import { reanalyzeCall } from '../../services/openaiService';
import { replaceEvidenceForCall, upsertEvidence } from '../../services/evidenceService';
import { finalizeDatabaseState } from '../../services/issuePatternService';
import { nowIso } from '../../utils/dates';
import { resolveEvidenceForSave } from '../../utils/evidenceReview';
import { inferEvidenceMetadata } from '../../utils/inferEvidence';
import type { mergeSegmentSelection } from '../../utils/transcriptContext';
import { buildReviewObject } from '../../utils/reviewObject';
import { safeStringify } from '../../utils/safeJson';
import { CallAudioPlayer } from './CallAudioPlayer';
import { TranscriptReviewPanel } from './TranscriptReviewPanel';
import { TranscriptSelectionToolbar } from './TranscriptSelectionToolbar';
import { LeapingTranscriptEvents } from './LeapingTranscriptEvents';
import { ConfirmDeleteModal } from '../ui/ConfirmDeleteModal';
import { FindingsStrip } from './FindingsStrip';
import { FlagIssueModal } from './FlagIssueModal';
import { LightweightEvidenceModal } from './LightweightEvidenceModal';

function buildSegments(call: Partial<CallReview>, draftTranscript?: string): TranscriptSegment[] {
  if (call.transcript_segments?.length) return call.transcript_segments;
  const text = call.transcript || draftTranscript || '';
  if (!text.trim()) return [];
  return text.split('\n').filter(Boolean).map((line, i) => {
    const callerMatch = /^caller:\s*/i.test(line);
    const agentMatch = /^agent:\s*/i.test(line);
    return {
      start: i,
      end: i + 1,
      text: line.replace(/^(caller|agent):\s*/i, '').trim() || line,
      speaker: callerMatch ? 'caller' as const : agentMatch ? 'agent' as const : 'unknown' as const
    };
  });
}

export function CallReviewShell({
  db,
  setDb,
  onClose,
  draft,
  call: savedCall,
  evidence: savedEvidence = [],
  initialEvidenceId,
  onSaved,
  onSaveAndNext,
  hasNextDraft,
  mode = 'page'
}: {
  db: Database;
  setDb: (db: Database) => void;
  onClose: () => void;
  draft?: DraftCall;
  call?: CallReview;
  evidence?: EvidenceMoment[];
  initialEvidenceId?: string;
  onSaved?: (call?: Partial<CallReview>) => void;
  onSaveAndNext?: () => void;
  hasNextDraft?: boolean;
  mode?: 'page' | 'modal';
}) {
  const isDraft = !!draft;
  const liveSaved = savedCall ? db.calls.find(c => c.id === savedCall.id) || savedCall : undefined;
  const [call, setCall] = useState<Partial<CallReview>>(() =>
    draft ? { ...draft.call } : { ...savedCall! }
  );
  const [note, setNote] = useState(call.reviewer_call_notes || '');
  const [advanced, setAdvanced] = useState(false);
  const [seekSeconds, setSeekSeconds] = useState<number>();
  const [dup, setDup] = useState<{ call: CallReview; reason: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [highlightedEvidenceId, setHighlightedEvidenceId] = useState(initialEvidenceId);
  const [draftEvidence, setDraftEvidence] = useState<Partial<EvidenceMoment>[]>(() =>
    isDraft ? [...(draft!.evidence || [])] : []
  );
  const [transcriptRange, setTranscriptRange] = useState<ReturnType<typeof mergeSegmentSelection> | null>(null);
  const [highlightDraft, setHighlightDraft] = useState<EvidenceMoment | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);

  const evidence = (isDraft ? draftEvidence : savedEvidence) as EvidenceMoment[];
  const mainIssue = deriveMainIssue(call as CallReview, evidence as EvidenceMoment[]);
  const friction = formatFriction(call as CallReview, evidence as EvidenceMoment[]);
  const segments = useMemo(() => buildSegments(call, draft?.transcript), [call, draft?.transcript]);
  const callId = call.id || savedCall?.id || draft?.call.id || '';
  const title = isDraft
    ? `Review · ${draft!.file_name}`
    : shortCallId((savedCall || call).call_id || '');
  const hasStoredAudio = !!(
    call.audio_local_path ||
    call.audio_storage_key ||
    savedCall?.audio_local_path ||
    savedCall?.audio_storage_key
  );
  const reviewObject = call.review_object || savedCall?.review_object;

  const update = (patch: Partial<CallReview>) => setCall(c => ({ ...c, ...patch }));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (isDraft) save(false);
        else persistSavedCall();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDraft, call, note, savedCall]);

  useEffect(() => {
    if (!highlightedEvidenceId) return;
    const finding = evidence.find(e => e.id === highlightedEvidenceId);
    const t = finding?.timestamp_start_seconds;
    if (t != null) {
      const el = document.getElementById(`seg-${Math.round(t)}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedEvidenceId, evidence]);

  function selectFinding(evId: string) {
    setHighlightedEvidenceId(evId);
  }

  function patchEvidence(evId: string, patch: Partial<EvidenceMoment>) {
    if (isDraft) {
      setDraftEvidence(prev => prev.map(e => (e.id === evId ? { ...e, ...patch } : e)));
      return;
    }
    const ev = db.evidence.find(e => e.id === evId);
    if (!ev) return;
    setDb(upsertEvidence(db, { ...ev, ...patch, updated_at: nowIso() }));
  }

  function confirmEvidence(evId: string) {
    patchEvidence(evId, { reviewer_status: 'confirmed' });
  }

  function dismissEvidence(evId: string) {
    patchEvidence(evId, { reviewer_status: 'dismissed' });
  }

  function openCreateEvidence(range: ReturnType<typeof mergeSegmentSelection>) {
    const now = nowIso();
    setHighlightDraft({
      id: id('ev'),
      call_id: callId,
      speaker: range.speaker,
      moment_type: 'manual_highlight',
      severity: 'medium',
      timestamp_start_seconds: range.start,
      timestamp_end_seconds: range.end,
      quote_or_transcript_excerpt: range.text.slice(0, 280),
      segment_starts: range.indices.map(i => segments[i]?.start).filter((n): n is number => n != null),
      explanation: '',
      recommended_fix: '',
      voice_cue_notes: '',
      source: 'manual',
      reviewer_status: 'confirmed',
      created_at: now,
      updated_at: now
    });
  }

  function saveReviewerEvidence(label: string, noteText: string) {
    if (!highlightDraft) return;
    const inferred = inferEvidenceMetadata(
      { ...highlightDraft, reviewer_label: label, reviewer_note: noteText },
      call
    );
    const moment: EvidenceMoment = {
      ...highlightDraft,
      ...inferred,
      reviewer_label: label,
      reviewer_note: noteText,
      explanation: noteText || inferred.explanation || label,
      source: 'manual',
      reviewer_status: 'confirmed',
      updated_at: nowIso()
    } as EvidenceMoment;

    if (isDraft) {
      setDraftEvidence(prev => [...prev, moment]);
    } else {
      setDb(upsertEvidence(db, moment));
    }
    setHighlightedEvidenceId(moment.id);
    setHighlightDraft(null);
    setTranscriptRange(null);
  }

  function rejectDraft() {
    if (!draft) return;
    setDb(removeDraft(db, draft.id));
    onClose();
  }

  function evidenceForSave() {
    return resolveEvidenceForSave(evidence).map(e => ({
      ...e,
      call_id: callId
    })) as EvidenceMoment[];
  }

  function save(anyway = false, andNext = false) {
    if (!draft) return;
    const full = { ...call, reviewer_call_notes: note } as CallReview;
    const match = findDuplicate(full, db.calls.filter(c => c.id !== full.id));
    if (match && !anyway) {
      setDup(match);
      return;
    }
    setDb(acceptDraft(db, { ...draft, call: full, evidence: evidenceForSave() }, full));
    if (andNext && onSaveAndNext) onSaveAndNext();
    else {
      onSaved?.(full);
      onClose();
    }
  }

  function persistSavedCall() {
    if (!savedCall) return;
    const linked = call.linked_issue_ids || savedCall.linked_issue_ids || [];
    setDb(
      upsertCall(db, {
        ...savedCall,
        ...call,
        reviewer_call_notes: note,
        review_status: linked.length ? 'flagged' : 'reviewed',
        updated_at: nowIso()
      } as CallReview)
    );
    onClose();
  }

  function generateDebugReviewObject() {
    const nextReviewObject = buildReviewObject({
      call,
      evidence
    });
    update({ review_object: nextReviewObject });
    if (savedCall) {
      setDb(
        upsertCall(db, {
          ...savedCall,
          ...call,
          review_object: nextReviewObject,
          updated_at: nowIso()
        } as CallReview)
      );
    }
    if (import.meta.env.DEV) {
      console.info('[review_object:debug]', call.call_id || call.id, nextReviewObject);
    }
  }

  function handleIssueLinked(issueId: string) {
    const linked = Array.from(new Set([...(call.linked_issue_ids || []), issueId]));
    update({ linked_issue_ids: linked, review_status: 'flagged' });
    if (!isDraft && savedCall) {
      setDb(
        upsertCall(db, {
          ...savedCall,
          ...call,
          linked_issue_ids: linked,
          review_status: 'flagged',
          updated_at: nowIso()
        } as CallReview)
      );
    }
  }

  async function runReanalyze() {
    if (!savedCall) return;
    setReanalyzing(true);
    try {
      const manual = savedEvidence.filter(e => e.source === 'manual' || !e.source);
      const { call: nextCall, evidence: nextEvidence } = await reanalyzeCall(db.settings, savedCall, manual);
      setDb(finalizeDatabaseState(replaceEvidenceForCall(upsertCall(db, nextCall), savedCall.id, nextEvidence)));
      setCall(nextCall);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Re-analysis failed');
    } finally {
      setReanalyzing(false);
    }
  }

  const shell = (
    <div className="call-review-shell">
      <div className="call-review-sticky-bar row between wrap">
        <div className="row wrap call-review-actions-primary">
          {mode === 'page' && (
            <button type="button" className="btn-sm" onClick={onClose}>
              ← Back
            </button>
          )}
          {isDraft ? (
            <>
              <button type="button" className="primary" onClick={() => save(false)}>
                Save call
              </button>
              {hasNextDraft && (
                <button type="button" className="primary-soft" onClick={() => save(false, true)}>
                  Save &amp; next
                </button>
              )}
            </>
          ) : (
            <button type="button" className="primary" onClick={persistSavedCall}>
              Done
            </button>
          )}
        </div>
        <div className="row wrap call-review-actions-secondary">
          {!isDraft && (
            <button
              type="button"
              className={liveSaved?.pinned ? 'primary-soft' : 'btn-sm'}
              onClick={() => liveSaved && setDb(toggleCallFlag(db, liveSaved.id, 'pinned'))}
            >
              {liveSaved?.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          <button type="button" className="btn-sm primary-soft" onClick={() => setFlagOpen(true)}>
            Flag issue
          </button>
          {!isDraft && hasStoredAudio && (
            <button type="button" className="btn-sm" disabled={reanalyzing} onClick={runReanalyze}>
              {reanalyzing ? 'Re-scoring…' : 'Re-score call'}
            </button>
          )}
        </div>
        <div className="row wrap call-review-actions-destructive">
          {isDraft ? (
            <button type="button" className="btn-danger-soft" onClick={rejectDraft}>
              Reject
            </button>
          ) : (
            <button type="button" className="btn-danger-soft" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="call-review-grid">
        <div className="call-review-main">
          <CallAudioPlayer call={call} seekSeconds={seekSeconds} />
          {call.recording_url && (
            <div className="audio-heard-panel">
              <a className="buttonlike btn-sm" href={call.recording_url} target="_blank" rel="noreferrer">
                Open Leaping recording
              </a>
              <p className="muted">Leaping recording URL may require Leaping authentication.</p>
            </div>
          )}

          {(call.customer_name || call.vnr || call.phone || call.email || call.birthday) && (
            <div className="call-meta-row row wrap">
              {call.customer_name && <span className="badge gray">Kunde: {call.customer_name}</span>}
              {call.vnr && <span className="badge gray">VNR: {call.vnr}</span>}
              {call.phone && <span className="badge gray">Phone: {call.phone}</span>}
              {call.email && <span className="badge gray">Email: {call.email}</span>}
              {call.birthday && <span className="badge gray">Birthday: {call.birthday}</span>}
            </div>
          )}

          <p className="call-friction-line">
            <strong>Friction:</strong> {friction}
          </p>
          <p className="muted call-review-hint">
            {isDraft ? '⌘↵ save · click a finding to jump transcript' : '⌘↵ done · click a finding to jump transcript'}
          </p>

          <div className="call-review-fields row wrap">
            <Field label="Anliegen">
              <select
                value={call.anliegen || 'other'}
                onChange={e => update({ anliegen: e.target.value as CallReview['anliegen'] })}
              >
                {Object.entries(callerRequestLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Result">
              <select
                value={call.solved_status || 'partially'}
                onChange={e => update({ solved_status: e.target.value as CallReview['solved_status'] })}
              >
                <option value="yes">yes</option>
                <option value="partially">partially</option>
                <option value="no">no</option>
              </select>
            </Field>
            <Field label="Note">
              <input
                className="call-review-note-input"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional one-line note…"
              />
            </Field>
          </div>

          {call.call_summary && (
            <p className="call-review-summary muted">{call.call_summary}</p>
          )}

          <FindingsStrip
            call={call}
            evidence={evidence}
            onConfirm={confirmEvidence}
            onDismiss={dismissEvidence}
            onJumpToTime={s => setSeekSeconds(s + 0.01)}
            onSelectFinding={selectFinding}
            selectedFindingId={highlightedEvidenceId}
          />

          {isDraft && draft?.duplicate_warning && (
            <p className="error">Possible duplicate — confirm before saving.</p>
          )}

          <button type="button" className="btn-text" onClick={() => setAdvanced(v => !v)}>
            {advanced ? 'Hide advanced' : 'Advanced fields'}
          </button>
          {advanced && (
            <section className="call-review-advanced form-grid">
              <Field label="Call ID">
                <input value={call.call_id || ''} onChange={e => update({ call_id: e.target.value })} />
              </Field>
              <Field label="Rating">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={call.overall_rating ?? 5}
                  onChange={e => update({ overall_rating: Number(e.target.value) })}
                />
              </Field>
              <Field label="Main issue">
                <input
                  value={call.primary_issue_label || mainIssue}
                  onChange={e => update({ primary_issue_label: e.target.value as CallReview['primary_issue_label'] })}
                />
              </Field>
              <Field label="Bot version">
                <select
                  value={call.bot_version || 'production'}
                  onChange={e => update({ bot_version: e.target.value as CallReview['bot_version'] })}
                >
                  <option value="production">production</option>
                  <option value="experimental">experimental</option>
                </select>
              </Field>
              {(call.leaping_call_id || call.function_calls?.length || call.transitions?.length || call.raw_metadata) && (
                <div className="debug-review-object">
                  <div className="row between wrap">
                    <div>
                      <strong>Leaping data</strong>
                      <p className="muted">
                        {[
                          call.marie_call_status || call.leaping_status,
                          call.marie_main_result,
                          call.leaping_snapshot_id && `snapshot ${call.leaping_snapshot_id}`
                        ].filter(Boolean).join(' · ') || 'Imported Leaping payload'}
                      </p>
                    </div>
                    <div className="row wrap">
                      {call.recording_url && <a className="buttonlike btn-sm" href={call.recording_url} target="_blank" rel="noreferrer">Recording</a>}
                      {call.leaping_detail_url && <a className="buttonlike btn-sm" href={call.leaping_detail_url} target="_blank" rel="noreferrer">Leaping detail</a>}
                    </div>
                  </div>
                  <pre className="debug-json">
                    {safeStringify(
                      {
                        leaping_call_id: call.leaping_call_id,
                        customer: {
                          phone: call.phone,
                          name: call.customer_name,
                          vnr: call.vnr,
                          email: call.email,
                          birthday: call.birthday
                        },
                        function_calls: call.function_calls,
                        transitions: call.transitions,
                        raw_metadata: call.raw_metadata
                      }
                    )}
                  </pre>
                  <LeapingTranscriptEvents events={call.leaping_transcript_events} />
                </div>
              )}
              <div className="debug-review-object">
                <div className="row between wrap">
                  <div>
                    <strong>Review object</strong>
                    <p className="muted">
                      {reviewObject
                        ? `${reviewObject.candidate_findings.length} candidates · ${reviewObject.verified_findings.length} verified · ${reviewObject.action_items.length} actions`
                        : 'Not generated for this call yet.'}
                    </p>
                  </div>
                  <button type="button" className="btn-sm" onClick={generateDebugReviewObject}>
                    Generate debug object
                  </button>
                </div>
                {reviewObject && (
                  <pre className="debug-json">
                    {safeStringify(
                      {
                        status: reviewObject.pipeline_status,
                        agents: Object.fromEntries(
                          Object.entries(reviewObject.agents).map(([key, value]) => [
                            key,
                            {
                              status: value.status,
                              findings: value.findings.length,
                              confidence: value.confidence
                            }
                          ])
                        ),
                        dashboard_signals: reviewObject.dashboard_signals
                      }
                    )}
                  </pre>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="call-review-transcript">
          <h3>Transcript</h3>
          <p className="muted transcript-hint">Click or drag lines to highlight and create evidence.</p>
          {transcriptRange && !highlightDraft && (
            <TranscriptSelectionToolbar
              quote={transcriptRange.text}
              lineCount={transcriptRange.indices.length}
              onCreateEvidence={() => openCreateEvidence(transcriptRange)}
              onClear={() => setTranscriptRange(null)}
            />
          )}
          <TranscriptReviewPanel
            segments={segments}
            filteredSegments={segments}
            evidence={evidence as EvidenceMoment[]}
            highlightedEvidenceId={highlightedEvidenceId}
            onSelectRange={range => setTranscriptRange(range.text.length >= 3 ? range : null)}
            onScrollToEvidence={setHighlightedEvidenceId}
            onJumpToTime={s => setSeekSeconds(s + 0.01)}
          />
        </div>
      </div>

      {dup && (
        <div className="duplicate">
          <p>Duplicate: {dup.call.call_id} ({dup.reason})</p>
          <button type="button" onClick={() => save(true)}>Save anyway</button>
          <button type="button" onClick={() => setDup(null)}>Cancel</button>
        </div>
      )}
    </div>
  );

  const overlays = (
    <>
      {highlightDraft && (
        <LightweightEvidenceModal
          draft={highlightDraft}
          segmentCount={transcriptRange?.indices.length || 1}
          onCancel={() => setHighlightDraft(null)}
          onSave={saveReviewerEvidence}
        />
      )}

      {flagOpen && callId && (
        <FlagIssueModal
          db={db}
          setDb={setDb}
          callId={callId}
          onClose={() => setFlagOpen(false)}
          onLinked={handleIssueLinked}
        />
      )}

      {confirmDelete && savedCall && (
        <ConfirmDeleteModal
          title="Delete call review?"
          description="Permanently removes this call and all evidence from local storage."
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setDb(await deleteCallWithAudio(db, savedCall.id));
            setConfirmDelete(false);
            onClose();
          }}
        />
      )}
    </>
  );

  if (mode === 'page') {
    return (
      <main className="page call-review-page content">
        <div className="call-review-page-head">
          <h1>{title}</h1>
        </div>
        {shell}
        {overlays}
      </main>
    );
  }

  return (
    <>
      <Modal title={title} onClose={onClose} wide stacked>
        {shell}
      </Modal>
      {overlays}
    </>
  );
}
