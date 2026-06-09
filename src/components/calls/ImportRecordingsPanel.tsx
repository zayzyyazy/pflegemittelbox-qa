import { useEffect, useRef, useState } from 'react';
import type { Database } from '../../services/storageService';
import type { CallReview } from '../../types/CallReview';
import { id } from '../../utils/text';
import { upsertDraft } from '../../services/draftService';
import {
  filterRecordingFiles,
  processDraftRecording
} from '../../services/importRecordingsService';

export function ImportRecordingsPanel({
  db,
  setDb,
  onClose,
  workspace = 'production',
  defaultBotVersion = 'production'
}: {
  db: Database;
  setDb: (db: Database) => void;
  onClose?: () => void;
  workspace?: CallReview['workspace'];
  defaultBotVersion?: CallReview['bot_version'];
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const filesRef = useRef<Map<string, File>>(new Map());
  const dbRef = useRef(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    if (!dbRef.current.settings.openaiApiKey.trim()) {
      setStatus('Missing OpenAI API key — add it in Settings before importing.');
      return;
    }
    const accepted = filterRecordingFiles(files);
    if (!accepted.length) {
      setStatus('No supported audio files (wav, mp3, m4a).');
      return;
    }

    setBusy(true);
    setStatus(`Importing ${accepted.length} file(s)...`);

    const importBatchId = `batch-${Date.now()}`;
    let working = dbRef.current;
    const newDraftIds: string[] = [];

    for (const file of accepted) {
      const draftId = id('draft');
      const callId = id('call');
      filesRef.current.set(draftId, file);
      working = upsertDraft(working, {
        id: draftId,
        status: 'queued',
        file_name: file.name,
        processing_step: 'Queued',
        import_batch_id: importBatchId,
        call: { id: callId, call_id: file.name.replace(/\.[^.]+$/, ''), audio_file_name: file.name },
        evidence: []
      });
      newDraftIds.push(draftId);
    }

    setDb(working);

    for (const draftId of newDraftIds) {
      const file = filesRef.current.get(draftId);
      if (!file) continue;
      setStatus(`Processing ${file.name}...`);
      await processDraftRecording(
        dbRef.current,
        draftId,
        file,
        updated => {
          working = updated;
          dbRef.current = updated;
          setDb(updated);
        },
        { workspace, botVersion: defaultBotVersion }
      );
    }

    filesRef.current.clear();
    setBusy(false);
    setStatus(`Done — ${newDraftIds.length} draft(s) in Needs Review.`);
    onClose?.();
  }

  return (
    <section className="panel import-panel">
      <h3>Import new recordings</h3>
      <p className="muted">
        Select audio files or a folder. Each file is copied to app storage, transcribed, and analyzed as a draft for your review.
      </p>

      <div className="row wrap">
        <div className="drop batch-drop">
          <input
            type="file"
            multiple
            accept=".wav,.mp3,.m4a,audio/*"
            disabled={busy}
            onChange={e => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <span>{busy ? 'Processing…' : 'Choose audio files (wav, mp3, m4a)'}</span>
        </div>
        <div className="drop batch-drop">
          <input
            type="file"
            // @ts-expect-error webkitdirectory
            webkitdirectory=""
            directory=""
            multiple
            disabled={busy}
            onChange={e => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <span>{busy ? 'Processing…' : 'Choose folder'}</span>
        </div>
      </div>

      {status && <p className="muted">{status}</p>}
    </section>
  );
}
