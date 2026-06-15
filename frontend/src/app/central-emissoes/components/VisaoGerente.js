'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { FileText, CheckCircle, XCircle, Search, Loader2, Package, AlertCircle } from 'lucide-react';
import StatusBadge from './StatusBadge';
import TrilhaAprovacao from '@/components/TrilhaAprovacao';
import { proximoStatusAprovacao } from '@/lib/aprovacaoFluxo';
import { useToast } from '@/components/Toast';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';

export default function VisaoGerente({ profile }) {
  const supabase = createClient();
  const { addToast } = useToast();
  const { user } = useAuth();

  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [termoBusca, setTermoBusca] = useState('');
  const [arquivoAberto, setArquivoAberto] = useState(null);

  // Modal de correção
  const [showModal, setShowModal] = useState(false);
  const [currentPacote, setCurrentPacote] = useState(null);
  const [comment, setComment] = useState('');

  // Detecta perfil do usuário pra ajustar o fetch e o filtro "minha aprovação"
  const role = profile?.role;
  const isSupervisor = ['supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'].includes(role);

  async function fetchPacotes() {
    setLoading(true);
    try {
      let pacotesData = [];

      if (isSupervisor) {
        // Supervisor: vê TODOS os pacotes (sem filtro de carteira)
        const { data, error } = await supabase
          .from('emissoes_pacotes')
          .select('*, condominios(name)')
          .order('atualizado_em', { ascending: false });
        if (error) {
          console.error('[VisaoGerente/sup] erro:', error);
          setPacotes([]); setLoading(false); return;
        }
        pacotesData = (data || []).map(p => ({
          ...p,
          condo_name: p.condominios?.name,
        }));
      } else {
        // Gerente: RPC filtra pela carteira
        const { data, error } = await supabase.rpc('get_pacotes_gerente');
        if (error) {
          console.error('[VisaoGerente] erro rpc:', error);
          setPacotes([]); setLoading(false); return;
        }
        pacotesData = data || [];
      }

      if (pacotesData.length > 0) {
        const pacoteIds = pacotesData.map(p => p.id);
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato, categoria, subtipo, nome_condominio_fatura, vencimento_fatura, valor_fatura, relatorio_empresa, relatorio_tipo_servico, relatorio_data_leitura, relatorio_unidades, relatorio_consumo_total, relatorio_valor_total, extracao_dados_brutos, condominio_id, mes_referencia, ano_referencia')
          .in('pacote_id', pacoteIds);

        const arqMap = {};
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });

        // Trilha de aprovação (quem aprovou e quando) — visível para todos
        const { data: aprovacoes } = await supabase
          .from('emissoes_pacotes_aprovacoes')
          .select('pacote_id, acao, role, usuario_nome, usuario_email, criado_em')
          .in('pacote_id', pacoteIds)
          .order('criado_em', { ascending: true });
        const aprMap = {};
        (aprovacoes || []).forEach(a => { (aprMap[a.pacote_id] = aprMap[a.pacote_id] || []).push(a); });

        setPacotes(pacotesData.map(p => ({
          ...p,
          condominios: p.condominios || { name: p.condo_name },
          arquivos: arqMap[p.id] || [],
          aprovacoes: aprMap[p.id] || [],
        })));
      } else {
        setPacotes([]);
      }
    } catch (err) {
      console.error('[VisaoGerente] erro geral:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchPacotes();

    const channel = supabase.channel(`gerente_pacotes_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => fetchPacotes())
      .subscribe();

    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAprovar(pacote) {
    // Só vira 'aprovado' quando TODOS os cargos do nível assinaram (via trilha)
    const nextStatus = await proximoStatusAprovacao(supabase, pacote.id, pacote.nivel_aprovacao, user?.role);
    const agora = new Date().toISOString();
    const payload = { status: nextStatus, atualizado_em: agora };
    if (nextStatus === 'aprovado') {
      payload.aprovado_por_nome = user?.full_name || user?.email || null;
      payload.aprovado_por_role = user?.role || null;
      payload.aprovado_em = agora;
    }

    const { data, error } = await supabase
      .from('emissoes_pacotes')
      .update(payload)
      .eq('id', pacote.id)
      .select('id, status');

    if (error) {
      addToast('Não foi possível aprovar: ' + error.message, 'error');
    } else if (!data || data.length === 0) {
      // RLS bloqueou o update silenciosamente (0 linhas afetadas)
      addToast('Aprovação bloqueada pelas regras de acesso. Avise o admin.', 'error');
    } else {
      await supabase.from('emissoes_pacotes_aprovacoes').insert({
        pacote_id: pacote.id, acao: 'aprovacao', role: user?.role || null,
        usuario_nome: user?.full_name || null, usuario_email: user?.email || null,
      });
      addToast(nextStatus === 'aprovado' ? 'Pacote aprovado!' : `Enviado para: ${nextStatus}`, 'success');
      fetchPacotes();
    }
  }

  function abrirModalCorrecao(pacote) {
    setCurrentPacote(pacote);
    setComment('');
    setShowModal(true);
  }

  async function confirmarCorrecao() {
    if (!comment) return addToast('Comentário é obrigatório.', 'warning');

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ status: 'solicitar_correcao', comentario_correcao: comment, atualizado_em: new Date().toISOString(),
        correcao_por_nome: user?.full_name || user?.email || null,
        correcao_em: new Date().toISOString() })
      .eq('id', currentPacote.id);

    if (error) {
      addToast('Falha ao solicitar correção.', 'error');
    } else {
      addToast('Correção solicitada.', 'success');
      setShowModal(false);
      fetchPacotes();
    }
  }

  async function openFileUrl(doc, pacote) {
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(doc.arquivo_url, 300);
    if (error) return addToast('Erro ao gerar link.', 'error');
    if (data?.signedUrl) {
      setArquivoAberto({
        id: doc.id,
        nome: doc.arquivo_nome,
        url: data.signedUrl,
        processo_id: pacote.processo_id || null,
        pacote_id: pacote.id,
        pacote_status: pacote.status,
        pacote_nivel: pacote.nivel_aprovacao,
        comentario_correcao: pacote.comentario_correcao || null,
        correcao_arquivo_url: pacote.correcao_arquivo_url || null,
        correcao_arquivo_nome: pacote.correcao_arquivo_nome || null,
        resposta_correcao_comentario: pacote.resposta_correcao_comentario || null,
        resposta_correcao_arquivo_url: pacote.resposta_correcao_arquivo_url || null,
        resposta_correcao_arquivo_nome: pacote.resposta_correcao_arquivo_nome || null,
        resposta_correcao_em: pacote.resposta_correcao_em || null,
        condominio_id: pacote.condominio_id,
        mes: pacote.mes_referencia,
        ano: pacote.ano_referencia,
        eh_retificacao: pacote.eh_retificacao || false,
        emitido_por: pacote.uploaded_by,
        arquivos: pacote.arquivos || [],
      });
    }
  }

  // Define que status conta como "minha aprovação" baseado no role
  // - gerente:                  Aguardando Gerente / pendente_gerente / pendente
  // - supervisor_gerentes:      Aguardando Chefe / pendente_sup_gerentes
  // - supervisora/sup_contab:   Aguardando Supervisor / pendente_sup_contabilidade
  function isMinhaAprovacao(s) {
    s = (s || '').toLowerCase();
    if (role === 'gerente') return s.includes('aguardando gerente') || s === 'pendente_gerente' || s === 'pendente';
    if (role === 'supervisor_gerentes') return s.includes('aguardando chefe') || s === 'pendente_sup_gerentes';
    if (role === 'supervisora_contabilidade' || role === 'supervisora') return s.includes('aguardando supervisor') || s === 'pendente_sup_contabilidade';
    return false;
  }
  // "Em outra etapa" = pacotes em fluxo de aprovação mas não com este role
  function isEmOutraEtapa(s) {
    s = (s || '').toLowerCase();
    if (!s || s === 'rascunho' || s === 'aprovado' || s === 'registrado' || s === 'expedida' || s === 'solicitar_correcao') return false;
    return !isMinhaAprovacao(s);
  }

  // Filtragem
  const filtered = useMemo(() => {
    return pacotes.filter(p => {
      const s = (p.status || '').toLowerCase();
      if (s === 'rascunho') return false;

      if (filtroStatus !== 'todos') {
        if (filtroStatus === 'pendente_gerente') {
          if (!isMinhaAprovacao(s)) return false;
        } else if (filtroStatus === 'em_supervisor') {
          if (!isEmOutraEtapa(s)) return false;
        } else {
          if (s !== filtroStatus) return false;
        }
      }

      if (termoBusca) {
        const b = termoBusca.toLowerCase();
        return (p.condominios?.name || '').toLowerCase().includes(b);
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacotes, filtroStatus, termoBusca, role]);

  // Contadores para badges nas abas
  const counts = useMemo(() => ({
    pendente_gerente:   pacotes.filter(p => isMinhaAprovacao(p.status)).length,
    em_supervisor:      pacotes.filter(p => isEmOutraEtapa(p.status)).length,
    aprovado:           pacotes.filter(p => (p.status||'').toLowerCase() === 'aprovado').length,
    solicitar_correcao: pacotes.filter(p => (p.status||'').toLowerCase() === 'solicitar_correcao').length,
    todos:              pacotes.filter(p => (p.status||'').toLowerCase() !== 'rascunho').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pacotes, role]);

  // Labels da aba "Em outra etapa" mudam por role
  const labelOutraEtapa = isSupervisor ? 'Outras etapas' : 'Em Supervisor';

  const FILTROS = [
    { value: 'pendente_gerente',   label: 'Aguard. minha aprovação' },
    { value: 'em_supervisor',      label: labelOutraEtapa            },
    { value: 'aprovado',           label: 'Aprovado'                 },
    { value: 'solicitar_correcao', label: 'Correção'                 },
    { value: 'todos',              label: 'Todos'                    },
  ];

  return (
    <div className="space-y-6">

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between border border-slate-200 rounded-3xl bg-slate-50 p-4 shadow-xl">
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
          {FILTROS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFiltroStatus(value)}
              className={`relative px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                filtroStatus === value
                  ? 'bg-violet-600 text-white '
                  : 'bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {label}
              {counts[value] > 0 && (
                <span className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                  filtroStatus === value ? 'bg-slate-100 text-slate-700' : 'bg-violet-500/20 text-violet-400'
                }`}>
                  {counts[value]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar condomínio..."
            value={termoBusca}
            onChange={e => setTermoBusca(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-violet-500 outline-none transition-colors"
          />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="animate-spin w-8 h-8 text-violet-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center p-12 border border-slate-200 rounded-3xl bg-slate-50 flex flex-col items-center gap-3">
          <AlertCircle className="w-8 h-8 text-slate-400" />
          <span className="text-slate-500 text-sm">
            {pacotes.length === 0
              ? 'Nenhuma emissão encontrada para a sua carteira.'
              : 'Nenhum pacote nesta categoria.'}
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(pacote => {
            const numArquivos = pacote.arquivos?.length || 0;
            const s = (pacote.status || '').toLowerCase();
            const aguardandoGerente = isMinhaAprovacao(s);

            return (
              <div key={pacote.id} className="border border-slate-200 rounded-2xl bg-white overflow-hidden">
                {/* Header */}
                <div className="p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/20 border border-slate-200 flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-black text-slate-900 text-sm truncate">{pacote.condominios?.name || '—'}</h4>
                      <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest">
                        {String(pacote.mes_referencia).padStart(2, '0')}/{pacote.ano_referencia}
                        {' • '}{numArquivos} arquivo{numArquivos !== 1 ? 's' : ''}
                      </p>
                      <TrilhaAprovacao pacote={pacote} />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={pacote.status} />
                    {aguardandoGerente && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => abrirModalCorrecao(pacote)}
                          className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 text-rose-400 hover:bg-rose-500 hover:text-white hover:border-rose-500 flex items-center justify-center transition-all"
                          title="Solicitar Correção"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleAprovar(pacote)}
                          className="w-9 h-9 rounded-xl bg-violet-600  text-white hover:bg-violet-500 flex items-center justify-center transition-all"
                          title="Aprovar Pacote"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Arquivos */}
                {numArquivos > 0 && (
                  <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
                    <div className="flex flex-wrap gap-2">
                      {pacote.arquivos.map(arq => (
                        <button
                          key={arq.id}
                          onClick={() => openFileUrl(arq, pacote)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group"
                        >
                          <FileText className="w-3 h-3 text-slate-500 group-hover:text-violet-400" />
                          <span className="text-[11px] font-bold text-slate-500 group-hover:text-slate-900 truncate max-w-[140px]">{arq.arquivo_nome}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Comentário de correção */}
                {s === 'solicitar_correcao' && pacote.comentario_correcao && (
                  <div className="px-5 py-3 bg-rose-500/5 border-t border-rose-500/10 space-y-2">
                    <p className="text-xs text-rose-400">
                      <span className="font-black">Correção:</span> {pacote.comentario_correcao}
                    </p>
                    {pacote.correcao_arquivo_url && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(pacote.correcao_arquivo_url, 300);
                          if (error) return addToast('Erro ao abrir anexo', 'error');
                          window.open(data.signedUrl, '_blank');
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[11px] font-bold">
                        📎 {pacote.correcao_arquivo_nome || 'Ver anexo da correção'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Correção */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-xl font-black text-slate-900 mb-1">Solicitar Correção</h3>
            <p className="text-xs text-slate-500 mb-5 font-bold uppercase tracking-widest">
              {currentPacote?.condominios?.name} — {String(currentPacote?.mes_referencia).padStart(2,'0')}/{currentPacote?.ano_referencia}
            </p>
            <textarea
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-900 focus:border-rose-500 outline-none min-h-[110px] mb-5"
              placeholder="Descreva o que precisa ser ajustado..."
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                Cancelar
              </button>
              <button onClick={confirmarCorrecao} className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-rose-500 text-white hover:bg-rose-400 transition-colors">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visualizador de arquivo */}
      {arquivoAberto && (
        <VisualizadorConferencia
          arquivo={arquivoAberto}
          arquivos={arquivoAberto.arquivos}
          currentUser={user}
          onClose={() => setArquivoAberto(null)}
          onAction={() => { setArquivoAberto(null); fetchPacotes(); }}
        />
      )}
    </div>
  );
}
