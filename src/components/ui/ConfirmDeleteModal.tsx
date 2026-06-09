import { useState } from 'react';
import { Modal } from './Modal';

export function ConfirmDeleteModal({
  title,
  description,
  confirmLabel = 'Delete permanently',
  onCancel,
  onConfirm
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <Modal title={title} onClose={onCancel} stacked>
      <p className="muted">{description}</p>
      {!armed ? (
        <div className="row end">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-danger-soft" onClick={() => setArmed(true)}>
            Continue
          </button>
        </div>
      ) : (
        <div className="confirm-armed">
          <p>
            <b>Second confirmation required.</b> This cannot be undone.
          </p>
          <div className="row end">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                onConfirm();
                onCancel();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
