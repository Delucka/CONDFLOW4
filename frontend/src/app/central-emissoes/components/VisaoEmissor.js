'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { UploadCloud, FileText, CheckCircle, Clock, AlertCircle, Loader2, Trash2 } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';

export default function VisaoEmissor({ profile }) {
  const supabase = createClient();
  const { addToast } = useToast();
  
  const [emissoes, setEmissoes] = useState([]);
  const [condominios, setCondominios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
  // States do form
  const [file, setFile] = useState(null);
  const [condoId, setCondoId] = useState('');
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [tipo, setTipo] = useState('emissao');

  useEffect(() => {
    fetchDados();
    
    // Subscribe aos updates realtime para as emissoes
    const channel = supabase.channel('emissor_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_arquivos' }, () => {
        fetchEmissoes();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchDados() {
    setLoading(true);
    try {
      await Promise.all([fetchCondominios(), fetchEmissoes()]);
    } catch (err) {
      console.error("Erro no fetch inicial:", err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCondominios() {
    const { data, error } = await supabase.from('condominios').select('id, name').order('name');
    if (error) console.error("fetchCondominios error:", error);
    if (data) setCondominios(data);
  }

  async function fetchEmissoes() {
    const { data, error } = await supabase
      .from('emissoes_arquivos')
      .select('*, condominios(name)')
      .order('criado_em', { ascending: false });
    
    if (error) console.error("fetchEmissoes error:", error);
    if (data) setEmissoes(data);
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file || !condoId) return addToast('Preencha todos os campos obrigatórios', 'error');

    setIsUploading(true);
    try {
      const extensao = file.name.split('.').pop().toLowerCase();
      const randomId = Math.random().toString(36).substring(7);
      const filePath = `${condoId}/${ano}/${mes}/${randomId}_${file.name}`;
      
      // 1. Upload to Storage
      const { error: uploadError } = await supabase.storage
        .from('emissoes')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Pegar a URL pública (O bucket é privado mas podemos gerar signedUrl depois se quiser, no entanto a URL de acesso é estrutural se tiver select/ler)
      const { data: publicUrl } = supabase.storage.from('emissoes').getPublicUrl(filePath);

      // 2. Add to table
      const { error: dbError } = await supabase
        .from('emissoes_arquivos')
        .insert({
          condominio_id: condoId,
          tipo,
          arquivo_url: filePath, // guardamos o path na tabela
          arquivo_nome: file.name,
          formato: extensao,
          mes_referencia: mes,
          ano_referencia: ano,
          uploaded_by: profile.id
        });

      if (dbError) throw dbError;

      addToast('Arquivo enviado com sucesso!', 'success');
      setFile(null); // Reset file
      fetchEmissoes();

    } catch (err) {
      console.error("[DETALHE DO ERRO UPLOAD]:", err);
      const storageErrMsg = typeof err?.error === 'string' ? err.error : err?.message;
      const msgErro = storageErrMsg || 'Falha no upload do arquivo para o bucket.';
      addToast(`Erro de Storage: ${msgErro}`, 'error');
    } finally {
      setIsUploading(false);
    }
  }

  const handleDelete = async (id, path) => {
    if (!window.confirm('Deseja excluir este arquivo permanentemente? Esta ação não pode ser desfeita.')) return;
    try {
      setIsUploading(true); // Re-utilizando state de loading global de form pro fluxo todo
      // Tenta apagar do storage (se não achar não travar)
      await supabase.storage.from('emissoes').remove([path]);
      
      const { error: dbError } = await supabase.from('emissoes_arquivos').delete().eq('id', id);
      if (dbError) throw dbError;

      addToast('Arquivo excluído com sucesso.', 'success');
      setEmissoes(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-violet-500"/></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Container de Formulário */}
      <div className="lg:col-span-1 border border-white/10 rounded-3xl bg-white/5 p-6 shadow-xl h-fit sticky top-6">
        <h3 className="font-black text-white text-lg mb-6 flex items-center gap-2">
          <UploadCloud className="text-violet-400 w-5 h-5"/>
          Novo Envio
        </h3>

        <form onSubmit={handleUpload} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">Condomínio</label>
            <select
              value={condoId}
              onChange={(e) => setCondoId(e.target.value)}
              className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-violet-500 transition-colors"
              required
            >
              <option value="">Selecione...</option>
              {condominios.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">Mês</label>
              <input type="number" min="1" max="12" value={mes} onChange={e=>setMes(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">Ano</label>
              <input type="number" value={ano} onChange={e=>setAno(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-violet-500"
            >
              <option value="emissao">Emissão Normal / Planilha</option>
              <option value="cobranca_extra">Cobrança Extra</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">Arquivo PDF/XLS/IMG</label>
            <div className="w-full border-2 border-dashed border-white/10 hover:border-violet-500/50 rounded-xl p-6 text-center transition-colors bg-[#0a0a0f] relative group cursor-pointer">
              <input 
                type="file" 
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={e => setFile(e.target.files[0])}
                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                required
              />
              {file ? (
                <div className="text-sm font-bold text-violet-400 break-all px-2">{file.name}</div>
              ) : (
                <div className="text-gray-500 text-sm">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50 group-hover:text-violet-400 transition-colors" />
                  Clique ou arraste
                </div>
              )}
            </div>
          </div>

          <button 
            type="submit" 
            disabled={isUploading}
            className="w-full py-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-widest text-[13px] shadow-[0_0_20px_rgba(139,92,246,0.3)] transition-all flex items-center justify-center gap-2"
          >
            {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Enviar Arquivo'}
          </button>
        </form>
      </div>

      {/* Lista de Envios */}
      <div className="lg:col-span-2">
        <h3 className="font-black text-white text-lg mb-6 flex items-center gap-2">
          <Clock className="text-cyan-400 w-5 h-5"/>
          Histórico de Envios
        </h3>

        {emissoes.length === 0 ? (
          <div className="text-center p-12 border border-white/10 rounded-3xl bg-white/5">
            <span className="text-gray-500">Nenhum arquivo enviado ainda.</span>
          </div>
        ) : (
          <div className="space-y-4">
            {emissoes.map(doc => (
              <div key={doc.id} className="flex flex-wrap items-center justify-between p-5 border border-white/10 rounded-2xl bg-[#0a0a0f] hover:bg-white/5 transition-colors group gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center group-hover:bg-violet-500/10 transition-colors">
                    <FileText className="w-6 h-6 text-gray-400 group-hover:text-violet-400" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white max-w-[200px] sm:max-w-xs truncate" title={doc.condominios?.name}>
                      {doc.condominios?.name || 'Condomínio Excluído'}
                    </h4>
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">
                      {doc.tipo.replace('_', ' ')} • {String(doc.mes_referencia).padStart(2, '0')}/{doc.ano_referencia}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate max-w-[200px] mt-1">{doc.arquivo_nome}</p>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => handleDelete(doc.id, doc.arquivo_url)} 
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-500 hover:text-rose-400 hover:border-rose-500/50 hover:bg-rose-500/10 transition-colors"
                      title="Apagar este envio"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <StatusBadge status={doc.status} />
                  </div>
                  {doc.status === 'solicitar_correcao' && doc.comentario_correcao && (
                    <div className="text-xs text-rose-400 bg-rose-500/10 px-3 py-1.5 rounded-lg max-w-[200px] truncate flex items-center gap-1" title={doc.comentario_correcao}>
                      <AlertCircle className="w-3 h-3 shrink-0" /> {doc.comentario_correcao}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">
                    {new Date(doc.criado_em).toLocaleDateString('pt-BR')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
