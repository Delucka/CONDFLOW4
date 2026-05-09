'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { FileText, CheckCircle, XCircle, Search, ExternalLink, Loader2, Package, ChevronDown } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';
export default function VisaoGerente({ profile }) {
  const supabase = createClient();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [arquivoAberto, setArquivoAberto] = useState(null);
  
  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [termoBusca, setTermoBusca] = useState('');
  
  // Pacote expandido (mostra arquivos)
  const [expandedPacote, setExpandedPacote] = useState(null);
  const [pacoteArquivos, setPacoteArquivos] = useState([]);
  
  // Modal de correção
  const [showModal, setShowModal] = useState(false);
  const [currentPacote, setCurrentPacote] = useState(null);
  const [comment, setComment] = useState('');
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  async function fetchPacotes() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('emissoes_pacotes')
        .select('*, condominios(name, gerente_id)')
        .order('criado_em', { ascending: false });

      if (data) {
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato')
          .not('pacote_id', 'is', null);

        const arqMap = {};
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });

        // Filtra no frontend: só pacotes dos condomínios deste gerente
        const gerenteId = profile.gerente_id;
        const pacotesFiltrados = gerenteId
          ? data.filter(p => p.condominios?.gerente_id === gerenteId)
          : data; // se gerente_id não estiver disponível, mostra tudo (RLS protege)

        setPacotes(pacotesFiltrados.map(p => ({ ...p, arquivos: arqMap[p.id] || [] })));
      }
    } catch (err) {
      console.error('Erro ao carregar pacotes do gerente:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchPacotes();
    
    const channel = supabase.channel('gerente_pacotes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => { fetchPacotes(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAprovar(pacote) {
    const fluxos = {
      1: { 'default': 'aprovado' },
      2: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      3: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      4: { 'Aguardando Gerente': 'Aguardando Chefe', 'Aguardando Chefe': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' }
    };

    const fluxoId = Number(pacote.nivel_aprovacao) || 1;
    const currentStatus = pacote.status;
    let nextStatus = 'aprovado';

    if (fluxos[fluxoId]) {
      nextStatus = fluxos[fluxoId][currentStatus] || fluxos[fluxoId]['default'] || 'aprovado';
    }

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ status: nextStatus, atualizado_em: new Date().toISOString() })
      .eq('id', pacote.id);

    if (error) {
      addToast('Não foi possível aprovar', 'error');
    } else {
      addToast(nextStatus === 'aprovado' ? 'Pacote aprovado!' : `Aprovado e enviado para: ${nextStatus}`, 'success');
      setIsDrawerOpen(false);
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
        emitido_por: pacote.uploaded_by,
        arquivos: pacote.arquivos || []
      });
    }
  }

  const STATUS_PENDENTE_GERENTE = ['pendente_gerente', 'Aguardando Gerente', 'pendente'];
  const STATUS_EM_SUPERVISOR   = ['pendente_sup_gerentes', 'pendente_sup_contabilidade', 'Aguardando Supervisor', 'Aguardando Chefe'];

  const filtered = pacotes.filter(p => {
    if (p.status === 'rascunho') return false;
    if (filtroStatus !== 'todos') {
      if (filtroStatus === 'pendente_gerente') {
        if (!STATUS_PENDENTE_GERENTE.includes(p.status)) return false;
      } else if (filtroStatus === 'em_supervisor') {
        if (!STATUS_EM_SUPERVISOR.includes(p.status)) return false;
      } else {
        if (p.status !== filtroStatus) return false;
      }
    }
    if (termoBusca) {
      const b = termoBusca.toLowerCase();
      const nome = p.condominios?.name?.toLowerCase() || '';
      return nome.includes(b);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      
      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between border border-white/10 rounded-3xl bg-white/5 p-4 shadow-xl">
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
          {[
            { value: 'pendente_gerente',   label: 'Pendentes'    },
            { value: 'em_supervisor',      label: 'Em Supervisor' },
            { value: 'aprovado',           label: 'Aprovado'     },
            { value: 'solicitar_correcao', label: 'Correção'     },
            { value: 'todos',              label: 'Todos'        },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFiltroStatus(value)}
              className={`px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                filtroStatus === value
                  ? 'bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {label}
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

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-violet-500"/></div>
      ) : filtered.length === 0 ? (
        <div className="text-center p-12 border border-white/10 rounded-3xl bg-white/5">
          <span className="text-gray-500">Nenhum pacote encontrado nesta categoria.</span>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(pacote => {
            const numArquivos = pacote.arquivos?.length || 0;
            const isAwaiting = STATUS_PENDENTE_GERENTE.includes(pacote.status);

            return (
              <div key={pacote.id} className="border border-white/10 rounded-2xl bg-[#0a0a0f] overflow-hidden">
                {/* Header do Pacote */}
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center">
                      <Package className="w-6 h-6 text-violet-400" />
                    </div>
                    <div>
                      <h4 className="font-black text-white text-base">{pacote.condominios?.name || '-'}</h4>
                      <p className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                        {String(pacote.mes_referencia).padStart(2,'0')}/{pacote.ano_referencia} • {numArquivos} arquivo{numArquivos !== 1 ? 's' : ''}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Enviado por {pacote.profiles?.full_name}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <StatusBadge status={pacote.status} />
                    {isAwaiting && (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => abrirModalCorrecao(pacote)}
                          className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-rose-400 hover:bg-rose-500 hover:text-white hover:border-rose-500 flex items-center justify-center transition-all"
                          title="Solicitar Correção"
                        >
                          <XCircle className="w-5 h-5"/>
                        </button>
                        <button 
                          onClick={() => handleAprovar(pacote)}
                          className="w-10 h-10 rounded-xl bg-violet-600 shadow-[0_0_15px_rgba(139,92,246,0.3)] text-white hover:bg-violet-500 flex items-center justify-center transition-all"
                          title="Aprovar Pacote"
                        >
                          <CheckCircle className="w-5 h-5"/>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Lista de Arquivos (sempre visível) */}
                <div className="border-t border-white/5 bg-white/[0.02] px-5 py-3">
                  <div className="flex flex-wrap gap-2">
                    {(pacote.arquivos || []).map(arq => (
                      <button
                        key={arq.id}
                        onClick={() => openFileUrl(arq, pacote)}
                        className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0f] border border-white/10 rounded-xl hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all group"
                      >
                        <FileText className="w-3.5 h-3.5 text-gray-500 group-hover:text-cyan-400" />
                        <span className="text-xs font-bold text-gray-400 group-hover:text-white truncate max-w-[150px]">{arq.arquivo_nome}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {pacote.status === 'solicitar_correcao' && pacote.comentario_correcao && (
                  <div className="px-5 py-3 bg-rose-500/5 border-t border-rose-500/10">
                    <p className="text-xs text-rose-400"><span className="font-black">Correção:</span> {pacote.comentario_correcao}</p>
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
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl animate-fade-in">
            <h3 className="text-xl font-black text-white mb-2">Solicitar Correção</h3>
            <p className="text-sm text-gray-400 mb-6 font-bold uppercase tracking-widest">
              {currentPacote?.condominios?.name} ({currentPacote?.mes_referencia}/{currentPacote?.ano_referencia})
            </p>
            
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white focus:border-rose-500 outline-none min-h-[120px] mb-6"
              placeholder="Descreva o que precisa ser ajustado..."
              value={comment}
              onChange={e => setComment(e.target.value)}
            />

            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-5 py-3 rounded-xl text-[13px] font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
                Cancelar
              </button>
              <button onClick={confirmarCorrecao} className="px-5 py-3 rounded-xl text-[13px] font-black uppercase tracking-widest bg-rose-500 text-white shadow-lg hover:bg-rose-400 transition-colors">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      <FilePreviewDrawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        file={selectedFile} 
      />

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
