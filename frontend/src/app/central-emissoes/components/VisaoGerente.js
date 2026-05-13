'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { FileText, CheckCircle, XCircle, Search, Loader2, Package, AlertCircle } from 'lucide-react';
import StatusBadge from './StatusBadge';
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

  async function fetchPacotes() {
    setLoading(true);
    try {
      // Usa RPC com SECURITY DEFINER — bypassa RLS de condominios,
      // filtra diretamente por auth.uid() → gerentes.profile_id → condominios.gerente_id
      const { data, error } = await supabase.rpc('get_pacotes_gerente');

      if (error) {
        console.error('[VisaoGerente] erro rpc:', error);
        setPacotes([]);
        setLoading(false);
        return;
      }

      if (data && data.length > 0) {
        const pacoteIds = data.map(p => p.id);
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato')
          .in('pacote_id', pacoteIds);

        const arqMap = {};
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });

        // Normaliza para ter condominios.name igual ao restante do app
        setPacotes(data.map(p => ({
          ...p,
          condominios: { name: p.condo_name },
          arquivos: arqMap[p.id] || [],
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

    const channel = supabase.channel('gerente_pacotes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => fetchPacotes())
      .subscribe();

    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAprovar(pacote) {
    const fluxos = {
      1: { default: 'aprovado' },
      2: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      3: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      4: { 'Aguardando Gerente': 'Aguardando Chefe', 'Aguardando Chefe': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
    };

    const fluxoId = Number(pacote.nivel_aprovacao) || 1;
    const nextStatus = fluxos[fluxoId]?.[pacote.status] ?? fluxos[fluxoId]?.default ?? 'aprovado';

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ status: nextStatus, atualizado_em: new Date().toISOString() })
      .eq('id', pacote.id);

    if (error) {
      addToast('Não foi possível aprovar', 'error');
    } else {
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
      .update({ status: 'solicitar_correcao', comentario_correcao: comment, atualizado_em: new Date().toISOString() })
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
        condominio_id: pacote.condominio_id,
        mes: pacote.mes_referencia,
        ano: pacote.ano_referencia,
        eh_retificacao: pacote.eh_retificacao || false,
        emitido_por: pacote.uploaded_by,
        arquivos: pacote.arquivos || [],
      });
    }
  }

  // Filtragem — mesma lógica do VisaoMaster (toLowerCase + includes)
  const filtered = useMemo(() => {
    return pacotes.filter(p => {
      const s = (p.status || '').toLowerCase();
      if (s === 'rascunho') return false;

      if (filtroStatus !== 'todos') {
        if (filtroStatus === 'pendente_gerente') {
          if (!(s.includes('gerente') || s === 'pendente')) return false;
        } else if (filtroStatus === 'em_supervisor') {
          if (!(s.includes('supervisor') || s.includes('chefe'))) return false;
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
  }, [pacotes, filtroStatus, termoBusca]);

  // Contadores para badges nas abas
  const counts = useMemo(() => ({
    pendente_gerente: pacotes.filter(p => { const s = (p.status||'').toLowerCase(); return s.includes('gerente') || s === 'pendente'; }).length,
    em_supervisor:    pacotes.filter(p => { const s = (p.status||'').toLowerCase(); return s.includes('supervisor') || s.includes('chefe'); }).length,
    aprovado:         pacotes.filter(p => (p.status||'').toLowerCase() === 'aprovado').length,
    solicitar_correcao: pacotes.filter(p => (p.status||'').toLowerCase() === 'solicitar_correcao').length,
    todos:            pacotes.filter(p => (p.status||'').toLowerCase() !== 'rascunho').length,
  }), [pacotes]);

  const FILTROS = [
    { value: 'pendente_gerente',   label: 'Aguard. minha aprovação' },
    { value: 'em_supervisor',      label: 'Em Supervisor'            },
    { value: 'aprovado',           label: 'Aprovado'                 },
    { value: 'solicitar_correcao', label: 'Correção'                 },
    { value: 'todos',              label: 'Todos'                    },
  ];

  return (
    <div className="space-y-6">

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between border border-white/10 rounded-3xl bg-white/5 p-4 shadow-xl">
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
          {FILTROS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFiltroStatus(value)}
              className={`relative px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                filtroStatus === value
                  ? 'bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {label}
              {counts[value] > 0 && (
                <span className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                  filtroStatus === value ? 'bg-white/20 text-white' : 'bg-violet-500/20 text-violet-400'
                }`}>
                  {counts[value]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar condomínio..."
            value={termoBusca}
            onChange={e => setTermoBusca(e.target.value)}
            className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none transition-colors"
          />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="animate-spin w-8 h-8 text-violet-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center p-12 border border-white/10 rounded-3xl bg-white/5 flex flex-col items-center gap-3">
          <AlertCircle className="w-8 h-8 text-gray-600" />
          <span className="text-gray-500 text-sm">
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
            const aguardandoGerente = s.includes('gerente') || s === 'pendente';

            return (
              <div key={pacote.id} className="border border-white/10 rounded-2xl bg-[#0a0a0f] overflow-hidden">
                {/* Header */}
                <div className="p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-black text-white text-sm truncate">{pacote.condominios?.name || '—'}</h4>
                      <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">
                        {String(pacote.mes_referencia).padStart(2, '0')}/{pacote.ano_referencia}
                        {' • '}{numArquivos} arquivo{numArquivos !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={pacote.status} />
                    {aguardandoGerente && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => abrirModalCorrecao(pacote)}
                          className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-rose-400 hover:bg-rose-500 hover:text-white hover:border-rose-500 flex items-center justify-center transition-all"
                          title="Solicitar Correção"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleAprovar(pacote)}
                          className="w-9 h-9 rounded-xl bg-violet-600 shadow-[0_0_15px_rgba(139,92,246,0.3)] text-white hover:bg-violet-500 flex items-center justify-center transition-all"
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
                  <div className="border-t border-white/5 bg-white/[0.02] px-5 py-3">
                    <div className="flex flex-wrap gap-2">
                      {pacote.arquivos.map(arq => (
                        <button
                          key={arq.id}
                          onClick={() => openFileUrl(arq, pacote)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0f] border border-white/10 rounded-xl hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all group"
                        >
                          <FileText className="w-3 h-3 text-gray-500 group-hover:text-cyan-400" />
                          <span className="text-[11px] font-bold text-gray-400 group-hover:text-white truncate max-w-[140px]">{arq.arquivo_nome}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Comentário de correção */}
                {s === 'solicitar_correcao' && pacote.comentario_correcao && (
                  <div className="px-5 py-3 bg-rose-500/5 border-t border-rose-500/10">
                    <p className="text-xs text-rose-400">
                      <span className="font-black">Correção:</span> {pacote.comentario_correcao}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Correção */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-xl font-black text-white mb-1">Solicitar Correção</h3>
            <p className="text-xs text-gray-400 mb-5 font-bold uppercase tracking-widest">
              {currentPacote?.condominios?.name} — {String(currentPacote?.mes_referencia).padStart(2,'0')}/{currentPacote?.ano_referencia}
            </p>
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white focus:border-rose-500 outline-none min-h-[110px] mb-5"
              placeholder="Descreva o que precisa ser ajustado..."
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
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
