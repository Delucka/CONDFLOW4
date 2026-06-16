'use client';
import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Prende o foco do teclado dentro de `ref` enquanto `active`. Foca o 1º elemento
// ao abrir, devolve o foco ao elemento anterior ao fechar, e chama onEscape no Esc.
// O contêiner deve ter tabIndex={-1} para servir de fallback de foco.
export function useFocusTrap(ref, active, onEscape) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const node = ref.current;
    const prevFocused = typeof document !== 'undefined' ? document.activeElement : null;

    const focusables = () =>
      Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
      );

    // Foca o primeiro elemento (ou o próprio contêiner)
    const first = focusables()[0];
    (first || node).focus?.();

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (f.length === 0) {
        e.preventDefault();
        node.focus?.();
        return;
      }
      const firstEl = f[0];
      const lastEl = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === node)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      if (prevFocused && typeof prevFocused.focus === 'function') prevFocused.focus();
    };
  }, [ref, active, onEscape]);
}
