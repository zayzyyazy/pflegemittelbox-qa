import { Maximize2, X } from 'lucide-react';

export function FullscreenPanel({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fullscreen-backdrop" onMouseDown={onClose}>
      <div className="fullscreen-panel" onMouseDown={e => e.stopPropagation()}>
        <div className="fullscreen-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} title="Exit fullscreen"><X size={16} /></button>
        </div>
        <div className="fullscreen-body">{children}</div>
      </div>
    </div>
  );
}

export function FullscreenButton({ onClick, label = 'Fullscreen' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn-sm" onClick={e => { e.stopPropagation(); onClick(); }}>
      <Maximize2 size={14} /> {label}
    </button>
  );
}
