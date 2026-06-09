import type { MouseEvent, ReactNode } from 'react';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  stacked = false
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  stacked?: boolean;
}) {
  function backdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className={`modal-backdrop${stacked ? ' stacked' : ''}`}
      onClick={backdropClick}
      role="presentation"
    >
      <div
        className={`modal${wide ? ' wide' : ''}`}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
