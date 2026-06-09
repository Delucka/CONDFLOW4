'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

/**
 * Alterna entre tema claro e escuro.
 * O tema é aplicado adicionando/removendo a classe `dark` em <html> e
 * persistido em localStorage. O script no <head> (layout.js) aplica antes
 * de pintar, evitando o flash de tema errado ao recarregar.
 */
export default function ThemeToggle({ collapsed }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
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
