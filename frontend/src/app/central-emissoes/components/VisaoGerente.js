'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { FileText, CheckCircle, XCircle, Search, ExternalLink, Loader2 } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';

export default function VisaoGerente({ profile }) {
  const supabase = createClient();
  const { addToast } = useToast();
  
  const [arquivos, setArquivos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('pendente');
  const [termoBusca, setTermoBusca] = useState('');
  
  // Modal de correção
  const [showModal, setShowModal] = useState(false);
  const [currentFile, setCurrentFile] = useState(null);
  const [comment, setComment] = useState('');

  useEffect(() => {
    fetchArquivos();
    
    const channel = supabase.channel('gerente_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_arquivos' }, () => {
        fetchArquivos();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchArquivos() {
    setLoading(true);
    // Como gerente, o RLS traz apenas os condomínios da sua carteira
    const { data } = await supabase
      .from('emissoes_arquivos')
      .select('*, condominios(name)')
      .order('criado_em', { ascending: false });
    
    if (data) setArquivos(data);
    setLoading(false);
  }

  async function handleAprovar(id) {
    const { error } = await supabase
      .from('emissoes_arquivos')
      .update({ status: 'aprovado' })
      .eq('id', id);

    if (error) {
      addToast('Não foi possível aprovar', 'error');
    } else {
      addToast('Arquivo aprovado com sucesso!', 'success');
      fetchArquivos();
    }
  }

  function abrirModalCorrecao(file) {
    setCurrentFile(file);
    setComment('');
    setShowModal(true);
  }

  async function confirmarCorrecao() {
    if (!comment) return addToast('Comentário é obrigatório.', 'warning');

    const { error } = await supabase
      .from('emissoes_arquivos')
      .update({ status: 'solicitar_correcao', comentario_correcao: comment })
      .eq('id', currentFile.id);

    if (error) {
      addToast('Falha ao solicitar correção.', 'error');
    } else {
      addToast('Correção solicitada.', 'success');
      setShowModal(false);
      fetchArquivos();
    }
  }

  async function openFileUrl(path) {
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(path, 60);

    if (error) {
       console.error(error);
       addToast('Erro ao gerar link de visualização seguro.', 'error');
       return;
    }

    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank');
    }
  }

  const filtered = arquivos.filter(a => {
    if (filtroStatus !== 'todos' && a.status !== filtroStatus) return false;
    if (termoBusca) {
      const b = termoBusca.toLowerCase();
      const nome = a.condominios?.name?.toLowerCase() || '';
      return nome.includes(b) || a.arquivo_nome.toLowerCase().includes(b);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      
      {/* Filtros Livres */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between border border-white/10 rounded-3xl bg-white/5 p-4 shadow-xl">
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
          {['pendente', 'aprovado', 'solicitar_correcao', 'todos'].map(st => (
            <button
              key={st}
              onClick={() => setFiltroStatus(st)}
              className={`px-5 py-2.5 rounded-xl text-[13px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                filtroStatus === st 
                  ? 'bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' 
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
        </div>
        
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
          <input 
            type="text" 
            placeholder="Buscar por condomínio..."
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
          <span className="text-gray-500">Nenhum arquivo encontrado nesta categoria.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map(doc => (
            <div key={doc.id} className="border border-white/10 rounded-3xl bg-[#0a0a0f] overflow-hidden flex flex-col group relative transition-all hover:bg-white/5">
              
              <div className="absolute top-4 right-4">
                <StatusBadge status={doc.status} />
              </div>

              <div className="p-6">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <FileText className="w-7 h-7 text-violet-400" />
                </div>
                
                <h4 className="font-black text-white text-lg truncate mb-1" title={doc.condominios?.name}>
                  {doc.condominios?.name || '-'}
                </h4>
                
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-400 mb-2">
                  {doc.tipo.replace('_', ' ')} • {String(doc.mes_referencia).padStart(2,'0')}/{doc.ano_referencia}
                </p>

                <p className="text-sm text-gray-500 truncate" title={doc.arquivo_nome}>{doc.arquivo_nome}</p>

                {doc.comentario_correcao && doc.status === 'solicitar_correcao' && (
                  <div className="mt-3 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl text-xs text-rose-300">
                    <span className="font-bold flex items-center gap-1 mb-1"><XCircle className="w-3 h-3"/> Sua Correção:</span>
                    {doc.comentario_correcao}
                  </div>
                )}
              </div>

              <div className="p-4 bg-white/5 border-t border-white/10 flex items-center justify-between mt-auto">
                <button 
                  onClick={() => openFileUrl(doc.arquivo_url)}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4"/> Ver Arquivo
                </button>

                {doc.status === 'pendente' && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => abrirModalCorrecao(doc)}
                      className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-rose-400 hover:bg-rose-500 hover:text-white hover:border-rose-500 flex items-center justify-center transition-all"
                      title="Solicitar Correção"
                    >
                      <XCircle className="w-5 h-5"/>
                    </button>
                    <button 
                       onClick={() => handleAprovar(doc.id)}
                       className="w-10 h-10 rounded-xl bg-violet-600 shadow-[0_0_15px_rgba(139,92,246,0.3)] text-white hover:bg-violet-500 flex items-center justify-center transition-all"
                       title="Aprovar"
                    >
                      <CheckCircle className="w-5 h-5"/>
                    </button>
                  </div>
                )}
              </div>

            </div>
          ))}
        </div>
      )}

      {/* Modal Correção */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-6 overflow-hidden relative shadow-2xl animate-fade-in">
            <h3 className="text-xl font-black text-white mb-2">Solicitar Correção</h3>
            <p className="text-sm text-gray-400 mb-6 font-bold uppercase tracking-widest">
              No de {currentFile?.condominios?.name} ({currentFile?.mes_referencia}/{currentFile?.ano_referencia})
            </p>
            
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white focus:border-rose-500 outline-none min-h-[120px] mb-6"
              placeholder="Descreva o que precisa ser ajustado..."
              value={comment}
              onChange={e => setComment(e.target.value)}
            />

            <div className="flex items-center gap-3 justify-end">
              <button 
                onClick={() => setShowModal(false)}
                className="px-5 py-3 rounded-xl text-[13px] font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmarCorrecao}
                className="px-5 py-3 rounded-xl text-[13px] font-black uppercase tracking-widest bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.4)] hover:bg-rose-400 transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
