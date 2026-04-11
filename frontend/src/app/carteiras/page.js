'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Folder, ChevronDown, Layers, Receipt, Building } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function CarteirasPage() {
  const { user } = useAuth();
  const [carteiras, setCarteiras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openFolders, setOpenFolders] = useState({});

  useEffect(() => {
    async function carregar() {
      try {
        setLoading(true);
        const supabase = createClient();
        
        // 1. Buscar TODOS os perfis (mais seguro para pequenos volumes)
        // 2. Buscar dados da tabela gerentes (para assistentes)
        // 3. Buscar condomínios
        const [ { data: profileList }, { data: gerentesTab }, { data: condos } ] = await Promise.all([
          supabase.from('profiles').select('id, full_name, role'),
          supabase.from('gerentes').select('*'),
          supabase.from('condominios').select('*').order('name')
        ]);
        
        const gerentesMap = {};
        
        // Filtrar gerentes no JS (case-insensitive)
        const profileGerentes = profileList?.filter(p => p.role?.toLowerCase() === 'gerente') || [];
        
        if (profileGerentes.length > 0) {
          profileGerentes.forEach(p => {
            const extra = gerentesTab?.find(g => g.profile_id === p.id) || {};
            gerentesMap[p.id] = { 
                id: p.id, 
                nome: p.full_name || 'Gerente sem Nome', 
                assistente: extra.assistente || '—', 
                condominios: [], 
                count: 0 
            };
          });
        }
        
        const semGerente = { id: 'sem_gerente', nome: 'Sem Gerente Atribuído', assistente: '—', condominios: [], count: 0 };
        
        if (condos) {
          condos.forEach(c => {
            const gid = c.gerente_id;
            // O gerente_id do condomínio pode apontar para o ID do Gerente (tabela gerentes) 
            // ou ID do Perfil. Vamos tentar encontrar no mapa pelo perfil_id.
            if (gid && gerentesMap[gid]) {
              gerentesMap[gid].condominios.push(c);
              gerentesMap[gid].count += 1;
            } else {
              // Fallback: se o gid for da tabela gerentes, buscar qual perfil está lá
              const gExt = gerentesTab?.find(gt => gt.id === gid);
              if (gExt && gerentesMap[gExt.profile_id]) {
                gerentesMap[gExt.profile_id].condominios.push(c);
                gerentesMap[gExt.profile_id].count += 1;
              } else {
                semGerente.condominios.push(c);
                semGerente.count += 1;
              }
            }
          });
        }
        
        let carteirasFormatadas = Object.values(gerentesMap).sort((a, b) => a.nome.localeCompare(b.nome));
        
        // --- RESTRIÇÃO DE ACESSO ---
        if (user?.role === 'gerente') {
          carteirasFormatadas = carteirasFormatadas.filter(c => c.id === user.id);
        } else {
          if (semGerente.count > 0) {
            carteirasFormatadas.push(semGerente);
          }
        }
        
        setCarteiras(carteirasFormatadas);
      } catch (err) {
        console.error('Erro ao carregar carteiras:', err);
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, []);

  function toggleFolder(id) {
    setOpenFolders(prev => ({ ...prev, [id]: !prev[id] }));
  }

  if (loading) return <div className="flex w-full justify-center p-20"><div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div></div>;

  return (
    <div className="animate-fade-in w-full h-full relative">
      <div className="mb-6">
        <h2 className="text-xl font-bold border-b border-slate-800 pb-2 text-white mb-2">Carteiras Ativas</h2>
        <p className="text-sm text-slate-400">Visualize os condomínios organizados por cada gerente responsável.</p>
      </div>

      {carteiras.length === 0 ? (
        <div className="text-center p-12 bg-slate-900 rounded-xl border border-slate-800 shadow-xl">
          <Folder className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-200 mb-1">Nenhuma Carteira Encontrada</h3>
          <p className="text-sm text-slate-400">Ainda não existem condomínios associados a gerentes.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {carteiras.map((c, i) => {
            const isOpen = openFolders[i];
            
            return (
              <div key={i} className={`glass-card text-left overflow-hidden transition-all duration-300
                ${isOpen ? 'ring-1 ring-cyan-500/50 bg-white/5' : ''}`}>
                
                {/* Cabeçalho da Pasta */}
                <button onClick={() => toggleFolder(i)} className="w-full px-5 py-5 flex items-center justify-between text-left focus:outline-none hover:bg-white/5 transition-colors group">
                  <div className="flex items-center gap-5 relative z-10">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all shrink-0
                      ${isOpen ? 'bg-cyan-500/20 border border-cyan-500/30 shadow-[0_0_20px_rgba(34,211,238,0.2)]' : 'bg-white/5 border border-white/10 group-hover:bg-white/10'}`}>
                      <Folder className={`w-6 h-6 transition-colors ${isOpen ? 'text-cyan-400' : 'text-gray-400 group-hover:text-cyan-400'}`} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-300 group-hover:from-cyan-100 group-hover:to-cyan-400 transition-colors">{c.nome}</h3>
                      <p className="text-[11px] uppercase tracking-widest text-violet-400 font-bold mt-1">
                        Assistente: {c.assistente || 'SEM ASSOCIAÇÃO'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 relative z-10">
                    <span className="bg-white/10 text-gray-200 px-4 py-1.5 rounded-full text-xs font-bold border border-white/10 shadow-lg">
                      {c.count} Condomínios
                    </span>
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-all duration-300 ${isOpen ? 'rotate-180 text-cyan-400' : 'group-hover:text-cyan-400'}`} />
                  </div>
                </button>

                {/* Conteúdo da Pasta */}
                {isOpen && (
                  <div className="border-t border-white/5 bg-black/20 animate-fade-in backdrop-blur-md">
                    <div className="p-6 pl-24">
                      {c.condominios?.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {c.condominios.map((condo) => (
                            <div key={condo.id} className="glass-card rounded-2xl p-4 hover:ring-1 hover:ring-cyan-500/50 transition-all group/card">
                              <div className="flex items-start justify-between">
                                <div>
                                  <h4 className="text-sm font-black text-white">{condo.name}</h4>
                                  <p className="text-[10px] text-violet-300/80 uppercase font-bold tracking-widest mt-1">Vencimento: Dia {condo.due_day || '—'}</p>
                                </div>
                                <Building className="w-5 h-5 text-gray-500 group-hover/card:text-cyan-400 drop-shadow-lg" />
                              </div>
                              <div className="mt-5 flex gap-3">
                                <Link href={`/condominio/${condo.id}/arrecadacoes`} className="flex-1 text-center bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs font-bold py-2 rounded-xl border border-cyan-500/20 flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(34,211,238,0.1)] hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]">
                                  <Layers className="w-4 h-4" /> Arrecadações
                                </Link>
                                <Link href={`/condominio/${condo.id}/cobrancas`} className="flex-1 text-center bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs font-bold py-2 rounded-xl border border-orange-500/20 flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(249,115,22,0.1)] hover:shadow-[0_0_20px_rgba(249,115,22,0.3)]">
                                  <Receipt className="w-4 h-4" /> Extras
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-400 text-sm py-4 italic font-medium">Nenhuma operação designada a este gerente ainda.</div>
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
