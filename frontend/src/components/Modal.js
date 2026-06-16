'use client';
import { useRef, useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

/**
 * Modal acessível e mobile-first.
 * - role="dialog" + aria-modal + aria-labelledby (quando tem title)
 * - foco preso (Tab/Shift+Tab), Escape e clique no backdrop fecham
 * - trava o scroll do body; devolve o foco ao fechar
 * - no celular vira "bottom sheet" (largura cheia, cantos só em cima); no desktop, card centralizado
 */
export default function Modal({
  open = true,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  className = '',
  hideClose = false,
}) {
  const ref = useRef(null);
  const labelId = useId();
  useFocusTrap(ref, open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelId : undefined}
        onClick={(e) => e.stopPropagation()}
        className={`bg-white border border-slate-200 shadow-2xl outline-none w-full ${maxWidth} max-h-[92vh] sm:max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl ${className}`}
      >
        {(title || !hideClose) && (
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
            {title ? <h2 id={labelId} className="text-base font-bold text-slate-900 truncate">{title}</h2> : <span />}
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="tap shrink-0 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
