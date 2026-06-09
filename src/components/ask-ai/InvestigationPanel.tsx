import { useMemo, useState } from 'react';
import type { Database } from '../../services/storageService';
import {
  askInvestigation,
  draftActionsFromAnswer,
  executeApprovedAction,
  suggestedInvestigationQuestions,
  type InvestigationFocus,
  type InvestigationMessage,
  type PendingInvestigationAction
} from '../../services/investigationService';
import { id } from '../../utils/text';
import { nowIso } from '../../utils/dates';

export function InvestigationPanel({
  db,
  setDb,
  focus,
  onClose
}: {
  db: Database;
  setDb: (db: Database) => void;
  focus: InvestigationFocus;
  onClose?: () => void;
}) {
  const [messages, setMessages] = useState<InvestigationMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<PendingInvestigationAction[]>([]);

  const prompts = useMemo(() => suggestedInvestigationQuestions(focus), [focus]);

  async function run(customQ?: string) {
    const q = (customQ || question).trim();
    if (!q) return;
    setBusy(true);
    setErr('');
    const userMsg: InvestigationMessage = { id: id('msg'), role: 'user', content: q, created_at: nowIso() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setQuestion('');
    try {
      const r = await askInvestigation(db.settings, focus, db, nextMessages, q);
      const text = String(r.answer || r.summary || JSON.stringify(r, null, 2));
      setAnswer(text);
      setMessages([
        ...nextMessages,
        { id: id('msg'), role: 'assistant', content: text, created_at: nowIso() }
      ]);
      setPending(draftActionsFromAnswer(text, db, focus));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Investigation request failed');
    } finally {
      setBusy(false);
    }
  }

  function approve(action: PendingInvestigationAction) {
    setDb(executeApprovedAction(db, action));
    setPending(p => p.filter(a => a.id !== action.id));
  }

  const focusLabel =
    focus.type === 'call'
      ? `Call investigation`
      : focus.type === 'evidence'
        ? `Evidence investigation`
        : focus.type === 'issue'
          ? `Issue investigation`
          : `Project investigation`;

  return (
    <aside className="investigation-panel">
      <div className="investigation-head">
        <div>
          <h3>{focusLabel}</h3>
          <p className="muted">Context-aware QA assistant · conversation persists until you close</p>
        </div>
        {onClose && (
          <button type="button" className="btn-sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <div className="investigation-prompts">
        {prompts.map(p => (
          <button key={p} type="button" className="chip-btn" disabled={busy} onClick={() => run(p)}>
            {p}
          </button>
        ))}
      </div>

      {messages.length > 0 && (
        <div className="investigation-thread">
          {messages.map(m => (
            <div key={m.id} className={`thread-msg ${m.role}`}>
              <span className="thread-role">{m.role === 'user' ? 'You' : 'Investigation AI'}</span>
              <pre>{m.content}</pre>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="Ask about intent, auth, escalation, workflow, engineering priority…"
        rows={3}
      />
      <div className="row wrap">
        <button type="button" className="primary" disabled={busy || !question.trim()} onClick={() => run()}>
          {busy ? 'Analyzing…' : 'Ask'}
        </button>
      </div>
      {err && <p className="error">{err}</p>}
      {answer && !messages.length && <pre className="answer investigation-answer">{answer}</pre>}

      {pending.length > 0 && (
        <section className="approval-queue">
          <h4>Proposed actions (approve to execute)</h4>
          {pending.map(action => (
            <div key={action.id} className="approval-row">
              <div>
                <b>{action.title}</b>
                <p className="muted">{action.kind.replace(/_/g, ' ')}</p>
              </div>
              <div className="row">
                <button type="button" className="btn-sm primary-soft" onClick={() => approve(action)}>
                  Approve
                </button>
                <button type="button" className="btn-sm" onClick={() => setPending(p => p.filter(a => a.id !== action.id))}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}

/** Back-compat wrapper */
export function AskAiPanel(props: {
  db: Database;
  setDb: (db: Database) => void;
  contextType?: 'project' | 'call' | 'issue';
  relatedId?: string;
  onClose?: () => void;
  evidenceId?: string;
  highlightQuote?: string;
}) {
  const focus: InvestigationFocus =
    props.contextType === 'call'
      ? { type: 'call', relatedId: props.relatedId, evidenceId: props.evidenceId, highlightQuote: props.highlightQuote }
      : props.contextType === 'issue'
        ? { type: 'issue', relatedId: props.relatedId }
        : { type: 'project' };
  return <InvestigationPanel db={props.db} setDb={props.setDb} focus={focus} onClose={props.onClose} />;
}
