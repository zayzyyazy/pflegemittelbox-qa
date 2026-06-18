import { useEffect, useMemo, useRef, useState } from 'react';
import type { Database } from '../services/storageService';
import type { WorkspaceNote, WorkspaceNoteKind } from '../types/WorkspaceNote';
import { addWorkspaceNote, deleteWorkspaceNote } from '../services/workspaceNotesService';
import { recoverArchivedNotes } from '../services/notesPersistenceService';
import { deletePersonalNote } from '../services/personalWorkspaceService';
import { fmtDate } from '../utils/dates';
import { resolveCallByReference, shortCallId } from '../utils/text';
import { Badge } from '../components/ui/Badge';

const kinds: Array<{ key: WorkspaceNoteKind | 'all'; label: string }> = [
  { key: 'all', label: 'All notes' },
  { key: 'call', label: 'Call notes' },
  { key: 'screenshot', label: 'Screenshot notes' },
  { key: 'prompt', label: 'Prompt notes' },
  { key: 'general', label: 'General' }
];

function readImage(file: File): Promise<{ dataUrl: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not compress image'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.78), name: file.name });
      };
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

function noteMatches(note: WorkspaceNote, query: string) {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return [
    note.call_id,
    note.title,
    note.note,
    note.pasted_text,
    ...(note.tags || [])
  ].filter(Boolean).join(' ').toLowerCase().includes(q);
}

export function NotesPage({
  db,
  setDb,
  openCall
}: {
  db: Database;
  setDb: (db: Database) => void;
  openCall: (id: string) => void;
}) {
  const [kind, setKind] = useState<WorkspaceNoteKind>('call');
  const [filterKind, setFilterKind] = useState<WorkspaceNoteKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [callId, setCallId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [message, setMessage] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const recovered = recoverArchivedNotes();
    if (recovered.length > (db.workspaceNotes?.length || 0)) {
      setDb({ ...db, workspaceNotes: recovered });
      setMessage(`Recovered ${recovered.length} note(s) from storage.`);
    }
  }, []);

  const legacyPersonalNotes: WorkspaceNote[] = useMemo(() => {
    return (db.personalNotes || []).map(item => ({
      id: `personal:${item.id}`,
      kind: 'general',
      title: 'Personal note',
      note: item.text,
      tags: ['personal'],
      created_at: item.created_at,
      updated_at: item.updated_at
    }));
  }, [db.personalNotes]);

  const filtered = useMemo(() => {
    return [...(db.workspaceNotes || []), ...legacyPersonalNotes]
      .filter(item => filterKind === 'all' || item.kind === filterKind)
      .filter(item => noteMatches(item, query));
  }, [db.workspaceNotes, legacyPersonalNotes, filterKind, query]);

  async function attachImage(file?: File) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      setImage(await readImage(file));
      setKind('screenshot');
      setMessage('Screenshot attached.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not attach screenshot.');
    }
  }

  function save() {
    const hasContent = callId.trim() || title.trim() || note.trim() || pastedText.trim() || image?.dataUrl;
    if (!hasContent) {
      setMessage('Add a call ID, title, note, pasted text, or screenshot before saving.');
      return;
    }
    try {
      setDb(addWorkspaceNote(db, {
        kind,
        call_id: kind === 'prompt' || kind === 'general' ? undefined : callId,
        title,
        note: note || title || callId,
        pasted_text: kind === 'call' ? undefined : pastedText,
        image_data_url: kind === 'screenshot' ? image?.dataUrl : undefined,
        image_name: kind === 'screenshot' ? image?.name : undefined
      }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save note.');
      return;
    }
    setCallId('');
    setTitle('');
    setNote('');
    setPastedText('');
    setImage(null);
    setMessage('Note saved.');
  }

  function findCall(noteCallId?: string) {
    return resolveCallByReference(db.calls, noteCallId);
  }

  return (
    <main className="page notes-page">
      <div className="page-head">
        <div>
          <h1>Notes</h1>
          <p>Call IDs, screenshots, pasted prompt/node text, and review notes in one searchable workspace.</p>
        </div>
      </div>

      <section
        className="panel notes-composer"
        onPaste={async e => {
          const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
          if (file) await attachImage(file);
        }}
      >
        <div className="row wrap note-kind-tabs">
          {kinds.filter(k => k.key !== 'all').map(item => (
            <button
              type="button"
              key={item.key}
              className={kind === item.key ? 'primary-soft' : ''}
              onClick={() => setKind(item.key as WorkspaceNoteKind)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className={`note-type-panel note-type-${kind}`}>
          <strong>
            {kind === 'call' && 'Call note'}
            {kind === 'screenshot' && 'Screenshot note'}
            {kind === 'prompt' && 'Prompt / node note'}
            {kind === 'general' && 'General note'}
          </strong>
          <p className="muted">Save whatever you have. A call ID, title, note, screenshot, or pasted text is enough.</p>
        </div>

        <div className="notes-form-grid">
          {(kind === 'call' || kind === 'screenshot') && (
            <label className="field">
              <span>{kind === 'call' ? 'Call ID' : 'Related call ID'}</span>
              <input
                value={callId}
                onChange={e => setCallId(e.target.value)}
                placeholder="Paste call id, e.g. 06a23e..."
              />
            </label>
          )}
          <label className="field">
            <span>Title</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Optional title"
            />
          </label>
          <label className="field notes-wide">
            <span>
              {kind === 'prompt' ? 'Prompt note' : kind === 'screenshot' ? 'Screenshot note' : kind === 'call' ? 'Call note' : 'Note'}
            </span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={
                kind === 'call'
                  ? 'Optional note'
                  : kind === 'screenshot'
                    ? 'What does this screenshot show? What needs changing?'
                    : kind === 'prompt'
                      ? 'What is wrong, risky, or interesting about this prompt/node?'
                      : 'Write the note...'
              }
            />
          </label>
          {(kind === 'prompt' || kind === 'screenshot' || kind === 'general') && (
            <label className="field notes-wide">
              <span>{kind === 'prompt' ? 'Prompt / node text' : 'Pasted context'}</span>
              <textarea
                value={pastedText}
                onChange={e => setPastedText(e.target.value)}
                placeholder="Paste prompt text, node config, dashboard copy, or any relevant context..."
              />
            </label>
          )}
        </div>

        <div className="row wrap">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => attachImage(e.target.files?.[0])}
          />
          <button type="button" onClick={() => imageInputRef.current?.click()}>
            Attach screenshot
          </button>
          {image && (
            <button type="button" className="btn-sm" onClick={() => setImage(null)}>
              Remove screenshot
            </button>
          )}
            <button type="button" className="primary" onClick={save}>
            Save note
          </button>
          {message && <span className="muted note-save-message">{message}</span>}
        </div>

        {image && (
          <div className="note-image-preview">
            <img src={image.dataUrl} alt={image.name} />
            <span>{image.name}</span>
          </div>
        )}
      </section>

      <section className="panel notes-filter-panel">
        <div className="row wrap">
          <input
            className="notes-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter by call ID, words in note, prompt text, node text..."
          />
          <select value={filterKind} onChange={e => setFilterKind(e.target.value as WorkspaceNoteKind | 'all')}>
            {kinds.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <span className="muted">{filtered.length} notes</span>
        </div>
      </section>

      <section className="notes-grid">
        {filtered.map(item => {
          const call = findCall(item.call_id);
          return (
            <article className="note-card" key={item.id}>
              <div className="row between wrap">
                <div className="row wrap">
                  <Badge tone={item.kind === 'call' ? 'blue' : item.kind === 'screenshot' ? 'green' : item.kind === 'prompt' ? 'yellow' : 'neutral'}>
                    {item.kind}
                  </Badge>
                  {item.call_id && (
                    <button
                      type="button"
                      className="link-button note-call-link"
                      onClick={() => {
                        const match = findCall(item.call_id);
                        if (match) openCall(match.id);
                      }}
                      disabled={!call}
                      title={call ? `Open ${call.call_id}` : `No saved call matches "${item.call_id}"`}
                    >
                      call {shortCallId(item.call_id)}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => setDb(item.id.startsWith('personal:')
                    ? deletePersonalNote(db, item.id.replace(/^personal:/, ''))
                    : deleteWorkspaceNote(db, item.id))}
                >
                  Delete
                </button>
              </div>
              {item.title && <h2>{item.title}</h2>}
              {item.note && <p>{item.note}</p>}
              {item.image_data_url && <img className="note-card-image" src={item.image_data_url} alt={item.image_name || 'Screenshot'} />}
              {item.pasted_text && <pre className="note-pasted-text">{item.pasted_text}</pre>}
              <p className="meta">{fmtDate(item.created_at)}</p>
            </article>
          );
        })}
        {!filtered.length && (
          <div className="panel empty">
            No notes match this filter.
          </div>
        )}
      </section>
    </main>
  );
}
