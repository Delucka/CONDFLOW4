'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';

/**
 * Alterna entre tema claro e escuro.
 * O tema é aplicado adicionando/removendo a classe `dark` em <html> e
 * persistido em localStorage. O script no <head> (layout.js) aplica antes
 * de pintar, evitando o flash de tema errado ao recarregar.
 */
// A verdade sobre o tema e a classe `dark` no <html> — quem a aplica antes de
// pintar e o script do <head>. Copiar isso para dentro de um estado obrigava um
// efeito para sincronizar, e desincronizava se outro lugar mexesse no tema.
//
// `useSyncExternalStore` le a fonte direto e ainda avisa quando ela muda: o
// MutationObserver faz o botao acompanhar qualquer troca de tema, venha de onde
// vier. O terceiro argumento e o valor do servidor, que nao tem DOM.
function assinarTema(aoMudar) {
  const obs = new MutationObserver(aoMudar);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}
const lerTema = () => document.documentElement.classList.contains('dark');

export default function ThemeToggle({ collapsed }) {
  const dark = useSyncExternalStore(assinarTema, lerTema, () => false);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch {}
  }

  const label = dark ? 'Modo claro' : 'Modo escuro';
  return (
    <button
      onClick={toggle}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-slate-100 hover:text-violet-600 transition-colors font-bold w-full ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {dark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
      {!collapsed && label}
    </button>
  );
}
