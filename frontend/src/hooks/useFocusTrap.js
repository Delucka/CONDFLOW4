'use client';
import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Prende o foco do teclado dentro de `ref` enquanto `active`. Foca o 1º elemento
// ao abrir, devolve o foco ao elemento anterior ao fechar, e chama onEscape no Esc.
// O contêiner deve ter tabIndex={-1} para servir de fallback de foco.
export function useFocusTrap(ref, active, onEscape) {
  // O callback fica num ref de propósito. Se `onEscape` entrar nas dependências do
  // efeito abaixo, uma arrow inline (onClose={() => setOpen(false)}) vira função
  // NOVA a cada render: o efeito roda de novo, devolve o foco pro primeiro elemento
  // e o usuário perde o cursor a cada tecla — impossível digitar num formulário.
  const escapeRef = useRef(onEscape);
  useEffect(() => { escapeRef.current = onEscape; }, [onEscape]);

  useEffect(() => {
    if (!active || !ref.current) return;
    const node = ref.current;
    const prevFocused = typeof document !== 'undefined' ? document.activeElement : null;

    const focusables = () =>
      Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
      );

    // Foco inicial: quem pedir explicitamente (data-autofocus), senão o primeiro
    // elemento que não seja o "fechar" — abrir um formulário com o foco no X faz
    // o Enter fechar a janela em vez de enviar.
    const lista = focusables();
    const alvo =
      node.querySelector('[data-autofocus]') ||
      lista.find((el) => !el.hasAttribute('data-modal-dismiss')) ||
      lista[0];
    (alvo || node).focus?.();

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current?.();
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
    // `onEscape` fica FORA daqui de propósito — ver a nota do escapeRef acima.
  }, [ref, active]);
}
