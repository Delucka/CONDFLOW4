'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { apiFetcher } from '@/lib/api';
import { Folder, ChevronDown, Layers, Receipt, Building, Info } from 'lucide-react';
import Link from 'next/link';

export default function CarteirasPage() {
  const [openFolders, setOpenFolders] = useState({});
  const { data, error, isLoading } = useSWR('/api/carteiras', apiFetcher);

  function toggleFolder(id) {
    setOpenFolders(prev => ({ ...prev, [id]: !prev[id] }));
  }

  if (error) return (
    <div className="p-12 text-center glass-panel rounded-3xl">
      <Info className="w-12 h-12 text-orange-500 mx-auto mb-4" />
      <p className="text-white font-bold">Erro ao carregar carteiras</p>
      <p className="text-slate-400 text-sm">Verifique sua conexão com o servidor.</p>
    </div>
  );

  const carteiras = data?.carteiras || [];

  return (
    <div className="animate-fade-in w-full h-full relative space-y-6">
      <div className="mb-8">
        <h2 className="text-3xl font-black text-white tracking-tight">Carteiras de Gestão</h2>
        <div className="w-16 h-1 bg-cyan-500 rounded-full mt-2"></div>
        <p className="text-slate-400 mt-4 text-sm font-medium">Condomínios organizados por Gerente e Assistente Responsável.</p>
      </div>

      {isLoading ? (
        <div className="p-24 text-center">
          <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm font-bold text-slate-500 tracking-widest uppercase">Mapeando Pastas...</p>
        </div>
      ) : carteiras.length === 0 ? (
        <div className="text-center p-20 glass-panel rounded-3xl">
          <Folder className="w-12 h-12 text-slate-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-200 mb-1">Nenhuma Carteira Ativa</h3>
          <p className="text-sm text-slate-500">Não encontramos pastas de gerentes vinculadas a condomínios.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {carteiras.map((c, i) => {
            const isOpen = openFolders[i];
            
            return (
              <div key={i} className={`glass-card overflow-hidden transition-all duration-500 rounded-3xl
                ${isOpen ? 'ring-2 ring-cyan-500/30 bg-white/5' : 'bg-white/[0.02] border-white/5'}`}>
                
                {/* Cabeçalho da Pasta */}
                <button onClick={() => toggleFolder(i)} className="w-full px-6 py-6 flex items-center justify-between text-left group">
                  <div className="flex items-center gap-6 relative z-10">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-500 shadow-2xl
                      ${isOpen ? 'bg-cyan-500 text-slate-950 rotate-3 scale-110' : 'bg-slate-800 border border-white/10 group-hover:bg-slate-700'}`}>
                      <Folder className={`w-8 h-8 transition-colors ${isOpen ? 'text-slate-950' : 'text-slate-400 group-hover:text-cyan-400'}`} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-white group-hover:text-cyan-400 transition-colors">{c.nome}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] uppercase tracking-widest text-violet-400 font-black">Assistente:</span>
                        <span className="text-xs text-gray-400 font-bold">{c.assistente || 'NÃO DEFINIDO'}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 relative z-10">
                    <div className="hidden sm:block text-right">
                       <p className="text-lg font-black text-white leading-none">{c.count}</p>
                       <p className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">Condomínios</p>
                    </div>
                    <div className={`p-2 rounded-full bg-white/5 border border-white/5 text-slate-500 group-hover:text-cyan-400 transition-all ${isOpen ? 'rotate-180 bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : ''}`}>
                         <ChevronDown className="w-5 h-5" />
                    </div>
                  </div>
                </button>

                {/* Conteúdo da Pasta */}
                {isOpen && (
                  <div className="border-t border-white/5 bg-black/40 animate-fade-in">
                    <div className="p-8">
                      {c.condominios?.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                          {c.condominios.map((condo) => (
                            <div key={condo.id} className="bg-white/5 border border-white/5 rounded-[2rem] p-6 hover:border-cyan-500/50 transition-all group/card shadow-xl">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <h4 className="text-lg font-black text-white uppercase tracking-tight leading-tight">{condo.name}</h4>
                                  <p className="text-[10px] text-cyan-500/80 uppercase font-black tracking-widest">DIA {condo.due_day || '—'} • VENCIMENTO</p>
                                </div>
                                <div className="p-3 bg-slate-900 rounded-2xl group-hover/card:bg-cyan-500/20 group-hover/card:text-cyan-400 transition-all text-slate-600 shadow-inner">
                                     <Building className="w-5 h-5" />
                                </div>
                              </div>
                              <div className="mt-8 flex gap-3">
                                <Link href={`/condominio/${condo.id}/arrecadacoes`} className="flex-1 text-center bg-cyan-500 text-slate-950 text-[11px] font-black py-3 rounded-2xl flex items-center justify-center gap-2 transition-all hover:bg-cyan-400 hover:scale-[1.02] shadow-lg shadow-cyan-500/10 active:scale-95">
                                  <Layers className="w-4 h-4" /> ARRECADAÇÕES
                                </Link>
                                <Link href={`/condominio/${condo.id}/cobrancas`} className="flex-1 text-center bg-transparent text-orange-400 text-[11px] font-black py-3 rounded-2xl border border-orange-500/30 flex items-center justify-center gap-2 transition-all hover:bg-orange-500/10 hover:border-orange-500 active:scale-95">
                                  <Receipt className="w-4 h-4" /> EXTRAS
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-slate-900/40 rounded-3xl border border-dashed border-white/5">
                            <p className="text-slate-500 text-sm font-medium italic">Nenhum condomínio ativo nesta carteira.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
