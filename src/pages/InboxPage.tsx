import { useEffect, useMemo, useState } from 'react';
import type { Database } from '../services/storageService';
import { compactStoredDatabase, clearAllCallsAndDrafts, estimateStorageKbAsync } from '../services/storageService';
import { clearInboxQueue } from '../services/draftService';
import { cancelActiveImport } from '../services/importCancel';
import type { DraftCall } from '../types/DraftCall';
import type { CallReview } from '../types/CallReview';
import { ImportRecordingsPanel } from '../components/calls/ImportRecordingsPanel';
import { DraftCallsSection } from '../components/calls/DraftCallsSection';
import { InboxPipelineBar } from '../components/calls/InboxPipelineBar';
import { reprocessDraftFromStorage } from '../services/importRecordingsService';
import { PinnedCallsStrip } from '../components/calls/PinnedCallsStrip';
import { callWorkspace, workspaceLabel } from '../utils/workspace';

export function InboxPage({
  db,
  setDb,
  usingDiskStorage = false,
  workspace = 'production',
  onWorkspaceChange,
  openSettings,
  openCall,
  onCallSaved
}: {
  db: Database;
  setDb: (db: Database) => void;
  usingDiskStorage?: boolean;
  workspace?: 'production' | 'test';
  onWorkspaceChange?: (workspace: 'production' | 'test') => void;
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
  const [usage, setUsage] = useState({ totalKb: 0, mainKb: 0, diskKb: 0, audioKb: 0, notesKb: 0, onDisk: false });

  useEffect(() => {
    void estimateStorageKbAsync().then(setUsage);
  }, [db.calls.length, db.drafts?.length]);

  const storageTight =
    !usingDiskStorage &&
    !usage.onDisk &&
    (usage.totalKb > 3500 || db.calls.length > 60 || (db.drafts || []).length > 8);

  function handleClearInboxQueue() {
    cancelActiveImport();
    const cleared = clearInboxQueue(db);
    setDb(cleared);
  }

  function confirmClearInboxQueue(count: number) {
    const ok = window.confirm(`Cancel and remove all ${count} inbox items? Any import in progress will stop.`);
    if (ok) handleClearInboxQueue();
  }

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
          <p className="muted">
            Import → Save ready calls → library under Calls.{' '}
            <span className="badge blue">Saving to {workspaceLabel(workspace)}</span>
          </p>
        </div>
        <div className="row wrap workspace-toggle">
          <button
            type="button"
            className={workspace === 'production' ? 'primary-soft' : ''}
            onClick={() => onWorkspaceChange?.('production')}
          >
            Production
          </button>
          <button
            type="button"
            className={workspace === 'test' ? 'primary-soft' : ''}
            onClick={() => onWorkspaceChange?.('test')}
          >
            Test
          </button>
        </div>
        {readyDrafts.length > 0 && (
          <p className="inbox-ready-count">{readyDrafts.length} ready</p>
        )}
      </div>

      <InboxPipelineBar db={db} />

      {storageTight && (
        <div className="panel inline-notice storage-pressure-banner">
          <div>
            <strong>
              {usage.onDisk || usingDiskStorage
                ? `Call library on disk (~${usage.diskKb || usage.totalKb} KB)`
                : `App storage getting full (~${usage.totalKb} KB)`}
            </strong>
            <p className="muted storage-pressure-copy">
              {usage.onDisk || usingDiskStorage ? (
                <>
                  Your calls are saved to a file on your Mac (not the 5 MB browser cache). Audio is on disk too.
                  {usage.notesKb > 0 ? ` Notes cache ~${usage.notesKb} KB.` : ''}
                </>
              ) : (
                <>
                  This is the app&apos;s built-in browser cache (~5 MB cap), not your Mac&apos;s disk.
                  Calls DB ~{usage.mainKb} KB
                  {usage.audioKb > 0 ? ` · audio cache ~${usage.audioKb} KB` : ' · audio on disk (good)'}
                  {usage.notesKb > 0 ? ` · notes ~${usage.notesKb} KB` : ''}.
                  Rebuild the desktop app to migrate calls to disk automatically.
                </>
              )}
            </p>
          </div>
          <div className="row wrap storage-pressure-actions">
            {!usage.onDisk && !usingDiskStorage && (
              <>
                <button type="button" className="primary-soft" onClick={() => setDb(compactStoredDatabase(db))}>
                  Free storage
                </button>
                <button
                  type="button"
                  className="btn-danger-soft"
                  onClick={() => confirmClearInboxQueue((db.drafts || []).length)}
                >
                  Clear inbox queue
                </button>
                <button
                  type="button"
                  className="btn-danger-soft"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete all ${db.calls.length} saved calls? Notes are kept. Inbox queue is cleared too.`
                      )
                    ) {
                      cancelActiveImport();
                      setDb(clearAllCallsAndDrafts(clearInboxQueue(db)));
                    }
                  }}
                >
                  Clear all calls
                </button>
              </>
            )}
            {openSettings && (
              <button type="button" className="btn-sm" onClick={openSettings}>
                Settings
              </button>
            )}
          </div>
        </div>
      )}

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

      <ImportRecordingsPanel db={db} setDb={setDb} workspace={workspace} defaultBotVersion="production" />

      {processing.length > 0 && (
        <section className="panel processing-strip">
          <div className="row between wrap">
            <h3>Processing ({processing.length})</h3>
            <button
              type="button"
              className="btn-danger-soft btn-sm"
              onClick={() => confirmClearInboxQueue(processing.length)}
            >
              Clear queue
            </button>
          </div>
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
