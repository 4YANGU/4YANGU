import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { clearHistoryFlag, pushBackHandler, pushHistoryFlag } from '../lib/backNavigation';

export default function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    const previousOverflow = document.body.style.overflow;
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    pushHistoryFlag('stoyanguModal');
    const removeBackHandler = pushBackHandler(() => { onCloseRef.current(); return true; });
    return () => {
      document.removeEventListener('keydown', close);
      document.body.style.overflow = previousOverflow;
      removeBackHandler();
      clearHistoryFlag('stoyanguModal');
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-panel ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <div><span className="eyebrow">StoYangu workspace</span><h2 id="modal-title">{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}
