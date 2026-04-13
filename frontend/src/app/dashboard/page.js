'use client';
import { useState } from 'react';
import useSWR from 'swr';
import StatsCard from '@/components/StatsCard';
import StatusBadge from '@/components/StatusBadge';
import { apiFetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Building, FileEdit, Clock, CheckCircle2, Inbox, Layers, Receipt, AlertCircle, Eye } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';

export default function DashboardPage() {
  const [filtroGerente, setFiltroGerente] = useState('');
  const { user } = useAuth();
  const supabase = createClient();
  const { addToast } = useToast();
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // ALTO FLUXO: SWR gerencia cache e revalidação automática
  const query = filtroGerente ? `?gerente_id=${filtroGerente}` : '';
  const { data, error, isLoading } = useSWR(`/api/dashboard${query}`, apiFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000
  });

  const handleQuickView = async (condoId) => {
    try {
      const { data: fileData, error: fileError } = await supabase
        .from('emissoes_arquivos')
        .select('*')
        .eq('condominio_id', condoId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fileError) throw fileError;
      if (!fileData) {
        addToast('Nenhum informativo disponível para visualização.', 'warning');
        return;
      }

      const { data: urlData, error: urlError } = await supabase.storage
        .from('emissoes')
        .createSignedUrl(fileData.arquivo_url, 60);

      if (urlError) throw urlError;

      setSelectedFile({
        name: fileData.arquivo_nome,
        url: urlData.signedUrl,
        format: fileData.arquivo_nome.split('.').pop()
      });
      setIsDrawerOpen(true);
    } catch (err) {
      console.error(err);
      addToast('Não foi possível abrir a prévia.', 'error');
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center glass-panel rounded-3xl">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">Erro de Conexão</h3>
        <p className="text-slate-400 mb-6">Não foi possível carregar os dados do painel.</p>
        <button onClick={() => window.location.reload()} className="px-6 py-2 bg-slate-800 rounded-xl font-bold border border-slate-700">TENTAR NOVAMENTE</button>
      </div>
    );
  }

  // Fallback para quando os dados estão carregando ou não existem
  const stats = data?.stats || { total: 0, em_edicao: 0, pendentes: 0, aprovados: 0 };
  const condos = data?.condos || [];
  const gerentes = data?.gerentes || [];

  return (
    <div className="animate-fade-in w-full h-full relative space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Condomínios" value={stats.total} icon={Building} color="cyan" loading={isLoading} />
        <StatsCard title="Em Edição" value={stats.em_edicao} icon={FileEdit} color="orange" loading={isLoading} />
        <StatsCard title="Pendentes" value={stats.pendentes} icon={Clock} color="indigo" loading={isLoading} />
        <StatsCard title="Aprovados" value={stats.aprovados} icon={CheckCircle2} color="emerald" loading={isLoading} />
      </div>

      {/* Tabela de Condomínios */}
      <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-white/5 flex flex-wrap items-center justify-between gap-4 bg-white/5">
          <div>
            <h3 className="text-lg font-black text-white leading-none">
              Informativo Semestral
            </h3>
            <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold mt-1">
              PERÍODO: {data?.year || '—'} / {data?.semester === 1 ? '1º' : '2º'} SEMESTRE
            </p>
          </div>
          
          {user?.role !== 'gerente' && (
            <div className="flex items-center gap-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Filtrar por Gerente:</label>
              <select
                value={filtroGerente}
                onChange={(e) => setFiltroGerente(e.target.value)}
                className="text-xs bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-slate-200 outline-none focus:border-cyan-500 transition-all cursor-pointer"
              >
                <option value="">TODOS</option>
                {gerentes.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.profiles?.full_name || '—'}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="p-24 text-center">
            <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-sm font-bold text-slate-500 tracking-widest uppercase">Processando Dados...</p>
          </div>
        ) : condos.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-white/5 border-b border-white/5 text-[10px] uppercase tracking-[0.2em] font-black text-slate-500">
                  <th className="px-6 py-4">Condomínio</th>
                  <th className="px-6 py-4">Gerente Responsável</th>
                  <th className="px-6 py-4">Status Atual</th>
                  <th className="px-6 py-4 text-right">Ações Rápidas</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-white/5">
                {condos.map((c) => {
                  const status = data?.processos?.[c.id]?.status || 'Sem processo';
                  
                  return (
                    <tr key={c.id} className="hover:bg-white/5 transition-colors group">
                      <td className="px-6 py-5">
                         <p className="font-bold text-gray-100 group-hover:text-cyan-400 transition-colors uppercase tracking-tight">{c.name}</p>
                         <p className="text-[10px] text-gray-500 font-medium">Vencimento: Dia {c.due_day || '—'}</p>
                      </td>
                      <td className="px-6 py-5 text-gray-400 font-medium">
                        {c.gerente_name || '—'}
                      </td>
                      <td className="px-6 py-5">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-6 py-5 text-right flex gap-2 justify-end">
                        <Link
                          href={`/condominio/${c.id}/arrecadacoes`}
                          className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-cyan-500/20"
                          title="Arrecadações"
                        >
                          <Layers className="w-4 h-4" />
                        </Link>
                        <Link
                          href={`/condominio/${c.id}/cobrancas`}
                          className="p-2.5 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-orange-500/20"
                          title="Cobranças Extras"
                        >
                          <Receipt className="w-4 h-4" />
                        </Link>
                        
                        <button
                          onClick={() => handleQuickView(c.id)}
                          className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-violet-500/20"
                          title="Visualizar Informativo"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-20 text-center">
            <Inbox className="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <p className="text-slate-300 font-bold">Nenhum condomínio encontrado</p>
            <p className="text-slate-500 text-xs mt-1">Não há registros correspondentes aos seus filtros.</p>
          </div>
        )}
      </div>

      <FilePreviewDrawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        file={selectedFile} 
      />
    </div>
  );
}
