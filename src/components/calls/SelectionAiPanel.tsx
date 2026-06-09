import { useState } from 'react';
import type { Database } from '../../services/storageService';
import type { CallReview, TranscriptSegment } from '../../types/CallReview';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { Modal } from '../ui/Modal';
import {
  askAboutSelection,
  generateHighlightNoteDraft,
  type SuggestedHighlightNote
} from '../../services/selectionAiService';
import { id } from '../../utils/text';
import { nowIso } from '../../utils/dates';
import { inferEvidenceMetadata } from '../../utils/inferEvidence';

export function SelectionAiPanel({
  call,
  db,
  excerpt,
  segment,
  draftEvidence,
  onApplyNote,
  onClose
}: {
  call: CallReview;
  db: Database;
  excerpt: string;
  segment: TranscriptSegment;
  draftEvidence?: EvidenceMoment;
  onApplyNote: (moment: EvidenceMoment) => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [suggested, setSuggested] = useState<SuggestedHighlightNote | undefined>();

  async function send(custom?: string) {
    const q = (custom || question).trim();
    if (!q) return;
    setBusy(true);
    setErr('');
    setMessages(m => [...m, { role: 'user', text: q }]);
    setQuestion('');
    try {
      const res = await askAboutSelection(db.settings, db, call, excerpt, q, segment);
      setMessages(m => [...m, { role: 'assistant', text: res.answer }]);
      if (res.suggested_note) setSuggested(res.suggested_note);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'AI request failed');
    } finally {
      setBusy(false);
    }
  }

  async function generateNote() {
    setBusy(true);
    setErr('');
    try {
      const res = await generateHighlightNoteDraft(db.settings, db, call, excerpt, segment);
      setSuggested(res.suggested_note);
      if (res.answer) setMessages(m => [...m, { role: 'assistant', text: res.answer }]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not generate note');
    } finally {
      setBusy(false);
    }
  }

  function applyNote() {
    const base = suggested;
    const now = nowIso();
    const label = base?.explanation?.split('.')[0]?.slice(0, 80) || 'AI-assisted note';
    const draft: Partial<EvidenceMoment> = {
      call_id: call.id,
      speaker: base?.speaker || segment.speaker || 'unknown',
      moment_type: base?.moment_type || 'manual_highlight',
      severity: base?.severity || 'medium',
      timestamp_start_seconds: segment.start,
      timestamp_end_seconds: segment.end,
      quote_or_transcript_excerpt: excerpt.slice(0, 280),
      reviewer_label: label,
      reviewer_note: base?.explanation || '',
      explanation: base?.explanation || '',
      source: 'manual'
    };
    const inferred = inferEvidenceMetadata(draft, call);
    const moment: EvidenceMoment = {
      id: draftEvidence?.id || id('ev'),
      ...draft,
      ...inferred,
      recommended_fix: base?.recommended_fix || inferred.recommended_fix || '',
      customer_impact: base?.customer_impact || '',
      engineering_impact: base?.engineering_impact || '',
      voice_cue_notes: '',
      reviewer_flag: base?.reviewer_flag,
      created_at: draftEvidence?.created_at || now,
      updated_at: now
    } as EvidenceMoment;
    onApplyNote(moment);
    onClose();
  }

  return (
    <Modal title="Discuss selection with AI" onClose={onClose} wide stacked>
      <blockquote className="highlight-quote">{excerpt}</blockquote>

      <div className="selection-ai-thread">
        {messages.map((m, i) => (
          <div key={i} className={`thread-msg ${m.role}`}>
            <span className="thread-role">{m.role === 'user' ? 'You' : 'AI'}</span>
            <pre>{m.text}</pre>
          </div>
        ))}
      </div>

      <textarea
        rows={2}
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="Ask about this moment — e.g. why does this matter, was auth normal here?"
      />
      <div className="row wrap">
        <button type="button" className="primary" disabled={busy || !question.trim()} onClick={() => send()}>
          {busy ? 'Thinking…' : 'Send'}
        </button>
        <button type="button" className="btn-sm" disabled={busy} onClick={generateNote}>
          Generate highlight note
        </button>
      </div>

      {suggested && (
        <section className="panel inset suggested-note-preview">
          <h4>Suggested highlight note</h4>
          <p><b>Type:</b> {suggested.moment_type.replace(/_/g, ' ')} · <b>Severity:</b> {suggested.severity}</p>
          <p>{suggested.explanation}</p>
          {suggested.recommended_fix && <p><b>Fix:</b> {suggested.recommended_fix}</p>}
          <button type="button" className="primary" onClick={applyNote}>
            Apply note to transcript & timeline
          </button>
        </section>
      )}

      {err && <p className="error">{err}</p>}

      <div className="row end">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
