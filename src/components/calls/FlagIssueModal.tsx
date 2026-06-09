import { useState } from 'react';
import type { Database } from '../../services/storageService';
import type { Issue } from '../../types/Issue';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { upsertIssue } from '../../services/issuesService';
import { nowIso } from '../../utils/dates';
import { id } from '../../utils/text';

export function FlagIssueModal({
  db,
  setDb,
  callId,
  onClose,
  onLinked
}: {
  db: Database;
  setDb: (db: Database) => void;
  callId: string;
  onClose: () => void;
  onLinked: (issueId: string) => void;
}) {
  const [mode, setMode] = useState<'pick' | 'new'>('pick');
  const [selectedId, setSelectedId] = useState(db.issues[0]?.id || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const activeIssues = db.issues.filter(i => i.status !== 'resolved');

  function linkExisting() {
    if (!selectedId) return;
    const issue = db.issues.find(i => i.id === selectedId);
    if (!issue) return;
    const linked = Array.from(new Set([...issue.linked_call_ids, callId]));
    setDb(upsertIssue(db, { ...issue, linked_call_ids: linked, updated_at: nowIso() }));
    onLinked(selectedId);
    onClose();
  }

  function createAndLink() {
    if (!title.trim()) return;
    const issueId = id('issue');
    const issue: Issue = {
      id: issueId,
      title: title.trim(),
      category: 'Other',
      severity: 'medium',
      status: 'active',
      description: description.trim(),
      suggested_fix: '',
      notes: '',
      linked_call_ids: [callId],
      created_at: nowIso(),
      updated_at: nowIso()
    };
    setDb(upsertIssue(db, issue));
    onLinked(issueId);
    onClose();
  }

  return (
    <Modal title="Flag / link issue" onClose={onClose} stacked>
      <div className="row wrap">
        <button type="button" className={mode === 'pick' ? 'primary-soft' : ''} onClick={() => setMode('pick')}>
          Link existing
        </button>
        <button type="button" className={mode === 'new' ? 'primary-soft' : ''} onClick={() => setMode('new')}>
          New issue
        </button>
      </div>

      {mode === 'pick' ? (
        <>
          <Field label="Issue">
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              {activeIssues.length === 0 && <option value="">No active issues</option>}
              {activeIssues.map(i => (
                <option key={i.id} value={i.id}>{i.title}</option>
              ))}
            </select>
          </Field>
          <div className="row end">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary" disabled={!selectedId} onClick={linkExisting}>
              Link call
            </button>
          </div>
        </>
      ) : (
        <>
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What went wrong?" />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </Field>
          <div className="row end">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary" disabled={!title.trim()} onClick={createAndLink}>
              Create &amp; link
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
