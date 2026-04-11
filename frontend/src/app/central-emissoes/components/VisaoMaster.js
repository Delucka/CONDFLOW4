'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Layers, CheckCircle, Clock, AlertCircle, FileText, ExternalLink, Activity, Loader2, Trash2 } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';

export default function VisaoMaster() {
  const supabase = createClient();
  const { addToast } = useToast();
  
  const [arquivos, setArquivos] = useState([]);
  const [loading, setLoading] = useState(true);

  // Dash stats
  const stats = {
    total: arquivos.length,
    pendentes: arquivos.filter(a => a.status === 'pendente').length,
    aprovados: arquivos.filter(a => a.status === 'aprovado').length,
    correcao: arquivos.filter(a => a.status === 'solicitar_correcao').length,
  };

  useEffect(() => {
    fetchTodosArquivos();
    
    const channel = supabase.channel('master_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_arquivos' }, () => {
        fetchTodosArquivos();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchTodosArquivos() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('emissoes_arquivos')
        .select('*, condominios(name), profiles:uploaded_by(full_name)')
        .order('criado_em', { ascending: false });
      
      if (error) console.error("fetchTodosArquivos erro:", error);
      if (data) setArquivos(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function openFileUrl(path) {
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(path, 60);
    
    if (error) {
      console.error(error);
      addToast('Erro ao abrir o arquivo privado.', 'error');
      return;
    }
    
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank');
    }
  }

  const handleDelete = async (id, path) => {
    if (!window.confirm('Excluir arquivo permanentemente da base e do painel do gerente?')) return;
    try {
        await supabase.storage.from('emissoes').remove([path]);
        const { error: dbError } = await supabase.from('emissoes_arquivos').delete().eq('id', id);
        if (dbError) throw dbError;
        setArquivos(prev => prev.filter(e => e.id !== id));
        addToast('Registro apagado com sucesso', 'success');
    } catch (err) {
        addToast('Falha na exclusão: ' + err.message, 'error');
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-violet-500"/></div>;

  return (
    <div className="space-y-8">
      
      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total de Envios', value: stats.total, icon: Layers, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Aguardando Análise', value: stats.pendentes, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
          { label: 'Aprovados', value: stats.aprovados, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Em Correção', value: stats.correcao, icon: AlertCircle, color: 'text-rose-400', bg: 'bg-rose-500/10' }
        ].map((stat, i) => (
          <div key={i} className={`p-6 border border-white/10 rounded-3xl bg-[#0a0a0f] flex items-center gap-4 ${stat.bg}`}>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 mix-blend-lighten ${stat.bg} shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-3xl font-black text-white leading-none">{stat.value}</p>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabela Master */}
      <div className="border border-white/10 rounded-3xl bg-white/5 overflow-hidden shadow-2xl relative">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-black text-white text-lg flex items-center gap-2">
            <Activity className="text-cyan-400 w-5 h-5"/>
            Fluxo Geral da Operação
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#0a0a0f]">
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500 whitespace-nowrap">Condomínio</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500 whitespace-nowrap">Emissor</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500 whitespace-nowrap">Tipo/Ref</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500 whitespace-nowrap">Status</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500 whitespace-nowrap text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {arquivos.map(doc => (
                <tr key={doc.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold text-white text-sm max-w-[200px] truncate">{doc.condominios?.name}</p>
                    <p className="text-[10px] text-gray-500 truncate">{doc.arquivo_nome}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-bold text-gray-300 text-sm">{doc.profiles?.full_name}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs font-bold text-cyan-400 uppercase tracking-widest">{doc.tipo.replace('_', ' ')}</p>
                    <p className="text-[10px] text-gray-500">{String(doc.mes_referencia).padStart(2,'0')}/{doc.ano_referencia}</p>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => openFileUrl(doc.arquivo_url)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5"/>
                        Abrir
                      </button>
                      <button 
                        onClick={() => handleDelete(doc.id, doc.arquivo_url)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-xs font-bold text-rose-400 hover:text-rose-300 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5"/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {arquivos.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-6 py-12 text-center text-gray-500 text-sm">
                    Nenhum registro encontrado no sistema.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
