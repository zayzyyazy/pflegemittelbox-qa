import { useEffect, useRef, useState } from 'react';
import type { Database } from '../../services/storageService';
import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { cleanCallIdFromFilename, id } from '../../utils/text';
import { findDuplicate } from '../../services/duplicateService';
import { generateCallDraft, transcribeAudioDetailed } from '../../services/openaiService';
import { upsertCall } from '../../services/callsService';
import { replaceEvidenceForCall } from '../../services/evidenceService';
import { attachAudioToCall } from '../../services/audioStorageService';
import { finalizeDatabaseState } from '../../services/issuePatternService';
import { Modal } from '../ui/Modal';
import { BatchReviewModal } from './BatchReviewModal';

type Status =
  | 'queued'
  | 'transcribing'
  | 'transcript_ready'
  | 'drafting'
  | 'ready_for_review'
  | 'saved'
  | 'failed'
  | 'duplicate_possible';

interface Row {
  id: string;
  file: File;
  status: Status;
  transcript?: string;
  draft?: Partial<CallReview>;
  draftEvidence?: EvidenceMoment[];
  error?: string;
}

export function BatchTranscribe({ db, setDb }: { db: Database; setDb: (db: Database) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [reviewRowId, setReviewRowId] = useState<string | null>(null);
  const [transcriptRowId, setTranscriptRowId] = useState<string | null>(null);
  const rowsRef = useRef(rows);
  const pausedRef = useRef(paused);
  const dbRef = useRef(db);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const update = (rid: string, patch: Partial<Row>) =>
    setRows(r => r.map(x => (x.id === rid ? { ...x, ...patch } : x)));

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    setRows(r => [
      ...r,
      ...Array.from(files).map(file => ({ id: id('row'), file, status: 'queued' as Status }))
    ]);
  };

  async function processRow(rowId: string) {
    const row = rowsRef.current.find(r => r.id === rowId);
    if (!row || !['queued', 'failed'].includes(row.status)) return;

    try {
      update(rowId, { status: 'transcribing', error: undefined });
      const callId = id('call');
      const audioFields = await attachAudioToCall(callId, row.file);

      const transcribed = await transcribeAudioDetailed(dbRef.current.settings, row.file);
      update(rowId, { status: 'transcript_ready', transcript: transcribed.text });

      if (pausedRef.current) return;

      update(rowId, { status: 'drafting' });
      const { call, evidence } = await generateCallDraft(dbRef.current.settings, {
        transcript: transcribed.text,
        transcriptSegments: transcribed.segments,
        file: row.file,
        analysisSettings: dbRef.current.settings,
        existingCallId: callId
      });

      const mergedCall: Partial<CallReview> = {
        ...call,
        ...audioFields,
        id: callId,
        call_id: call.call_id || cleanCallIdFromFilename(row.file.name),
        transcript: transcribed.text,
        transcript_segments: transcribed.segments,
        transcript_words: transcribed.words,
        transcription_model: transcribed.transcription_model
      };
      const dup = findDuplicate(mergedCall as CallReview, dbRef.current.calls);

      update(rowId, {
        status: dup ? 'duplicate_possible' : 'ready_for_review',
        draft: mergedCall,
        draftEvidence: evidence,
        error: dup ? 'Possible duplicate — review before saving' : undefined
      });
    } catch (e: unknown) {
      update(rowId, {
        status: 'failed',
        error: e instanceof Error ? e.message : 'Failed'
      });
    }
  }

  async function start() {
    setPaused(false);
    pausedRef.current = false;
    setRunning(true);
    const queue = rowsRef.current.filter(r => ['queued', 'failed'].includes(r.status));
    for (const row of queue) {
      if (pausedRef.current) break;
      await processRow(row.id);
    }
    setRunning(false);
  }

  const save = (row: Row) => {
    if (!row.draft?.id) return;
    const call = row.draft as CallReview;
    const evidence = (row.draftEvidence || []).map(e => ({ ...e, call_id: call.id }));
    const withCall = upsertCall(dbRef.current, call);
    setDb(
      finalizeDatabaseState(
        evidence.length ? replaceEvidenceForCall(withCall, call.id, evidence) : withCall
      )
    );
    dbRef.current = evidence.length
      ? replaceEvidenceForCall(withCall, call.id, evidence)
      : withCall;
    update(row.id, { status: 'saved' });
    if (reviewRowId === row.id) setReviewRowId(null);
  };

  const reviewRow = reviewRowId ? rows.find(r => r.id === reviewRowId) : null;
  const transcriptRow = transcriptRowId ? rows.find(r => r.id === transcriptRowId) : null;

  return (
    <div className="panel batch-panel">
      <h3>Batch Transcribe</h3>
      <p className="muted">Files process sequentially. A failed file will not stop the queue.</p>

      <div className="drop batch-drop">
        <input
          type="file"
          multiple
          accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
          onChange={e => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
        <span>Drop or choose multiple audio files</span>
      </div>

      <div className="row wrap batch-actions">
        <button type="button" className="primary" disabled={running || !rows.length} onClick={start}>
          {running ? 'Processing…' : 'Start batch'}
        </button>
        <button type="button" disabled={!running} onClick={() => { setPaused(true); pausedRef.current = true; }}>
          Pause after current
        </button>
        <button
          type="button"
          disabled={!rows.some(r => r.status === 'ready_for_review' || r.status === 'duplicate_possible')}
          onClick={() => {
            rows
              .filter(r => (r.status === 'ready_for_review' || r.status === 'duplicate_possible') && r.draft)
              .forEach(save);
          }}
        >
          Save all ready
        </button>
        <button type="button" onClick={() => setRows(rows.filter(r => r.status !== 'saved'))}>
          Clear completed
        </button>
      </div>

      <div className="queue">
        {rows.map(r => {
          const canReview = !!r.draft && ['ready_for_review', 'duplicate_possible', 'saved'].includes(r.status);
          const canTranscript = !!r.transcript;
          return (
            <div className="queue-row-v2" key={r.id}>
              <div className="queue-row-main">
                <strong className="queue-filename">{r.file.name}</strong>
                <span className={`badge ${r.status === 'failed' ? 'red' : r.status === 'saved' ? 'green' : 'blue'}`}>
                  {r.status.replace(/_/g, ' ')}
                </span>
                {r.error && <span className="error queue-error">{r.error}</span>}
              </div>
              <div className="row wrap queue-row-actions">
                <button
                  type="button"
                  className="btn-sm"
                  disabled={!canTranscript}
                  onClick={() => setTranscriptRowId(r.id)}
                >
                  View transcript
                </button>
                <button
                  type="button"
                  className="btn-sm primary-soft"
                  disabled={!canReview}
                  onClick={() => setReviewRowId(r.id)}
                >
                  Review draft
                </button>
                <button type="button" className="btn-sm" disabled={!r.draft} onClick={() => save(r)}>
                  Save call
                </button>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => update(r.id, { status: 'queued', error: undefined })}
                >
                  Retry
                </button>
                <button type="button" className="btn-sm" onClick={() => setRows(rows.filter(x => x.id !== r.id))}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        {!rows.length && <p className="muted">Add audio files to start batch processing.</p>}
      </div>

      {reviewRow?.draft && (
        <BatchReviewModal
          fileName={reviewRow.file.name}
          draft={reviewRow.draft}
          draftEvidence={reviewRow.draftEvidence || []}
          transcript={reviewRow.transcript}
          onClose={() => setReviewRowId(null)}
          onSave={() => save(reviewRow)}
        />
      )}

      {transcriptRow && (
        <Modal title={`Transcript · ${transcriptRow.file.name}`} onClose={() => setTranscriptRowId(null)} wide stacked>
          <pre className="transcript tall">{transcriptRow.transcript || 'No transcript yet.'}</pre>
          <div className="row end">
            <button type="button" onClick={() => setTranscriptRowId(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
