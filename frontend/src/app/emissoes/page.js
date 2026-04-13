'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { 
  FileText, Search, Download, Trash2, Calendar, FileUp, Filter, Building2, MapPin, Inbox
} from 'lucide-react';
import Link from 'next/link';

export default function CentralEmissoesPage() {
  const { user, profile } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [emissoes, setEmissoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFilter, setTipoFilter] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('emissoes')
        .select(`
            *,
            condominios ( id, name, code ),
            profiles ( full_name )
        `)
        .order('criado_em', { ascending: false });
      
      const { data, error } = await query;
      if (error) throw error;
      setEmissoes(data || []);
    } catch (err) {
      console.error(err);
      addToast('Erro ao carregar emissões: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

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
      if (!window.confirm('Certeza que deseja deletar este arquivo permanentemente?')) return;
      try {
          // Remove do bucket
          const { error: storageError } = await supabase.storage.from('emissoes').remove([path]);
          if (storageError) throw storageError;

          // Remove do BD
          const { error: dbError } = await supabase.from('emissoes').delete().eq('id', id);
          if (dbError) throw dbError;

          setEmissoes(prev => prev.filter(e => e.id !== id));
          addToast('Arquivo deletado com sucesso', 'success');
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

  const filtered = emissoes.filter(e => {
      const matchSearch = (e.nome_arquivo?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                          (e.condominios?.name?.toLowerCase() || '').includes(searchTerm.toLowerCase());
      const matchTipo = tipoFilter ? e.tipo === tipoFilter : true;
      return matchSearch && matchTipo;
  });

  return (
    <div className="animate-fade-in w-full h-full pb-20">
      
      {/* HEADER */}
      <div className="glass-panel p-8 mb-8 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                <FileUp className="w-8 h-8 text-blue-400" />
            </div>
            <div>
                <h1 className="text-3xl font-black text-white tracking-tight uppercase leading-none mb-2">Central de Emissões</h1>
                <p className="text-slate-400 text-sm font-medium">Hub global de PDFs e relatórios gerados.</p>
            </div>
        </div>

        <div className="flex gap-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Buscar arquivo ou condomínio..." 
                    className="pl-10 pr-4 py-2 bg-black/40 border border-white/10 rounded-xl text-sm font-bold text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 w-[300px]"
                />
            </div>
            <select 
                value={tipoFilter}
                onChange={e => setTipoFilter(e.target.value)}
                className="px-4 py-2 bg-black/40 border border-white/10 rounded-xl text-sm font-bold text-slate-300 focus:outline-none focus:border-blue-500"
            >
                <option value="">Todos os Tipos</option>
                <option value="Boleto">Boletos</option>
                <option value="Balancete">Balancetes</option>
                <option value="Relatório">Relatórios</option>
                <option value="Outros">Outros</option>
            </select>
        </div>
      </div>

      {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Sincronizando PDFs...</span>
          </div>
      ) : filtered.length === 0 ? (
          <div className="glass-panel p-16 rounded-3xl flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 bg-blue-500/5 rounded-full flex items-center justify-center mb-6">
                <Inbox className="w-10 h-10 text-blue-500/40" />
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-tight mb-2">Nenhum arquivo encontrado</h3>
              <p className="text-slate-500 text-sm">Os arquivos enviados diretamente das pastas dos condomínios aparecerão aqui.</p>
          </div>
      ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {filtered.map(e => (
                  <div key={e.id} className="glass-panel p-5 rounded-2xl hover:border-blue-500/30 transition-colors group flex flex-col">
                      <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
                                  <FileText className={`w-5 h-5 ${e.tipo === 'Boleto' ? 'text-emerald-400' : e.tipo === 'Balancete' ? 'text-violet-400' : 'text-blue-400'}`} />
                              </div>
                              <div>
                                  <h4 className="text-sm font-black text-white truncate max-w-[200px]" title={e.nome_arquivo}>{e.nome_arquivo}</h4>
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{formatSize(e.tamanho_bytes)}</span>
                              </div>
                          </div>
                      </div>

                      <div className="bg-black/20 p-3 rounded-lg mb-4 flex-1">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-300 mb-1.5 truncate">
                              <Building2 className="w-3.5 h-3.5 text-slate-500" />
                              <Link href={`/condominio/${e.condominio_id}/emissoes`} className="hover:text-blue-400 transition-colors">
                                {e.condominios?.name || 'Condomínio Desconhecido'}
                              </Link>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                              <Calendar className="w-3 h-3" /> Ref: <span className="text-blue-400">{e.mes_ano}</span>
                          </div>
                      </div>

                      <div className="flex justify-between items-center pt-3 border-t border-white/5 mt-auto">
                          <span className="text-[9px] font-black text-slate-600 uppercase">
                              Por: {e.profiles?.full_name?.split(' ')[0] || 'Desconhecido'}
                          </span>
                          <div className="flex gap-2">
                              <button onClick={() => handleDelete(e.id, e.storage_path)} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                                  <Trash2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDownload(e)} className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-slate-900 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all">
                                  <Download className="w-3.5 h-3.5" />
                                  Baixar
                              </button>
                          </div>
                      </div>
                  </div>
              ))}
          </div>
      )}
    </div>
  );
}
