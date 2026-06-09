import { useState } from 'react';
import type { EvidenceMoment } from '../../types/EvidenceMoment';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';

export function LightweightEvidenceModal({
  draft,
  segmentCount,
  onCancel,
  onSave
}: {
  draft: EvidenceMoment;
  segmentCount: number;
  onCancel: () => void;
  onSave: (label: string, note: string) => void;
}) {
  const [label, setLabel] = useState(draft.reviewer_label || '');
  const [note, setNote] = useState(draft.reviewer_note || '');

  return (
    <Modal title="Create evidence" onClose={onCancel} stacked>
      <p className="muted">
        {segmentCount > 1
          ? `${segmentCount} transcript lines selected — timestamps merge on save.`
          : 'One transcript line selected.'}
      </p>
      <blockquote className="highlight-quote">{draft.quote_or_transcript_excerpt}</blockquote>
      <Field label="Label">
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Repeated DOB ask"
          autoFocus
        />
      </Field>
      <Field label="Optional note">
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What happened? Why does it matter?"
          rows={3}
        />
      </Field>
      <p className="muted" style={{ fontSize: 12 }}>
        Category, severity, and issue links are inferred after save. Use Investigate for deeper AI help.
      </p>
      <div className="row end">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!label.trim()}
          onClick={() => onSave(label.trim(), note.trim())}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
