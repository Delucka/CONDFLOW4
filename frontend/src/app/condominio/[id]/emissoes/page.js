'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { 
  FileText, Download, Trash2, Calendar, FileUp, 
  Building2, PlusCircle, ShieldAlert, Loader2
} from 'lucide-react';
import Link from 'next/link';

export default function CondominioEmissoesPage() {
  const params = useParams();
  const condoId = params.id;
  const { user, profile } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef(null);

  const [condo, setCondo] = useState(null);
  const [emissoes, setEmissoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Form de Upload
  const [file, setFile] = useState(null);
  const todaysMonth = new Date().getMonth() + 1;
  const todaysYear = new Date().getFullYear();
  const [formMesAno, setFormMesAno] = useState(`${String(todaysMonth).padStart(2, '0')}/${todaysYear}`);
  const [formTipo, setFormTipo] = useState('Boleto');

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const { data: condoData } = await supabase
        .from('condominios')
        .select('*')
        .eq('id', condoId)
        .single();
      
      setCondo(condoData);

      const { data: filesData } = await supabase
        .from('emissoes')
        .select('*, profiles(full_name)')
        .eq('condominio_id', condoId)
        .order('criado_em', { ascending: false });
        
      setEmissoes(filesData || []);
    } catch (err) {
      console.error(err);
      addToast('Erro ao carregar arquivos do condomínio.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condoId]);

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const clearForm = () => {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
      if (!file) {
          addToast('Selecione um arquivo para enviar.', 'warning');
          return;
      }
      if (!formMesAno.match(/^\d{2}\/\d{4}$/)) {
          addToast('Formato de mês/ano inválido. Use MM/YYYY.', 'warning');
          return;
      }

      try {
          setUploading(true);
          const fileExt = file.name.split('.').pop();
          const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          const time = new Date().getTime();
          const filePath = `${condoId}/${formMesAno.replace('/', '_')}/${formTipo}_${time}_${safeName}`;

          // 1. Upload to Storage
          const { data: storageData, error: storageError } = await supabase.storage
              .from('emissoes')
              .upload(filePath, file, { cacheControl: '3600', upsert: false });

          if (storageError) {
              console.error(storageError);
              throw new Error('Falha no upload do arquivo para o bucket.');
          }

          // 2. Insert into DB Table
          const { data: dbData, error: dbError } = await supabase
              .from('emissoes')
              .insert({
                  condominio_id: condoId,
                  mes_ano: formMesAno,
                  tipo: formTipo,
                  nome_arquivo: file.name,
                  storage_path: storageData.path,
                  tamanho_bytes: file.size,
                  criado_por: profile?.id
              }).select('*, profiles(full_name)').single();

          if (dbError) throw dbError;

          setEmissoes([dbData, ...emissoes]);
          addToast('Arquivo enviado com sucesso!', 'success');
          clearForm();

      } catch (err) {
          console.error(err);
          addToast(err.message, 'error');
      } finally {
          setUploading(false);
      }
  };


  const handleDownload = async (emissao) => {
      try {
          const { data, error } = await supabase.storage
            .from('emissoes')
            .download(emissao.storage_path);
          
          if (error) throw error;
          
          const url = URL.createObjectURL(data);
          const a = document.createElement('a');
          a.href = url;
          a.download = emissao.nome_arquivo;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
      } catch (err) {
          addToast('Erro ao baixar arquivo.', 'error');
      }
  };

  const handleDelete = async (id, path) => {
      if (!window.confirm('Deletar este arquivo permanentemente?')) return;
      try {
          // Remove do bucket
          const { error: storageError } = await supabase.storage.from('emissoes').remove([path]);
          if (storageError) throw storageError;

          // Remove do BD
          const { error: dbError } = await supabase.from('emissoes').delete().eq('id', id);
          if (dbError) throw dbError;

          setEmissoes(prev => prev.filter(e => e.id !== id));
          addToast('Deletado com sucesso', 'success');
      } catch (err) {
          addToast('Erro ao deletar: ' + err.message, 'error');
      }
  };

  const formatSize = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const canEdit = profile?.role === 'master' || profile?.role === 'emissor';

  return (
    <div className="animate-fade-in w-full h-full pb-20">
      
      {/* ─── HEADER PREMIUM ─── */}
      <div className="glass-panel p-6 mb-8 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex flex-col gap-4 w-full">
            <div className="flex items-center gap-5">
                <div className="w-14 h-14 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                    <FileUp className="w-7 h-7 text-blue-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-white tracking-tight uppercase leading-none">{condo?.name || 'Condomínio'}</h1>
                    <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            Gestão de Emissões (Arquivos)
                        </span>
                    </div>
                </div>
            </div>

            {/* TAB NAVIGATION SIMPLES */}
            <div className="flex gap-4 border-t border-white/5 pt-4">
                <Link href={`/condominio/${condoId}/arrecadacoes`} className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                    Arrecadações
                </Link>
                <button className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg bg-blue-500 text-slate-900 shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                    Emissões (Arquivos)
                </button>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* UPLOAD PANEL */}
          {canEdit && (
              <div className="col-span-12 lg:col-span-4">
                  <div className="glass-panel p-6 rounded-2xl sticky top-24">
                      <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
                          <PlusCircle className="w-4 h-4 text-blue-400" /> 
                          Enviar Novo Arquivo
                      </h3>

                      <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Mês/Ano Referência</label>
                                <input 
                                    type="text" 
                                    placeholder="MM/YYYY"
                                    value={formMesAno}
                                    onChange={e => setFormMesAno(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white font-bold outline-none focus:border-blue-500" 
                                />
                            </div>
                            
                            <div>
                                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Tipo de Documento</label>
                                <select 
                                    value={formTipo}
                                    onChange={e => setFormTipo(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white font-bold outline-none focus:border-blue-500"
                                >
                                    <option value="Boleto">Boleto de Cobrança</option>
                                    <option value="Balancete">Balancete Mensal</option>
                                    <option value="Relatório">Relatório Financeiro</option>
                                    <option value="Outros">Outros Documentos</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Arquivo (PDF, Imagem, etc)</label>
                                <div className="border border-dashed border-slate-600 rounded-lg p-4 bg-slate-900 hover:bg-slate-800 transition-colors text-center cursor-pointer relative">
                                    <input 
                                        type="file" 
                                        ref={fileInputRef}
                                        onChange={handleFileSelect}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.zip"
                                    />
                                    {file ? (
                                        <div className="flex flex-col items-center">
                                            <FileText className="w-8 h-8 text-blue-400 mb-2" />
                                            <span className="text-xs font-bold text-white truncate max-w-[200px]">{file.name}</span>
                                            <span className="text-[10px] text-slate-500">{formatSize(file.size)}</span>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center pointer-events-none">
                                            <FileUp className="w-8 h-8 text-slate-500 mb-2" />
                                            <span className="text-xs font-bold text-slate-300">Clique ou arraste um arquivo</span>
                                            <span className="text-[9px] text-slate-500 mt-1">Limite recomendado: 50MB</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                      </div>

                      <button 
                          onClick={handleUpload}
                          disabled={!file || uploading}
                          className="w-full py-3 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:hover:bg-blue-500 text-slate-950 text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-500/20 flex justify-center items-center gap-2"
                      >
                          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                          {uploading ? 'Enviando...' : 'Salvar Emissão'}
                      </button>
                  </div>
              </div>
          )}

          {/* LIST OF FILES */}
          <div className="col-span-12 lg:col-span-8">
              <div className="glass-panel p-6 rounded-2xl min-h-[500px]">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-400" /> 
                      Histórico de Emissões
                  </h3>

                  {loading ? (
                      <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>
                  ) : emissoes.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-20 text-center border border-dashed border-white/10 rounded-2xl">
                          <ShieldAlert className="w-12 h-12 text-slate-600 mb-4" />
                          <h4 className="text-sm font-black text-white uppercase tracking-widest mb-2">Nenhum Documento</h4>
                          <p className="text-xs font-bold text-slate-500">Este condomínio ainda não possui emissões cadastradas no sistema.</p>
                      </div>
                  ) : (
                      <div className="grid gap-4">
                          {emissoes.map(e => (
                              <div key={e.id} className="bg-black/30 border border-white/5 p-4 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-blue-500/30 transition-colors">
                                  <div className="flex items-center gap-4 w-full md:w-auto">
                                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${e.tipo === 'Boleto' ? 'bg-emerald-500/10 text-emerald-400' : e.tipo === 'Balancete' ? 'bg-violet-500/10 text-violet-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                          <FileText className="w-6 h-6" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                          <div className="flex flex-col md:flex-row md:items-center gap-2 mb-1">
                                            <h5 className="text-sm font-black text-white truncate" title={e.nome_arquivo}>{e.nome_arquivo}</h5>
                                            <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-slate-800 text-slate-300 w-max shrink-0">{e.tipo}</span>
                                          </div>
                                          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest flex-wrap">
                                              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {e.mes_ano}</span>
                                              <span>•</span>
                                              <span>{formatSize(e.tamanho_bytes)}</span>
                                              <span>•</span>
                                              <span>Por: {e.profiles?.full_name?.split(' ')[0] || 'Desconhecido'}</span>
                                          </div>
                                      </div>
                                  </div>

                                  <div className="flex items-center gap-2 w-full md:w-auto justify-end mt-2 md:mt-0">
                                      {canEdit && (
                                          <button onClick={() => handleDelete(e.id, e.storage_path)} className="p-2 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-all" title="Excluir">
                                              <Trash2 className="w-4 h-4" />
                                          </button>
                                      )}
                                      <button onClick={() => handleDownload(e)} className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-slate-900 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all w-full md:w-auto justify-center">
                                          <Download className="w-4 h-4" />
                                          Baixar
                                      </button>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
      </div>

    </div>
  );
}
