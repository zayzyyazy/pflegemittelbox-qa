import { useMemo } from 'react';
import type { Database } from '../services/storageService';
import type { DraftCall } from '../types/DraftCall';
import type { CallReview } from '../types/CallReview';
import { ImportRecordingsPanel } from '../components/calls/ImportRecordingsPanel';
import { DraftCallsSection } from '../components/calls/DraftCallsSection';
import { InboxPipelineBar } from '../components/calls/InboxPipelineBar';
import { reprocessDraftFromStorage } from '../services/importRecordingsService';
import { PinnedCallsStrip } from '../components/calls/PinnedCallsStrip';
import { callWorkspace } from '../utils/workspace';

export function InboxPage({
  db,
  setDb,
  openSettings,
  openCall,
  onCallSaved
}: {
  db: Database;
  setDb: (db: Database) => void;
  openSettings?: () => void;
  openCall?: (id: string) => void;
  onCallSaved?: (call: Partial<CallReview>) => void;
}) {
  const drafts = db.drafts || [];
  const processing = drafts.filter(d => d.status === 'queued' || d.status === 'processing');
  const failedDrafts = drafts.filter(d => d.status === 'failed');
  const readyDrafts = drafts.filter(d => d.status === 'ready');
  const missingKey = !db.settings.openaiApiKey.trim();
  const pinnedProduction = useMemo(
    () => db.calls.filter(c => callWorkspace(c) === 'production' && c.pinned),
    [db.calls]
  );

  async function handleReprocess(draft: DraftCall) {
    await reprocessDraftFromStorage(
      db,
      draft.id,
      setDb,
      {
        workspace: draft.call.workspace || 'production',
        botVersion: draft.call.bot_version || 'production'
      }
    );
  }

  async function retryAllFailed() {
    if (missingKey) {
      openSettings?.();
      return;
    }
    for (const draft of failedDrafts) {
      await handleReprocess(draft);
    }
  }

  return (
    <main className="page inbox-page">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted">Import → Save ready calls → library under Calls.</p>
        </div>
        {readyDrafts.length > 0 && (
          <p className="inbox-ready-count">{readyDrafts.length} ready</p>
        )}
      </div>

      <InboxPipelineBar db={db} />

      {missingKey && (
        <div className="panel inline-notice error-banner">
          <p>
            <strong>OpenAI API key required.</strong> Settings → paste key → Retry failed imports or import again.
          </p>
          {openSettings && (
            <button type="button" className="btn-sm primary" onClick={openSettings}>
              Open Settings
            </button>
          )}
        </div>
      )}

      {readyDrafts.length > 0 && (
        <DraftCallsSection
          db={db}
          setDb={setDb}
          readyDrafts={readyDrafts}
          failedDrafts={[]}
          openSettings={openSettings}
          onCallSaved={onCallSaved}
        />
      )}

      <ImportRecordingsPanel db={db} setDb={setDb} workspace="production" defaultBotVersion="production" />

      {processing.length > 0 && (
        <section className="panel processing-strip">
          <h3>Processing ({processing.length})</h3>
          <ul className="processing-list">
            {processing.map(d => (
              <li key={d.id}>
                <span className="clamp-cell">{d.call.call_id || d.file_name}</span>
                <span className="badge blue">{d.processing_step || d.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {failedDrafts.length > 0 && (
        <DraftCallsSection
          db={db}
          setDb={setDb}
          readyDrafts={[]}
          failedDrafts={failedDrafts}
          onReprocess={handleReprocess}
          onRetryAllFailed={retryAllFailed}
          openSettings={openSettings}
        />
      )}

      {!drafts.length && pinnedProduction.length > 0 && (
        <section className="panel">
          <h2>Pinned examples</h2>
          <PinnedCallsStrip calls={pinnedProduction} evidence={db.evidence} onOpen={c => openCall?.(c.id)} />
        </section>
      )}

      {!drafts.length && !processing.length && (
        <section className="panel empty-inbox">
          <p className="muted">Drop WAV files above to start. Saved calls appear under Calls.</p>
        </section>
      )}
    </main>
  );
}
