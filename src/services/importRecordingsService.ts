import type { Database } from './storageService';
import type { DraftCall } from '../types/DraftCall';
import type { CallReview } from '../types/CallReview';
import { attachAudioToCall, loadFileFromStoredAudio } from './audioStorageService';
import { analysisOrchestrator } from './analysisOrchestrator';
import { transcribeAudioDetailed } from './openaiService';
import { upsertDraft, updateDraft } from './draftService';
import { findDuplicate } from './duplicateService';
import { cleanCallIdFromFilename, id } from '../utils/text';

const AUDIO_EXT = /\.(wav|mp3|m4a|webm|ogg)$/i;

export function isSupportedRecording(file: File): boolean {
  if (file.type.startsWith('audio/')) return true;
  return AUDIO_EXT.test(file.name);
}

export function filterRecordingFiles(files: FileList | File[]): File[] {
  return [...files].filter(isSupportedRecording);
}

export function queueRecordingsForImport(db: Database, files: File[]): Database {
  let next = db;
  for (const file of files) {
    const callId = id('call');
    next = upsertDraft(next, {
      id: id('draft'),
      status: 'queued',
      file_name: file.name,
      processing_step: 'Waiting in queue',
      call: {
        id: callId,
        call_id: cleanCallIdFromFilename(file.name),
        audio_file_name: file.name
      },
      evidence: []
    });
  }
  return next;
}

export async function processDraftRecording(
  db: Database,
  draftId: string,
  file: File,
  onUpdate: (db: Database) => void,
  opts?: { workspace?: CallReview['workspace']; botVersion?: CallReview['bot_version'] }
): Promise<void> {
  const draft = (db.drafts || []).find(d => d.id === draftId);
  if (!draft) return;

  const callId = draft.call.id || id('call');
  let working = updateDraft(db, draftId, {
    status: 'processing',
    processing_step: 'Copying audio to app storage'
  });
  onUpdate(working);

  try {
    let audioFields;
    try {
      audioFields = await attachAudioToCall(callId, file);
    } catch (persistErr: unknown) {
      const detail = persistErr instanceof Error ? persistErr.message : 'Unknown storage error';
      throw new Error(`Could not save audio to app storage: ${detail}. Import aborted — fix storage and retry.`);
    }
    working = updateDraft(working, draftId, {
      call: { ...draft.call, ...audioFields, id: callId },
      processing_step: 'Transcribing'
    });
    onUpdate(working);

    const transcribed = await transcribeAudioDetailed(working.settings, file);
    working = updateDraft(working, draftId, {
      transcript: transcribed.text,
      call: {
        ...working.drafts!.find(d => d.id === draftId)!.call,
        transcript: transcribed.text,
        transcript_segments: transcribed.segments,
        duration_seconds: transcribed.duration_seconds
      },
      processing_step: 'Listening locally'
    });
    onUpdate(working);

    const { call, evidence } = await analysisOrchestrator.analyzeCall({
      settings: working.settings,
      transcript: transcribed.text,
      transcriptSegments: transcribed.segments,
      audioFile: file,
      existingCallId: callId,
      workspace: opts?.workspace,
      botVersion: opts?.botVersion,
      onStep: step => {
        working = updateDraft(working, draftId, { processing_step: step });
        onUpdate(working);
      }
    });

    const mergedCall = {
      ...call,
      ...audioFields,
      id: callId,
      call_id: call.call_id || cleanCallIdFromFilename(file.name),
      transcript: transcribed.text,
      transcript_segments: transcribed.segments,
      workspace: opts?.workspace || call.workspace || 'production',
      bot_version: opts?.botVersion || call.bot_version || 'production'
    };

    const dup = findDuplicate(mergedCall as any, working.calls);

    working = updateDraft(working, draftId, {
      status: 'ready',
      processing_step: undefined,
      duplicate_warning: !!dup,
      call: mergedCall,
      evidence,
      error: dup ? `Possible duplicate of ${dup.call.call_id}` : undefined
    });
    onUpdate(working);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Import failed';
    working = updateDraft(working, draftId, {
      status: 'failed',
      processing_step: undefined,
      error: msg
    });
    onUpdate(working);
  }
}

export async function runImportQueue(
  db: Database,
  filesByDraftId: Map<string, File>,
  onUpdate: (db: Database) => void
): Promise<void> {
  let working = db;
  const queue = (working.drafts || []).filter(d => d.status === 'queued' || d.status === 'failed');
  for (const draft of queue) {
    const file = filesByDraftId.get(draft.id);
    if (!file) continue;
    await processDraftRecording(working, draft.id, file, updated => {
      working = updated;
      onUpdate(updated);
    });
  }
}

export async function reprocessDraftFromStorage(
  db: Database,
  draftId: string,
  onUpdate: (db: Database) => void,
  opts?: { workspace?: CallReview['workspace']; botVersion?: CallReview['bot_version'] }
): Promise<void> {
  const draft = (db.drafts || []).find(d => d.id === draftId);
  if (!draft) return;

  const file = await loadFileFromStoredAudio(draft.call);
  if (!file) {
    onUpdate(
      updateDraft(db, draftId, {
        status: 'failed',
        error: 'No stored audio — re-import the recording file.'
      })
    );
    return;
  }

  await processDraftRecording(db, draftId, file, onUpdate, opts);
}
