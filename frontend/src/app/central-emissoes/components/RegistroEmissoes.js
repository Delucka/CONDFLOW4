'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Archive, Search, Calendar, Eye, RefreshCw, ChevronLeft, ChevronRight, X, Lock, FileText, AlertTriangle, Loader2, Building, Download } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export default function RegistroEmissoes() {
  const supabase = createClient();
  const { profile } = useAuth();
  const { addToast } = useToast();

  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [competencia, setCompetencia] = useState('');
  const [pagina, setPagina] = useState(1);
  const ITENS_POR_PAGINA = 10;

  // Modal retificação
  const [showRetifModal, setShowRetifModal] = useState(false);
  const [retifPacote, setRetifPacote] = useState(null);
  const [retifMotivo, setRetifMotivo] = useState('');
  const [retifDescricao, setRetifDescricao] = useState('');
  const [retifSubmitting, setRetifSubmitting] = useState(false);

  // Modal arquivos
  const [showArqModal, setShowArqModal] = useState(false);
  const [arqPacote, setArqPacote] = useState(null);

  async function fetchRegistradas() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('emissoes_pacotes')
        .select('*, condominios(name)')
        .eq('lacrada', true)
        .order('lacrada_em', { ascending: false });

      if (error) { addToast('Erro ao carregar registros: ' + error.message, 'error'); return; }

      // Buscar arquivos
      const ids = (data || []).map(p => p.id);
      let arqMap = {};
      if (ids.length > 0) {
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato')
          .in('pacote_id', ids);
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });
      }

      setPacotes((data || []).map(p => ({ ...p, arquivos: arqMap[p.id] || [] })));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { fetchRegistradas(); }, []);

  const competenciasDisponiveis = useMemo(() => {
    const set = new Set();
    pacotes.forEach(p => set.add(`${String(p.mes_referencia).padStart(2,'0')}/${p.ano_referencia}`));
    return Array.from(set).sort().reverse();
  }, [pacotes]);

  const pacotesFiltrados = useMemo(() => {
    return pacotes.filter(p => {
      if (busca) {
        const nome = (p.condominios?.name || '').toLowerCase();
        if (!nome.includes(busca.toLowerCase())) return false;
      }
      if (competencia) {
        const [mes, ano] = competencia.split('/');
        if (String(p.mes_referencia).padStart(2,'0') !== mes || String(p.ano_referencia) !== ano) return false;
      }
      return true;
    });
  }, [pacotes, busca, competencia]);

  const totalPaginas = Math.ceil(pacotesFiltrados.length / ITENS_POR_PAGINA);
  const pacotesPaginados = pacotesFiltrados.slice((pagina - 1) * ITENS_POR_PAGINA, pagina * ITENS_POR_PAGINA);
  const temFiltros = busca || competencia;
  const canRetif = ['master', 'departamento'].includes(profile?.role);

  function limparFiltros() { setBusca(''); setCompetencia(''); setPagina(1); }

  async function handleSolicitarRetif() {
    if (!retifMotivo) return addToast('Selecione o motivo', 'error');
    if (retifDescricao.length < 30) return addToast('Descrição precisa ter pelo menos 30 caracteres', 'error');
    setRetifSubmitting(true);
    try {
      const { error } = await supabase.from('emissoes_retificacoes').insert({
        pacote_original_id: retifPacote.id,
        motivo: retifMotivo,
        descricao_detalhada: retifDescricao,
        solicitado_por: profile.id,
      });
      if (error) throw error;
      addToast('Retificação solicitada com sucesso!', 'success');
      setShowRetifModal(false);
      setRetifPacote(null); setRetifMotivo(''); setRetifDescricao('');
    } catch (e) { addToast('Erro: ' + e.message, 'error'); }
    finally { setRetifSubmitting(false); }
  }

  async function openFileUrl(arq) {
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(arq.arquivo_url, 300);
    if (error || !data?.signedUrl) return addToast('Erro ao abrir arquivo', 'error');
    window.open(data.signedUrl, '_blank');
  }

  async function handleDownloadZip(pacote) {
    addToast('Preparando download...', 'info');
    try {
      const zip = new JSZip();
      for (const arq of (pacote.arquivos || [])) {
        const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(arq.arquivo_url, 300);
        if (error || !data?.signedUrl) continue;
        const resp = await fetch(data.signedUrl);
        const blob = await resp.blob();
        zip.file(arq.arquivo_nome, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const nome = `${(pacote.condominios?.name || 'pacote').replace(/\s+/g, '_')}_${String(pacote.mes_referencia).padStart(2,'0')}-${pacote.ano_referencia}.zip`;
      saveAs(content, nome);
      addToast('Download concluído!', 'success');
    } catch (e) {
      addToast('Erro no download: ' + e.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header com stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-6 border border-white/10 rounded-3xl bg-[#0a0a0f] flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
            <Lock className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-3xl font-black text-white">{pacotes.length}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Emissões Lacradas</p>
          </div>
        </div>
        <div className="p-6 border border-white/10 rounded-3xl bg-[#0a0a0f] flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
            <RefreshCw className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <p className="text-3xl font-black text-white">{pacotes.filter(p => p.eh_retificacao).length}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Retificações</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="border border-white/10 rounded-3xl bg-white/5 p-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Buscar Condomínio</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); }}
                placeholder="Nome do condomínio..."
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm text-white outline-none focus:border-emerald-500 transition-all placeholder:text-gray-700" />
            </div>
          </div>
          <div className="min-w-[160px]">
            <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Competência</label>
            <select value={competencia} onChange={e => { setCompetencia(e.target.value); setPagina(1); }}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-emerald-500 transition-all appearance-none">
              <option value="" className="bg-[#0a0a0f]">Todas</option>
              {competenciasDisponiveis.map(c => <option key={c} value={c} className="bg-[#0a0a0f]">{c}</option>)}
            </select>
          </div>
          {temFiltros && (
            <button onClick={limparFiltros} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-gray-400 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2">
              <X className="w-3 h-3" /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="border border-white/10 rounded-3xl bg-white/5 overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 flex items-center gap-4">
          <Archive className="w-5 h-5 text-emerald-400" />
          <h3 className="font-black text-white text-lg">Registro de Emissões Lacradas</h3>
          <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
            {pacotesFiltrados.length} registro{pacotesFiltrados.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Carregando registros...</p>
          </div>
        ) : pacotesFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 border border-white/10">
              <Archive className="w-8 h-8 text-gray-600" />
            </div>
            <h4 className="text-white font-black text-lg">Nenhum registro encontrado</h4>
            <p className="text-xs text-gray-500 max-w-[250px] mt-2">
              {temFiltros ? 'Tente ajustar os filtros.' : 'Emissões registradas aparecerão aqui.'}
            </p>
          </div>
        ) : (
          <>
            {/* Header da tabela */}
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] px-6 py-3 border-b border-white/5 bg-white/[0.02]">
              {['Condomínio', 'Competência', 'Registrada em', 'Status', 'Ações'].map(h => (
                <span key={h} className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{h}</span>
              ))}
            </div>

            {/* Linhas */}
            <div className="divide-y divide-white/5">
              {pacotesPaginados.map(p => {
                const numArq = p.arquivos?.length || 0;
                return (
                  <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] px-6 py-4 items-center hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                        <Building className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <p className="font-bold text-white text-sm">{p.condominios?.name}</p>
                        <p className="text-[10px] text-gray-500">{numArq} arquivo{numArq !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-cyan-400">{String(p.mes_referencia).padStart(2,'0')}/{p.ano_referencia}</span>
                    <span className="text-xs text-gray-400">
                      {p.lacrada_em ? new Date(p.lacrada_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).replace(',', ' às') : '—'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Lacrada
                      </span>
                      {p.eh_retificacao && (
                        <span className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[9px] font-black text-amber-400 uppercase tracking-widest">Retif.</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setArqPacote(p); setShowArqModal(true); }}
                        className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-all" title="Ver arquivos">
                        <Eye className="w-4 h-4" />
                      </button>
                      {(p.arquivos?.length || 0) > 0 && (
                        <button onClick={() => handleDownloadZip(p)}
                          className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-emerald-400 hover:border-emerald-500/30 transition-all" title="Baixar pacote ZIP">
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                      {canRetif && (
                        <button onClick={() => { setRetifPacote(p); setShowRetifModal(true); setRetifMotivo(''); setRetifDescricao(''); }}
                          className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-amber-400 hover:border-amber-500/30 transition-all" title="Solicitar retificação">
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Paginação */}
            {totalPaginas > 1 && (
              <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between bg-white/[0.02]">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                  Página {pagina} de {totalPaginas}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1}
                    className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white disabled:opacity-30 transition-all">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={pagina === totalPaginas}
                    className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white disabled:opacity-30 transition-all">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ MODAL VER ARQUIVOS ═══ */}
      {showArqModal && arqPacote && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-black text-white">{arqPacote.condominios?.name}</h3>
                <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest">
                  {String(arqPacote.mes_referencia).padStart(2,'0')}/{arqPacote.ano_referencia} • Lacrada
                </p>
              </div>
              <button onClick={() => setShowArqModal(false)} className="p-2 hover:bg-white/5 rounded-full text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {(arqPacote.arquivos || []).length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">Nenhum arquivo encontrado.</p>
              ) : arqPacote.arquivos.map(arq => (
                <button key={arq.id} onClick={() => openFileUrl(arq)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 border border-white/10 rounded-xl hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all group text-left">
                  <FileText className="w-4 h-4 text-gray-500 group-hover:text-cyan-400 shrink-0" />
                  <span className="text-sm font-bold text-gray-400 group-hover:text-white truncate">{arq.arquivo_nome}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL RETIFICAÇÃO ═══ */}
      {showRetifModal && retifPacote && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-lg p-8 shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white">Solicitar Retificação</h3>
                <p className="text-[10px] text-amber-400 font-black uppercase tracking-widest mt-1">
                  {retifPacote.condominios?.name} — {String(retifPacote.mes_referencia).padStart(2,'0')}/{retifPacote.ano_referencia}
                </p>
              </div>
            </div>

            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl mb-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/60 leading-relaxed">
                Esta ação registrará oficialmente uma solicitação de retificação. O pacote original permanecerá lacrado até aprovação.
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Motivo</label>
                <select value={retifMotivo} onChange={e => setRetifMotivo(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-amber-500 transition-all appearance-none">
                  <option value="" className="bg-[#0a0a0f]">Selecione o motivo...</option>
                  <option value="Cobrança extra esquecida" className="bg-[#0a0a0f]">Cobrança extra esquecida</option>
                  <option value="Valor incorreto no rateio" className="bg-[#0a0a0f]">Valor incorreto no rateio</option>
                  <option value="Dado cadastral desatualizado" className="bg-[#0a0a0f]">Dado cadastral desatualizado</option>
                  <option value="Erro no demonstrativo" className="bg-[#0a0a0f]">Erro no demonstrativo</option>
                  <option value="Outro" className="bg-[#0a0a0f]">Outro (descrever)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Descrição Detalhada</label>
                <textarea value={retifDescricao} onChange={e => setRetifDescricao(e.target.value)} rows={4}
                  placeholder="Descreva detalhadamente o que precisa ser retificado..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white outline-none focus:border-amber-500 transition-all placeholder:text-gray-700" />
                <p className="text-[9px] text-gray-600 mt-1 ml-1 uppercase font-bold tracking-widest">Mínimo 30 caracteres ({retifDescricao.length}/30)</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowRetifModal(false); setRetifPacote(null); }}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSolicitarRetif} disabled={retifSubmitting || !retifMotivo || retifDescricao.length < 30}
                className="flex-[2] py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all disabled:opacity-30 flex items-center justify-center gap-2">
                {retifSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Solicitar Retificação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
