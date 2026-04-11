'use client';

import { useEffect, useState } from 'react';
import StatsCard from '@/components/StatsCard';
import StatusBadge from '@/components/StatusBadge';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Building, FileEdit, Clock, CheckCircle2, Inbox, Layers, Receipt } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const [data, setData] = useState({ condos: [], stats: {}, gerentes: [] });
  const [loading, setLoading] = useState(true);
  const [filtroGerente, setFiltroGerente] = useState('');
  
  const { user } = useAuth();
  const { addToast } = useToast();

  useEffect(() => {
    async function carregarDashboard() {
      try {
        setLoading(true);
        const supabase = createClient();
        
        let queryCondos = supabase.from('condominios').select('*, gerentes(id, profiles(full_name))').order('name');
        
        // Se for gerente, forçar o filtro pelo seu próprio ID
        if (user?.role === 'gerente') {
          queryCondos = queryCondos.eq('gerente_id', user.id);
        } else if (filtroGerente) {
          queryCondos = queryCondos.eq('gerente_id', filtroGerente);
        }
        
        const [ { data: condos }, { data: gerentes }, { data: processos } ] = await Promise.all([
          queryCondos,
          supabase.from('gerentes').select('id, profiles(full_name)'),
          supabase.from('processos').select('*')
        ]);
        
        const procMap = {};
        let em_edicao = 0, pendentes = 0, aprovados = 0;
        
        if (processos) {
          processos.forEach(p => {
            procMap[p.condominio_id] = p;
            if (p.status === 'Em edição' || p.status === 'Solicitar alteração') em_edicao++;
            if (p.status === 'Enviado' || p.status === 'Em aprovação') pendentes++;
            if (p.status === 'Aprovado' || p.status === 'Emitido') aprovados++;
          });
        }
        
        const formattedCondos = condos ? condos.map(c => {
          let gName = '—';
          if (c.gerentes?.profiles) {
            gName = Array.isArray(c.gerentes.profiles) ? c.gerentes.profiles[0]?.full_name : c.gerentes.profiles.full_name;
          }
          return { ...c, gerente_name: gName };
        }) : [];

        setData({
          condos: formattedCondos,
          stats: { total: formattedCondos.length, em_edicao, pendentes, aprovados },
          gerentes: gerentes || [],
          processos: procMap,
          year: new Date().getFullYear(),
          semester: new Date().getMonth() < 6 ? 1 : 2
        });
      } catch (err) {
        addToast(err.message || 'Erro ao carregar dashboard', 'error');
      } finally {
        setLoading(false);
      }
    }
    carregarDashboard();
  }, [filtroGerente, addToast]);

  return (
    <div className="animate-fade-in w-full h-full relative">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Condomínios" value={data.stats.total || 0} icon={Building} color="cyan" />
        <StatsCard title="Em Edição" value={data.stats.em_edicao || 0} icon={FileEdit} color="orange" />
        <StatsCard title="Pendentes" value={data.stats.pendentes || 0} icon={Clock} color="indigo" />
        <StatsCard title="Aprovados" value={data.stats.aprovados || 0} icon={CheckCircle2} color="emerald" />
      </div>

      {/* Tabela de Condomínios */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-800/30">
          <h3 className="text-sm font-semibold text-slate-200">
            Condomínios — {data.year || new Date().getFullYear()}/{data.semester === 1 ? '1º' : '2º'} Semestre
          </h3>
          
          {user?.role === 'master' && (
            <div className="flex items-center gap-2">
              <select
                value={filtroGerente}
                onChange={(e) => setFiltroGerente(e.target.value)}
                className="text-xs border border-slate-700 bg-slate-800 rounded-lg px-3 py-1.5 text-slate-300 focus:ring-cyan-500 focus:border-cyan-500 outline-none"
              >
                <option value="">Todos os Gerentes</option>
                {data.gerentes?.map((g) => {
                  const name = g.profiles?.full_name || (Array.isArray(g.profiles) ? g.profiles[0]?.full_name : '—');
                  return (
                    <option key={g.id} value={g.id}>
                      {name}
                    </option>
                  );
                })}
              </select>
              {filtroGerente && (
                <button
                  onClick={() => setFiltroGerente('')}
                  className="text-xs text-slate-500 hover:text-red-400 transition-colors"
                >
                  Limpar
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-16 text-center text-slate-500">
            <Clock className="w-8 h-8 animate-spin-slow mx-auto mb-4 text-cyan-500/50" />
            Carregando dados...
          </div>
        ) : data.condos?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-800/50 border-b border-slate-800 text-[11px] uppercase tracking-wider font-semibold text-slate-400">
                  <th className="px-5 py-3">Condomínio</th>
                  <th className="px-5 py-3">Gerente</th>
                  <th className="px-5 py-3">Vencimento</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-800/50">
                {data.condos.map((c) => {
                  const proc = data.processos?.[c.id];
                  const status = proc?.status || 'Sem processo';
                  
                  return (
                    <tr key={c.id} className="hover:bg-slate-800/30 transition-colors group">
                      <td className="px-5 py-4 font-medium text-slate-200">{c.name}</td>
                      <td className="px-5 py-4 text-slate-400">{c.gerente_name || '—'}</td>
                      <td className="px-5 py-4 text-slate-400">Dia {c.due_day || '—'}</td>
                      <td className="px-5 py-4">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-5 py-4 text-right space-x-2">
                        <Link
                          href={`/condominio/${c.id}/arrecadacoes`}
                          className="inline-flex items-center gap-1.5 text-cyan-400 border border-slate-700 bg-slate-800 hover:border-cyan-500/50 hover:bg-slate-700/50 px-3 py-1.5 rounded-lg font-semibold text-[11px] transition-all"
                        >
                          <Layers className="w-3.5 h-3.5" /> Arrecadações
                        </Link>
                        <Link
                          href={`/condominio/${c.id}/cobrancas`}
                          className="inline-flex items-center gap-1.5 text-orange-400 border border-slate-700 bg-slate-800 hover:border-orange-500/50 hover:bg-slate-700/50 px-3 py-1.5 rounded-lg font-semibold text-[11px] transition-all"
                        >
                          <Receipt className="w-3.5 h-3.5" /> Extras
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-slate-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-700/50">
              <Inbox className="w-8 h-8 text-slate-500" />
            </div>
            <p className="text-slate-300 font-semibold text-lg">Nenhum condomínio encontrado</p>
            <p className="text-slate-500 text-sm mt-2 max-w-sm mx-auto">Não há condomínios cadastrados ou que correspondam ao filtro.</p>
          </div>
        )}
      </div>
    </div>
  );
}
