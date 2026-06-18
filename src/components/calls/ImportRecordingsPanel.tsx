import { useEffect, useRef, useState } from 'react';
import type { Database } from '../../services/storageService';
import type { CallReview } from '../../types/CallReview';
import { id } from '../../utils/text';
import { upsertDraft } from '../../services/draftService';
import { currentImportGeneration, isImportCancelled } from '../../services/importCancel';
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
  const [explorationBrief, setExplorationBrief] = useState(db.settings.importExplorationBrief || '');
  const filesRef = useRef<Map<string, File>>(new Map());
  const dbRef = useRef(db);

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  function persistExplorationBrief(value: string) {
    setExplorationBrief(value);
    setDb({ ...dbRef.current, settings: { ...dbRef.current.settings, importExplorationBrief: value } });
  }

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

    const runToken = currentImportGeneration();

    setBusy(true);
    setStatus(`Importing ${accepted.length} file(s)...`);

    const importBatchId = `batch-${Date.now()}`;
    const brief = explorationBrief.trim();
    let working = dbRef.current;
    const newDraftIds: string[] = [];

    for (const file of accepted) {
      if (isImportCancelled(runToken)) break;
      const draftId = id('draft');
      const callId = id('call');
      filesRef.current.set(draftId, file);
      working = upsertDraft(working, {
        id: draftId,
        status: 'queued',
        file_name: file.name,
        processing_step: 'Queued',
        import_batch_id: importBatchId,
        exploration_brief: brief || undefined,
        call: {
          id: callId,
          call_id: file.name.replace(/\.[^.]+$/, ''),
          audio_file_name: file.name,
          workspace,
          bot_version: defaultBotVersion
        },
        evidence: []
      });
      newDraftIds.push(draftId);
    }

    if (!isImportCancelled(runToken)) {
      setDb(working);
    }

    for (const draftId of newDraftIds) {
      if (isImportCancelled(runToken)) break;
      const file = filesRef.current.get(draftId);
      if (!file) continue;
      setStatus(`Processing ${file.name}...`);
      await processDraftRecording(
        dbRef.current,
        draftId,
        file,
        updated => {
          const cancelled = isImportCancelled(runToken);
          if (cancelled) return;
          working = updated;
          dbRef.current = updated;
          setDb(updated);
        },
        {
          workspace,
          botVersion: defaultBotVersion,
          explorationBrief: brief,
          shouldAbort: () => isImportCancelled(runToken)
        }
      );
    }

    filesRef.current.clear();
    setBusy(false);
    if (isImportCancelled(runToken)) {
      setStatus('Import cancelled.');
      return;
    }
    setStatus(`Done — ${newDraftIds.length} draft(s) in Needs Review.`);
    onClose?.();
  }

  return (
    <section className="panel import-panel">
      <h3>Import new recordings</h3>
      <p className="muted">
        Select audio files or a folder. Each file is copied to app storage, transcribed, and analyzed as a draft for your review.
      </p>

      <label className="field exploration-brief-field">
        <span>What are you exploring in this batch?</span>
        <textarea
          value={explorationBrief}
          onChange={e => persistExplorationBrief(e.target.value)}
          placeholder="e.g. Ticket promised but email function never called; box change promised but update_box not executed; insurance verification repeated"
          rows={3}
          disabled={busy}
        />
        <p className="muted exploration-brief-hint">
          Optional. Each call is judged only against this hypothesis. If there is no function trace (audio-only), the call is flagged for your review instead of guessing.
        </p>
      </label>

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
