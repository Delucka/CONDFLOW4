'use client';
import { useState, useMemo, useRef, useEffect, useId } from 'react';
import { combina, comparaPorCodigo } from '@/lib/busca';
import { Search, X, Check, ChevronDown } from 'lucide-react';

/**
 * Escolher um condomínio entre 325 — digitando, não rolando.
 *
 * Era um `<select>` nativo. Com essa quantidade, achar um item exige rolar uma
 * lista enorme ou acertar as primeiras letras exatas, com acento e tudo: o
 * `<select>` casa por prefixo literal, então "sao" não acha "SÃO" e "2" não
 * acha "002".
 *
 * A busca sai de `lib/busca.js`, a mesma do resto do sistema — casa sem acento,
 * em qualquer ordem de palavras ("caioba 002" acha "002 - COND. ED. CAIOBA") e
 * entende o código com zero à esquerda. A ordem é por código numérico, para
 * "0001" não cair depois de "474".
 */
export default function SeletorCondominio({
  condos = [], value, onChange, label = 'Condomínio', placeholder = 'Digite o número ou o nome…',
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [marcado, setMarcado] = useState(0);
  const caixaRef = useRef(null);
  const listaRef = useRef(null);
  const id = useId();

  const escolhido = condos.find((c) => c.id === value) || null;

  const filtrados = useMemo(() => {
    const base = [...condos].sort((a, b) => comparaPorCodigo(a.name, b.name));
    // Com a lista fechada ou sem termo, mostra tudo: o campo também serve para
    // navegar, não só para filtrar.
    return termo ? base.filter((c) => combina(termo, c.name)) : base;
  }, [condos, termo]);

  // Fecha ao clicar fora. Sem isto a lista fica pendurada sobre o resto da tela.
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (caixaRef.current && !caixaRef.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  // Mantém o item marcado à vista enquanto se navega pelo teclado.
  useEffect(() => {
    if (!aberto || !listaRef.current) return;
    const alvo = listaRef.current.querySelector(`[data-i="${marcado}"]`);
    alvo?.scrollIntoView({ block: 'nearest' });
  }, [marcado, aberto]);

  const escolher = (c) => {
    onChange(c ? c.id : '');
    setTermo('');
    setAberto(false);
  };

  const noTeclado = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) { setAberto(true); return; }
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      setMarcado((i) => Math.max(0, Math.min(filtrados.length - 1, i + passo)));
    } else if (e.key === 'Enter') {
      if (aberto && filtrados[marcado]) { e.preventDefault(); escolher(filtrados[marcado]); }
    } else if (e.key === 'Escape') {
      setAberto(false);
    }
  };

  return (
    <div className="relative" ref={caixaRef}>
      <label htmlFor={id} className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</label>

      <div className="relative mt-1">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          autoComplete="off"
          value={aberto ? termo : (escolhido?.name || '')}
          placeholder={escolhido ? escolhido.name : placeholder}
          onFocus={() => { setAberto(true); setMarcado(0); }}
          onChange={(e) => { setTermo(e.target.value); setAberto(true); setMarcado(0); }}
          onKeyDown={noTeclado}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-16 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60"
        />
        {escolhido && (
          <button type="button" onClick={() => escolher(null)} aria-label="Limpar condomínio"
            className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700">
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
      </div>

      {aberto && (
        <ul
          id={`${id}-lista`}
          role="listbox"
          ref={listaRef}
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl py-1"
        >
          {filtrados.length === 0 ? (
            <li className="px-3 py-3 text-xs text-slate-500">Nenhum condomínio com esse termo.</li>
          ) : filtrados.map((c, i) => (
            <li key={c.id} data-i={i} role="option" aria-selected={c.id === value}>
              <button
                type="button"
                onMouseEnter={() => setMarcado(i)}
                onClick={() => escolher(c)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  i === marcado ? 'bg-violet-50 text-slate-900' : 'text-slate-700'}`}
              >
                <Check className={`w-3.5 h-3.5 shrink-0 ${c.id === value ? 'text-violet-600' : 'text-transparent'}`} aria-hidden="true" />
                <span className="truncate">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {aberto && termo && (
        <p className="absolute -bottom-4 left-0 text-[10px] text-slate-400">
          {filtrados.length} de {condos.length}
        </p>
      )}
    </div>
  );
}
