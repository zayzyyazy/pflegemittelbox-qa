import { useState } from 'react';
import type { Database } from '../../services/storageService';
import type { CallReview } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { callerRequestLabels } from '../../utils/anliegen';
import { findDuplicate } from '../../services/duplicateService';
import { upsertCall } from '../../services/callsService';
import { replaceEvidenceForCall } from '../../services/evidenceService';
import { finalizeDatabaseState } from '../../services/issuePatternService';
import { generateCallDraft, transcribeAudioDetailed } from '../../services/openaiService';
import { analysisOrchestrator } from '../../services/analysisOrchestrator';
import { attachAudioToCall } from '../../services/audioStorageService';
import { nowIso } from '../../utils/dates';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { id, cleanCallIdFromFilename } from '../../utils/text';

const blank = (): Partial<CallReview> => ({
  call_id: '',
  date: new Date().toISOString().slice(0, 10),
  duration_seconds: 0,
  customer_type: '',
  caller_context: '',
  anliegen: 'order_status',
  solved_status: 'no',
  overall_rating: 5,
  naturalness_rating: 5,
  caller_cut_off: false,
  awkward_pauses: false,
  robotic_pacing: false,
  latency_too_long: false,
  repeated_question: false,
  identification_problem: false,
  missing_integration: false,
  workflow_node: '',
  root_cause_category: 'Other',
  breakpoint_notes: '',
  suggested_improvement: '',
  reviewer_notes: '',
  call_summary: '',
  transcript: '',
  audio_file_name: '',
  audio_file_size: 0,
  audio_file_type: '',
  audio_file_last_modified: 0,
  linked_issue_ids: []
});

function finalizeCall(form: Partial<CallReview>): CallReview {
  const now = nowIso();
  return {
    ...blank(),
    ...form,
    id: form.id || id('call'),
    call_id: form.call_id || (form.audio_file_name ? cleanCallIdFromFilename(form.audio_file_name) : id('callid')),
    created_at: form.created_at || now,
    updated_at: now
  } as CallReview;
}

function saveCallWithEvidence(db: Database, call: CallReview, evidence: EvidenceMoment[]) {
  return finalizeDatabaseState(replaceEvidenceForCall(upsertCall(db, call), call.id, evidence));
}

export function AddCallModal({
  db,
  setDb,
  onClose,
  workspace = 'production',
  defaultBotVersion = 'production'
}: {
  db: Database;
  setDb: (db: Database) => void;
  onClose: () => void;
  workspace?: CallReview['workspace'];
  defaultBotVersion?: CallReview['bot_version'];
}) {
  const [tab, setTab] = useState<'manual' | 'paste' | 'audio'>('manual');
  const [form, setForm] = useState<Partial<CallReview>>({ ...blank(), workspace, bot_version: defaultBotVersion });
  const [review, setReview] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [ctx, setCtx] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState('');
  const [dup, setDup] = useState<any>(null);
  const [draftEvidence, setDraftEvidence] = useState<EvidenceMoment[]>([]);
  const [err, setErr] = useState('');
  const update = (p: Partial<CallReview>) => setForm(f => ({ ...f, ...p }));

  async function draftFromText() {
    setBusy('Generating draft');
    setErr('');
    try {
      const d = await generateCallDraft(db.settings, {
        reviewText: review,
        analysisSettings: db.settings,
        workspace,
        botVersion: defaultBotVersion
      });
      setForm({ ...blank(), ...d.call, id: d.call.id });
      setDraftEvidence(d.evidence);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Draft failed');
    } finally {
      setBusy('');
    }
  }

  async function doTranscribe() {
    if (!file) return;
    setBusy('Copying + transcribing');
    setErr('');
    try {
      const stableId = form.id || id('call');
      const audioFields = await attachAudioToCall(stableId, file);
      const result = await transcribeAudioDetailed(db.settings, file);
      setTranscript(result.text);
      update({
        id: stableId,
        ...audioFields,
        transcript: result.text,
        transcript_segments: result.segments,
        duration_seconds: result.duration_seconds || form.duration_seconds
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Transcription failed');
    } finally {
      setBusy('');
    }
  }

  async function draftFromTranscript() {
    if (!file) return;
    setBusy('Listening + analyzing');
    setErr('');
    try {
      const d = await analysisOrchestrator.analyzeCall({
        settings: db.settings,
        transcript,
        transcriptSegments: form.transcript_segments,
        audioFile: file,
        reviewerContext: ctx,
        existingCallId: form.id,
        workspace,
        botVersion: defaultBotVersion
      });
      setDraftEvidence(d.evidence);
      update({ ...blank(), ...d.call, ...form, id: d.call.id, transcript: d.call.transcript || transcript });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Draft failed');
    } finally {
      setBusy('');
    }
  }

  async function save(anyway = false) {
    let full = finalizeCall({ ...form, workspace: form.workspace || workspace, bot_version: form.bot_version || defaultBotVersion });
    const match = findDuplicate(full, db.calls);
    if (match && !anyway) {
      setDup(match);
      return;
    }
    if (file && !full.audio_local_path && !full.audio_storage_key) {
      const audioFields = await attachAudioToCall(full.id, file);
      full = { ...full, ...audioFields };
    }
    const evidence = draftEvidence.map(e => ({ ...e, call_id: full.id }));
    setDb(evidence.length ? saveCallWithEvidence(db, full, evidence) : upsertCall(db, full));
    onClose();
  }

  return (
    <Modal title="Add Call Review" onClose={onClose} wide>
      <div className="tabs">
        <button type="button" className={tab === 'manual' ? 'active' : ''} onClick={() => setTab('manual')}>Manual</button>
        <button type="button" className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>Paste review</button>
        <button type="button" className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}>Audio</button>
      </div>
      {tab === 'paste' && (
        <section className="panel inset">
          <textarea value={review} onChange={e => setReview(e.target.value)} placeholder="Paste review notes..." />
          <button type="button" className="primary" onClick={draftFromText}>{busy || 'Generate draft'}</button>
        </section>
      )}
      {tab === 'audio' && (
        <section className="panel inset">
          <div className="drop">
            <input type="file" accept="audio/*" onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); update({ audio_file_name: f.name, audio_file_size: f.size, audio_file_type: f.type, call_id: cleanCallIdFromFilename(f.name) }); } }} />
            <span>{file ? file.name : 'Drop audio or choose file'}</span>
          </div>
          <div className="row wrap">
            <button type="button" onClick={doTranscribe}>Copy + transcribe</button>
            <button type="button" onClick={draftFromTranscript} disabled={!transcript}>Listen + analyze</button>
          </div>
          <details open={!!transcript}><summary>Transcript</summary><pre className="transcript">{transcript}</pre></details>
        </section>
      )}
      <CallForm form={form} update={update} />
      {err && <p className="error">{err}</p>}
      {busy && <p className="muted">{busy}…</p>}
      <div className="row end"><button type="button" className="primary" onClick={() => save(false)}>Save call</button></div>
      {dup && (
        <div className="duplicate">
          <p>Duplicate: {dup.call.call_id}</p>
          <button type="button" onClick={() => save(true)}>Save anyway</button>
          <button type="button" onClick={() => setDup(null)}>Cancel</button>
        </div>
      )}
    </Modal>
  );
}

function CallForm({ form, update }: { form: Partial<CallReview>; update: (p: Partial<CallReview>) => void }) {
  return (
    <section className="form-grid">
      <Field label="Call ID"><input value={form.call_id || ''} onChange={e => update({ call_id: e.target.value })} /></Field>
      <Field label="Caller request">
        <select value={form.anliegen} onChange={e => update({ anliegen: e.target.value as CallReview['anliegen'] })}>
          {Object.entries(callerRequestLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Result">
        <select value={form.solved_status} onChange={e => update({ solved_status: e.target.value as CallReview['solved_status'] })}>
          <option value="yes">yes</option>
          <option value="partially">partially</option>
          <option value="no">no</option>
        </select>
      </Field>
      <Field label="Transcript"><textarea className="tall-textarea" value={form.transcript || ''} onChange={e => update({ transcript: e.target.value })} /></Field>
    </section>
  );
}
