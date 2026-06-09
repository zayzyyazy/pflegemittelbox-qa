import { useEffect, useState } from 'react';
import { Sidebar, type PageKey } from '../components/layout/Sidebar';
import { InboxPage } from '../pages/InboxPage';
import { CallsPage } from '../pages/CallsPage';
import { IssuesPage } from '../pages/IssuesPage';
import { SettingsPage } from '../pages/SettingsPage';
import { loadDb, saveDb, type Database } from '../services/storageService';
import type { CallReview } from '../types/CallReview';
import { loadSavedWorkspace, saveWorkspace, workspaceLabel } from '../utils/workspace';

export default function App() {
  const [page, setPage] = useState<PageKey>('inbox');
  const [collapsed, setCollapsed] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string | undefined>();
  const [selectedCall, setSelectedCall] = useState<string | undefined>();
  const [selectedEvidence, setSelectedEvidence] = useState<string | undefined>();
  const [workspace, setWorkspace] = useState<'production' | 'test'>(() => loadSavedWorkspace());
  const [toast, setToast] = useState<{ message: string; callId?: string } | null>(null);
  const [db, setDbState] = useState<Database>(() => loadDb());
  const setDb = (next: Database) => {
    setDbState(next);
    saveDb(next);
  };

  useEffect(() => saveDb(db), [db]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  return (
    <div className="app">
      <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="content">
        {page === 'inbox' && (
          <InboxPage
            db={db}
            setDb={setDb}
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
            initialWorkspace={workspace}
            onWorkspaceChange={handleWorkspaceChange}
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
          />
        )}
        {page === 'settings' && <SettingsPage db={db} setDb={setDb} />}
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
