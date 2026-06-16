import { useEffect, useState } from 'react';
import type { Database } from '../services/storageService';
import type { AnalysisStrictness, EvidenceSensitivity } from '../services/storageService';
import { loginToLeaping } from '../services/leapingImportService';
import {
  DB_KEY,
  clearDb,
  clearProductionCalls,
  clearTestCalls,
  resetDemoDb
} from '../services/storageService';
import { exportData, importData } from '../services/importExportService';
import { testKey, applyRecalculatedResultLabels } from '../services/openaiService';
import { getAudioStorageDirectory, isTauriApp } from '../services/audioStorageService';
import { addWorkflowArea, removeWorkflowArea, renameWorkflowArea } from '../services/taxonomyService';
import { defaultTaxonomy } from '../types/Taxonomy';
import { ConfirmDeleteModal } from '../components/ui/ConfirmDeleteModal';

type ClearAction = 'all' | 'production' | 'test' | 'demo' | null;

export function SettingsPage({ db, setDb }: { db: Database; setDb: (db: Database) => void }) {
  const [msg, setMsg] = useState('');
  const [leapingTestMsg, setLeapingTestMsg] = useState('');
  const [leapingTestBusy, setLeapingTestBusy] = useState(false);
  const [storagePath, setStoragePath] = useState('');
  const [clearAction, setClearAction] = useState<ClearAction>(null);
  const [newAreaLabel, setNewAreaLabel] = useState('');
  const settings = db.settings;
  const taxonomy = db.taxonomy || defaultTaxonomy;

  useEffect(() => {
    if (isTauriApp()) {
      getAudioStorageDirectory().then(p => setStoragePath(p || 'Unavailable'));
    } else {
      setStoragePath('Browser mode — audio in localStorage (dev only)');
    }
  }, []);

  function patch(p: Partial<typeof settings>) {
    setDb({ ...db, settings: { ...settings, ...p } });
  }

  async function test() {
    try {
      await testKey(settings);
      setMsg('OpenAI key works.');
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Test failed');
    }
  }

  async function testLeapingLogin() {
    setLeapingTestBusy(true);
    setLeapingTestMsg('Testing login…');
    const loginUrl = (settings.leapingLoginUrl || 'https://api.leaping.ai/v1/auth/login').trim();
    console.info('[leaping-test] starting login test', { url: loginUrl, hasUsername: !!settings.leapingUsername?.trim() });
    try {
      const result = await loginToLeaping(settings);
      const expiryDate = new Date(result.expiresAt).toLocaleString();
      setLeapingTestMsg(
        `Login OK.\nEndpoint: ${loginUrl}\nhas access_token: yes\nhas refresh_token: ${result.refreshToken ? 'yes' : 'no'}\nExpires: ${expiryDate}`
      );
      patch({
        leapingAccessToken: result.accessToken,
        leapingRefreshToken: result.refreshToken,
        leapingTokenExpiresAt: result.expiresAt
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[leaping-test] login test failed', { url: loginUrl, error: msg });
      setLeapingTestMsg(`Login failed:\n${msg}`);
    } finally {
      setLeapingTestBusy(false);
    }
  }

  function runClearAction() {
    if (clearAction === 'all') setDb(clearDb());
    else if (clearAction === 'production') setDb(clearProductionCalls(db));
    else if (clearAction === 'test') setDb(clearTestCalls(db));
    else if (clearAction === 'demo') setDb(resetDemoDb());
    setClearAction(null);
  }


  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">API, taxonomy, analysis behavior, and data management.</p>
        </div>
      </div>

      {settings.dbRecoveryNotice && (
        <div className="panel inline-notice error-banner">
          <p>{settings.dbRecoveryNotice}</p>
          <button type="button" className="btn-sm" onClick={() => patch({ dbRecoveryNotice: undefined })}>
            Dismiss
          </button>
        </div>
      )}

      <section className="panel form-grid">
        <h2>OpenAI</h2>
        <label className="field">
          <span>API key</span>
          <input
            type="password"
            value={settings.openaiApiKey}
            onChange={e => patch({ openaiApiKey: e.target.value })}
            placeholder="sk-…"
          />
        </label>
        <label className="field">
          <span>Text analysis model</span>
          <input value={settings.textModel} onChange={e => patch({ textModel: e.target.value })} />
        </label>
        <label className="field">
          <span>Transcription model</span>
          <input value={settings.transcriptionModel} onChange={e => patch({ transcriptionModel: e.target.value })} />
        </label>
        <button type="button" onClick={test}>
          Test key
        </button>
        {msg && <p className="muted">{msg}</p>}
      </section>

      <section className="panel form-grid">
        <h2>Leaping API</h2>
        <label className="field">
          <span>Calls API URL</span>
          <input
            value={settings.leapingApiUrl || ''}
            onChange={e => patch({ leapingApiUrl: e.target.value })}
            placeholder="https://api.leaping.ai/v1/calls/"
          />
        </label>
        <label className="field">
          <span>Login endpoint URL</span>
          <input
            value={settings.leapingLoginUrl || ''}
            onChange={e => patch({ leapingLoginUrl: e.target.value })}
            placeholder="https://api.leaping.ai/v1/auth/login"
          />
        </label>
        <label className="field">
          <span>Username / email</span>
          <input
            type="email"
            value={settings.leapingUsername || ''}
            onChange={e => patch({ leapingUsername: e.target.value })}
            placeholder="you@example.com"
            autoComplete="username"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={settings.leapingPassword || ''}
            onChange={e => patch({ leapingPassword: e.target.value })}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </label>
        {settings.leapingTokenExpiresAt && (
          <p className="muted">
            Cached token expires:{' '}
            <strong>{new Date(settings.leapingTokenExpiresAt).toLocaleString()}</strong>
          </p>
        )}
        <div className="row wrap">
          <button
            type="button"
            disabled={leapingTestBusy}
            onClick={() => { void testLeapingLogin(); }}
          >
            {leapingTestBusy ? 'Testing…' : 'Test Leaping login'}
          </button>
          {settings.leapingAccessToken && (
            <button
              type="button"
              className="btn-sm"
              onClick={() => patch({ leapingAccessToken: undefined, leapingRefreshToken: undefined, leapingTokenExpiresAt: undefined })}
            >
              Clear cached token
            </button>
          )}
        </div>
        {leapingTestMsg && (
          <pre className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em', marginTop: 8 }}>
            {leapingTestMsg}
          </pre>
        )}
        <hr style={{ margin: '12px 0', opacity: 0.3 }} />
        <label className="field">
          <span>Manual Bearer token (fallback)</span>
          <input
            type="password"
            value={settings.leapingApiKey || ''}
            onChange={e => patch({ leapingApiKey: e.target.value })}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </label>
        <p className="muted privacy">
          All credentials stored in browser localStorage — local only.
          The app logs in automatically using username/password and caches the token for 24 hours.
          The manual Bearer token above is used only if login credentials are not set.
        </p>
      </section>

      <section className="panel form-grid">
        <h2>Audio listener</h2>
        <label className="field row">
          <input
            type="checkbox"
            checked={settings.audioListenerEnabled !== false}
            onChange={e => patch({ audioListenerEnabled: e.target.checked })}
          />
          <span>Enable AI audio listener</span>
        </label>
        <label className="field">
          <span>Audio review mode</span>
          <select
            value={settings.audioListenerMode || 'all'}
            onChange={e => patch({ audioListenerMode: e.target.value as typeof settings.audioListenerMode })}
          >
            <option value="all">Listen to every imported call</option>
            <option value="suspicious">Only suspicious calls / selected clips</option>
          </select>
        </label>
        <label className="field">
          <span>Audio listener model</span>
          <input
            value={settings.audioListenerModel || 'gpt-audio-1.5'}
            onChange={e => patch({ audioListenerModel: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Max clips per call</span>
          <input
            type="number"
            min={1}
            max={5}
            value={settings.maxAudioClipsPerCall ?? 2}
            onChange={e => patch({ maxAudioClipsPerCall: Number(e.target.value) || 2 })}
          />
        </label>
        <label className="field">
          <span>Max clip length (seconds per clip sent to AI)</span>
          <input
            type="number"
            min={10}
            max={60}
            value={settings.maxClipSeconds ?? 30}
            onChange={e => patch({ maxClipSeconds: Number(e.target.value) || 30 })}
          />
          <span className="muted">Each clip sent to the listener is capped at this length (default 30s).</span>
        </label>
        <label className="field">
          <span>Full-call listen when under (seconds)</span>
          <input
            type="number"
            min={60}
            max={1800}
            value={settings.alwaysListenFullCallUnderSeconds ?? 1200}
            onChange={e => patch({ alwaysListenFullCallUnderSeconds: Number(e.target.value) || 1200 })}
          />
          <span className="muted">
            Calls shorter than this get one full recording sent to the listener instead of clip windows.
          </span>
        </label>
        <label className="buttonlike">
          Test audio listener
          <input
            hidden
            type="file"
            accept="audio/*"
            onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setMsg('Testing audio listener…');
              try {
                const { testAudioListener } = await import('../agents/audioListener');
                const findings = await testAudioListener(settings, f);
                setMsg(
                  findings.length
                    ? `Heard: ${findings.map(x => x.heard).join(' | ')}`
                    : 'Audio listener returned no issues for test clip.'
                );
              } catch (err: unknown) {
                setMsg(err instanceof Error ? err.message : 'Audio listener test failed');
              }
            }}
          />
        </label>
        <p className="muted privacy">
          Local waveform analysis runs on every audio import. AI audio review listens according to the selected mode above.
        </p>
      </section>

      <section className="panel form-grid">
        <h2>Analysis</h2>
        <label className="field">
          <span>Strictness</span>
          <select
            value={settings.analysisStrictness || 'strict'}
            onChange={e => patch({ analysisStrictness: e.target.value as AnalysisStrictness })}
          >
            <option value="strict">Strict — fewer false evidence flags</option>
            <option value="standard">Standard</option>
            <option value="lenient">Lenient — more AI freedom</option>
          </select>
        </label>
        <label className="field">
          <span>Evidence sensitivity</span>
          <select
            value={settings.evidenceSensitivity || 'low'}
            onChange={e => patch({ evidenceSensitivity: e.target.value as EvidenceSensitivity })}
          >
            <option value="low">Low — recall-first, up to 3 moments</option>
            <option value="medium">Medium — up to 4</option>
            <option value="high">High — up to 5</option>
          </select>
        </label>
        <p className="muted privacy">
          Re-analyze or recalculate calls after changing analysis settings.
        </p>
      </section>

      <section className="panel">
        <h2>Workflow taxonomy</h2>
        <p className="muted">Marie workflow areas used for tagging. AI reads this list on next extract.</p>
        <div className="taxonomy-list">
          {taxonomy.workflowAreas.map(area => (
            <div className="taxonomy-row row between wrap" key={area.id}>
              <div>
                <strong>{area.label}</strong>
                <p className="muted meta">{area.id}</p>
              </div>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => {
                    const label = window.prompt('Rename workflow area', area.label);
                    if (label?.trim()) setDb(renameWorkflowArea(db, area.id, { label: label.trim() }));
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn-sm btn-danger-soft"
                  onClick={() => setDb(removeWorkflowArea(db, area.id))}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <input
            placeholder="New workflow area label"
            value={newAreaLabel}
            onChange={e => setNewAreaLabel(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (!newAreaLabel.trim()) return;
              setDb(addWorkflowArea(db, newAreaLabel.trim()));
              setNewAreaLabel('');
            }}
          >
            Add area
          </button>
        </div>
      </section>

      <section className="panel form-grid">
        <h2>Local storage</h2>
        <label className="field">
          <span>Recording directory (app-managed)</span>
          <input value={storagePath} readOnly />
        </label>
        <p className="muted privacy">
          Call data lives in localStorage key <code>{DB_KEY}</code>. On first launch, data migrates from{' '}
          <code>ai-call-qa-cockpit-db-v1</code> with production workspace tags.
        </p>
      </section>

      <section className="panel">
        <h2>Data</h2>
        <div className="row wrap">
          <button type="button" onClick={() => navigator.clipboard.writeText(exportData(db))}>
            Export JSON
          </button>
          <label className="buttonlike">
            Import JSON
            <input
              hidden
              type="file"
              accept="application/json"
              onChange={async e => {
                const f = e.target.files?.[0];
                if (f) setDb(importData(await f.text()));
              }}
            />
          </label>
          <button type="button" className="btn-danger-soft" onClick={() => setClearAction('all')}>
            Clear all data
          </button>
          <button type="button" className="btn-danger-soft" onClick={() => setClearAction('production')}>
            Clear production calls
          </button>
          <button type="button" className="btn-danger-soft" onClick={() => setClearAction('test')}>
            Clear test calls
          </button>
          <button type="button" onClick={() => setClearAction('demo')}>
            Reload demo data
          </button>
          <button
            type="button"
            className="btn-danger-soft"
            onClick={() => {
              if (
                !window.confirm(
                  'Recalculate Anliegen, result labels, and filtered evidence for all saved calls? This overwrites stored labels using current heuristics.'
                )
              ) {
                return;
              }
              setDb(applyRecalculatedResultLabels(db));
              setMsg('Recalculated labels for all saved calls.');
            }}
          >
            Recalculate all call labels
          </button>
        </div>
      </section>

      {clearAction && (
        <ConfirmDeleteModal
          title={
            clearAction === 'all'
              ? 'Clear all local data?'
              : clearAction === 'production'
                ? 'Clear production calls?'
                : clearAction === 'test'
                  ? 'Clear test calls?'
                  : 'Reload demo data?'
          }
          description={
            clearAction === 'all'
              ? 'Removes all calls, evidence, issues, experiments, drafts, and patterns. Settings and taxonomy reset.'
              : clearAction === 'production'
                ? 'Removes production workspace calls and their evidence. Test calls are kept.'
                : clearAction === 'test'
                  ? 'Removes test workspace calls and their evidence. Production library is kept.'
                  : 'Replaces all data with the 5-call demo seed (production workspace).'
          }
          confirmLabel={
            clearAction === 'demo' ? 'Reload demo' : clearAction === 'all' ? 'Clear everything' : 'Delete'
          }
          onCancel={() => setClearAction(null)}
          onConfirm={runClearAction}
        />
      )}
    </main>
  );
}
