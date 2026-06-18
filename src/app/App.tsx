import { useEffect, useState } from 'react';
import { Sidebar, type PageKey } from '../components/layout/Sidebar';
import { DashboardPage } from '../pages/DashboardPage';
import { InboxPage } from '../pages/InboxPage';
import { CallsPage } from '../pages/CallsPage';
import { IssuesPage } from '../pages/IssuesPage';
import { NotesPage } from '../pages/NotesPage';
import { SettingsPage } from '../pages/SettingsPage';
import {
  loadDbAsync,
  saveDbWithRecoveryAsync,
  compactStoredDatabase,
  clearAllCallsAndDrafts,
  type Database
} from '../services/storageService';
import { clearInboxQueue } from '../services/draftService';
import { cancelActiveImport } from '../services/importCancel';
import { StoragePressureBanner } from '../components/layout/StoragePressureBanner';
import type { CallReview } from '../types/CallReview';
import { loadSavedWorkspace, saveWorkspace, workspaceLabel } from '../utils/workspace';
import { diskDatabaseEnabled, databaseFileKb } from '../services/diskDatabaseService';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

export default function App() {
  const [page, setPage] = useState<PageKey>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string | undefined>();
  const [callsIssueFilter, setCallsIssueFilter] = useState<string | undefined>();
  const [selectedCall, setSelectedCall] = useState<string | undefined>();
  const [selectedEvidence, setSelectedEvidence] = useState<string | undefined>();
  const [workspace, setWorkspace] = useState<'production' | 'test'>(() => loadSavedWorkspace());
  const [toast, setToast] = useState<{ message: string; callId?: string } | null>(null);
  const [db, setDbState] = useState<Database | null>(null);
  const [dbReady, setDbReady] = useState(false);
  const [storagePressure, setStoragePressure] = useState(false);
  const [notesSaveFailed, setNotesSaveFailed] = useState(false);
  const [usingDiskStorage, setUsingDiskStorage] = useState(false);

  useEffect(() => {
    loadDbAsync()
      .then(async loaded => {
        setDbState(loaded);
        if (diskDatabaseEnabled()) {
          const kb = await databaseFileKb();
          if (kb > 0) setUsingDiskStorage(true);
        }
        setDbReady(true);
      })
      .catch(e => {
        console.error('[pflegemittelbox] load failed', e);
        setDbReady(true);
      });
  }, []);

  const setDb = (next: Database) => {
    setDbState(next);
    void saveDbWithRecoveryAsync(next).then(({ mainOk, notesOk, onDisk }) => {
      if (onDisk) setUsingDiskStorage(true);
      if (mainOk && notesOk) {
        setStoragePressure(false);
        setNotesSaveFailed(false);
        return;
      }
      if (!mainOk) setStoragePressure(true);
      if (!notesOk) setNotesSaveFailed(true);
    });
  };

  function handleFreeStorage() {
    if (!db) return;
    setDb(compactStoredDatabase(db));
  }

  function handleClearAllCalls() {
    if (!db) return;
    if (
      !window.confirm(
        `Delete all ${db.calls.length} saved calls and ${(db.drafts || []).length} inbox drafts? Notes and settings are kept.`
      )
    ) {
      return;
    }
    cancelActiveImport();
    setDb(clearAllCallsAndDrafts(clearInboxQueue(db)));
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openCallsForIssue(issueId: string) {
    setCallsIssueFilter(issueId);
    setSelectedIssue(issueId);
    setPage('calls');
  }

  function openIssue(id: string) {
    setSelectedIssue(id);
    setPage('issues');
  }

  function openCall(id: string, evidenceId?: string) {
    setSelectedCall(id);
    setSelectedEvidence(evidenceId);
    setPage('calls');
  }

  function handleWorkspaceChange(next: 'production' | 'test') {
    setWorkspace(next);
    saveWorkspace(next);
  }

  function showSaveToast(call?: Partial<CallReview>) {
    if (!call?.id) return;
    const ws = workspaceLabel(call.workspace === 'test' ? 'test' : 'production');
    setToast({ message: `Saved to Calls (${ws})`, callId: call.id });
  }

  if (!dbReady || !db) {
    return (
      <div className="app">
        <div className="content page">
          <p className="muted">Loading your call library…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="content">
        {storagePressure && !usingDiskStorage && (
          <StoragePressureBanner
            db={db}
            notesFailed={notesSaveFailed}
            onFreeStorage={handleFreeStorage}
            onClearCalls={handleClearAllCalls}
            onOpenSettings={() => setPage('settings')}
            onDismiss={() => setStoragePressure(false)}
          />
        )}
        <ErrorBoundary name={`route:${page}`}>
        {page === 'dashboard' && (
          <DashboardPage
            db={db}
            setDb={setDb}
            openInbox={() => setPage('inbox')}
            openIssue={openIssue}
            openCall={id => openCall(id)}
          />
        )}
        {page === 'inbox' && (
          <InboxPage
            db={db}
            setDb={setDb}
            usingDiskStorage={usingDiskStorage}
            workspace={workspace}
            onWorkspaceChange={handleWorkspaceChange}
            openSettings={() => setPage('settings')}
            openCall={id => openCall(id)}
            onCallSaved={showSaveToast}
          />
        )}
        {page === 'calls' && (
          <CallsPage
            db={db}
            setDb={setDb}
            selectedCallId={selectedCall}
            selectedEvidenceId={selectedEvidence}
            issueFilterId={callsIssueFilter}
            onClearIssueFilter={() => setCallsIssueFilter(undefined)}
            initialWorkspace={workspace}
            onWorkspaceChange={handleWorkspaceChange}
            openInbox={() => setPage('inbox')}
            onClearSelection={() => {
              setSelectedCall(undefined);
              setSelectedEvidence(undefined);
            }}
          />
        )}
        {page === 'issues' && (
          <IssuesPage
            db={db}
            setDb={setDb}
            selectedIssueId={selectedIssue}
            clearSelected={() => setSelectedIssue(undefined)}
            openCall={openCall}
            openCallsForIssue={openCallsForIssue}
          />
        )}
        {page === 'notes' && <NotesPage db={db} setDb={setDb} openCall={openCall} />}
        {page === 'settings' && <SettingsPage db={db} setDb={setDb} />}
        </ErrorBoundary>
      </div>
      {toast && (
        <div className="app-toast" role="status">
          <span>{toast.message}</span>
          {toast.callId && (
            <button
              type="button"
              className="btn-sm primary-soft"
              onClick={() => {
                openCall(toast.callId!);
                setToast(null);
              }}
            >
              View
            </button>
          )}
        </div>
      )}
    </div>
  );
}
