'use client';
import { useState, useMemo, useEffect } from 'react';
import { usePlanoContas } from '@/lib/usePlanoContas';
import { Search, X, ChevronDown, ChevronRight, Loader2, FolderOpen, FileText, Check } from 'lucide-react';

/**
 * Modal de seleção de conta contábil (estilo Ahreas).
 *
 * Props:
 *   - planoId: UUID do plano (default: primeiro ativo)
 *   - onSelect: (item) => void   recebe o item escolhido
 *   - onClose: () => void
 *   - selectedId?: string        UUID do item atualmente selecionado (highlight)
 */
export default function ModalSelecionarConta({ planoId, onSelect, onClose, selectedId }) {
  const { plano, arvore, loading } = usePlanoContas(planoId);
  const [busca, setBusca]                 = useState('');
  const [expandidos, setExpandidos]       = useState({}); // { grupoId: true, sinteticaId: true }
  const [mostrarSoSinteticas, setMostrarSoSinteticas] = useState(false);

  // Filtra árvore pela busca textual (busca em nome + código reduzido)
  const arvoreFiltrada = useMemo(() => {
    if (!busca.trim()) return arvore;
    const q = busca.toLowerCase().trim();

    const matchItem = (it) =>
      it.nome.toLowerCase().includes(q) ||
      String(it.codigo_reduzido).includes(q);

    return arvore.map(grupo => {
      const filhosFiltrados = (grupo.filhos || []).map(sint => {
        const analiticasFiltradas = (sint.filhos || []).filter(matchItem);
        if (matchItem(sint) || analiticasFiltradas.length > 0) {
          return { ...sint, filhos: analiticasFiltradas, _matchSelf: matchItem(sint) };
        }
        return null;
      }).filter(Boolean);

      if (matchItem(grupo) || filhosFiltrados.length > 0) {
        return { ...grupo, filhos: filhosFiltrados, _matchSelf: matchItem(grupo) };
      }
      return null;
    }).filter(Boolean);
  }, [arvore, busca]);

  // Auto-expande grupos quando há busca
  useEffect(() => {
    if (busca.trim()) {
      const exp = {};
      arvoreFiltrada.forEach(g => { exp[g.id] = true; g.filhos.forEach(s => { exp[s.id] = true; }); });
      setExpandidos(exp);
    }
  }, [busca, arvoreFiltrada]);

  function toggle(id) {
    setExpandidos(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function selecionar(item) {
    onSelect?.(item);
    onClose?.();
  }

  function codigoFmt(it) {
    const g = String(it.codigo_grupo).padStart(2, '0');
    const s = String(it.codigo_subconta).padStart(3, '0');
    const a = String(it.codigo_analitico).padStart(2, '0');
    return `${g}.${s} - ${a}`;
  }

  // Conta total visível (debug/info)
  const totalContas = useMemo(() => {
    let c = 0;
    for (const g of arvoreFiltrada) {
      for (const s of g.filhos) {
        if (!mostrarSoSinteticas || s.natureza === 'Sintética') c++;
        for (const a of (s.filhos || [])) {
          if (!mostrarSoSinteticas) c++;
        }
      }
    }
    return c;
  }, [arvoreFiltrada, mostrarSoSinteticas]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Selecionar Conta Contábil</h3>
            <p className="text-[10px] text-gray-500 mt-1 font-bold uppercase tracking-widest">
              {plano ? `Plano ${plano.codigo} — ${plano.nome}` : 'Carregando plano...'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-2"><X className="w-5 h-5" /></button>
        </div>

        {/* Busca + toggles */}
        <div className="px-6 py-4 border-b border-white/10 space-y-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              autoFocus
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou código (ex: condominio, 86)"
              className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-white/10 rounded-xl text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 outline-none transition-all"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mostrarSoSinteticas}
              onChange={(e) => setMostrarSoSinteticas(e.target.checked)}
              className="accent-cyan-500"
            />
            <span className="text-xs text-gray-400">Mostrar só sintéticas (esconder analíticas)</span>
          </label>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="p-12 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          ) : arvoreFiltrada.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">
              {busca ? 'Nenhuma conta encontrada com esse filtro.' : 'Nenhuma conta cadastrada neste plano.'}
            </div>
          ) : (
            <div className="py-2">
              {arvoreFiltrada.map(grupo => (
                <div key={grupo.id} className="border-b border-white/5 last:border-b-0">
                  {/* GRUPO (1º grau) */}
                  <button
                    onClick={() => toggle(grupo.id)}
                    className="w-full flex items-center gap-2 px-6 py-3 hover:bg-white/5 transition-colors text-left"
                  >
                    {expandidos[grupo.id] ? <ChevronDown className="w-4 h-4 text-violet-400" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    <FolderOpen className="w-4 h-4 text-violet-400/70" />
                    <span className="text-[10px] font-mono font-black text-violet-300 tracking-wider">{String(grupo.codigo_grupo).padStart(2,'0')}</span>
                    <span className="text-sm font-black text-white uppercase tracking-tight ml-2">{grupo.nome}</span>
                    <span className="ml-auto text-[10px] text-gray-600 font-bold">
                      {grupo.codigo_reduzido} · {grupo.filhos.length} sub
                    </span>
                  </button>

                  {/* SUBCONTAS */}
                  {expandidos[grupo.id] && (
                    <div className="bg-black/20 pl-6">
                      {grupo.filhos.map(sint => {
                        const temAnaliticas = (sint.filhos || []).length > 0 && !mostrarSoSinteticas;
                        const ehSelecionada = sint.id === selectedId;
                        return (
                          <div key={sint.id}>
                            <div
                              className={`flex items-center gap-2 px-4 py-2 hover:bg-cyan-500/5 cursor-pointer transition-colors border-l-2 ${
                                ehSelecionada ? 'border-cyan-400 bg-cyan-500/10' : 'border-transparent'
                              }`}
                            >
                              <div onClick={() => temAnaliticas && toggle(sint.id)} className="shrink-0">
                                {temAnaliticas
                                  ? (expandidos[sint.id] ? <ChevronDown className="w-3 h-3 text-cyan-500/70" /> : <ChevronRight className="w-3 h-3 text-gray-600" />)
                                  : <span className="w-3 h-3 inline-block" />}
                              </div>
                              <button
                                onClick={() => selecionar(sint)}
                                className="flex-1 flex items-center gap-2 text-left"
                              >
                                <FileText className="w-3.5 h-3.5 text-blue-400/70 shrink-0" />
                                <span className="text-[10px] font-mono text-blue-400 tracking-wider shrink-0">
                                  {codigoFmt(sint)}
                                </span>
                                <span className="text-xs text-slate-300 truncate">{sint.nome}</span>
                                <span className="ml-auto text-[9px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded shrink-0">
                                  #{sint.codigo_reduzido}
                                </span>
                                {ehSelecionada && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                              </button>
                            </div>

                            {/* ANALÍTICAS */}
                            {temAnaliticas && expandidos[sint.id] && (
                              <div className="bg-black/30 pl-6 border-l border-white/5">
                                {sint.filhos.map(ana => {
                                  const ehSelAna = ana.id === selectedId;
                                  return (
                                    <button
                                      key={ana.id}
                                      onClick={() => selecionar(ana)}
                                      className={`w-full flex items-center gap-2 px-4 py-1.5 hover:bg-cyan-500/5 transition-colors text-left border-l-2 ${
                                        ehSelAna ? 'border-cyan-400 bg-cyan-500/10' : 'border-transparent'
                                      }`}
                                    >
                                      <span className="w-3" />
                                      <span className="text-[10px] font-mono text-purple-400/80 tracking-wider shrink-0">
                                        {codigoFmt(ana)}
                                      </span>
                                      <span className="text-[11px] text-slate-400 italic truncate">{ana.nome}</span>
                                      <span className="ml-auto text-[9px] font-bold text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded shrink-0">
                                        #{ana.codigo_reduzido}
                                      </span>
                                      {ehSelAna && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {grupo.filhos.length === 0 && (
                        <div className="px-4 py-2 text-[10px] text-gray-600 italic">Nenhuma subconta neste grupo</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between shrink-0 text-[10px] text-gray-500 font-bold uppercase tracking-widest">
          <span>{totalContas} conta{totalContas !== 1 ? 's' : ''} {busca ? 'encontrada' + (totalContas !== 1 ? 's' : '') : ''}</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-violet-400" /> Grupo</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-400" /> Sintética</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-purple-400" /> Analítica</span>
          </div>
        </div>
      </div>
    </div>
  );
}
