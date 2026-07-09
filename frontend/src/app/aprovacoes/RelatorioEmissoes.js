'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { gerarCsv, gerarPdfTabela } from '@/lib/relatorios';
import { FileSpreadsheet, FileText, Loader2, BarChart3 } from 'lucide-react';

const MESES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const VE_TUDO = ['master', 'departamento', 'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'];
const prettyStatus = (s) => (s || '—').replace(/_/g, ' ').replace(/\bsup\b/gi, 'sup.');
const fmtData = (ts) => { try { return ts ? new Date(ts).toLocaleDateString('pt-BR') : ''; } catch { return ''; } };

// Colunas do relatório "Emissões por período"
const COLUNAS = [
  { key: 'condominio',  label: 'Condomínio', width: 3.2, value: (r) => r.condominios?.name || '—' },
  { key: 'competencia', label: 'Competência', width: 1.3, value: (r) => `${String(r.mes_referencia || '').padStart(2, '0')}/${r.ano_referencia || ''}` },
  { key: 'status',      label: 'Status', width: 1.8, value: (r) => prettyStatus(r.status) },
  { key: 'nivel',       label: 'Nível aprovação', width: 1.6, value: (r) => prettyStatus(r.nivel_aprovacao) },
  { key: 'emitido_por', label: 'Emitido/atualizado por', width: 2.2, value: (r) => r.profiles?.full_name || '—' },
  { key: 'criado_em',   label: 'Criado em', width: 1.3, value: (r) => fmtData(r.criado_em) },
  { key: 'atualizado',  label: 'Atualizado em', width: 1.3, value: (r) => fmtData(r.atualizado_em) },
];

export default function RelatorioEmissoes() {
  const { profile, user } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const role = profile?.role;

  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [mes, setMes] = useState(0);            // 0 = ano inteiro
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [gerando, setGerando] = useState(null); // 'csv' | 'pdf'

  // Resolve os condomínios da carteira (só p/ gerente/assistente; os outros veem tudo)
  const carteiraCondoIds = useCallback(async () => {
    if (VE_TUDO.includes(role)) return null;   // null = sem filtro (vê tudo)
    const gerenteProfileId = role === 'assistente' ? profile?.gerente_id : user?.id;
    if (!gerenteProfileId) return [];
    const { data: g } = await supabase.from('gerentes').select('id').eq('profile_id', gerenteProfileId).maybeSingle();
    if (!g) return [];
    const { data: condos } = await supabase.from('condominios').select('id').eq('gerente_id', g.id);
    return (condos || []).map((c) => c.id);
  }, [role, profile?.gerente_id, user?.id, supabase]);

  const buscar = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('emissoes_pacotes')
        .select('id, mes_referencia, ano_referencia, status, nivel_aprovacao, criado_em, atualizado_em, condominio_id, condominios(name), profiles:uploaded_by(full_name)')
        .eq('ano_referencia', ano)
        .neq('status', 'rascunho')
        .order('atualizado_em', { ascending: false })
        .limit(5000);
      if (mes) q = q.eq('mes_referencia', mes);

      const ids = await carteiraCondoIds();
      if (ids !== null) {
        if (ids.length === 0) { setRows([]); setLoading(false); return; }
        q = q.in('condominio_id', ids);
      }
      const { data, error } = await q;
      if (error) throw error;
      // ordena por nome do condomínio + competência (leitura melhor no relatório)
      const ordenado = (data || []).sort((a, b) =>
        (a.condominios?.name || '').localeCompare(b.condominios?.name || '') ||
        (a.mes_referencia || 0) - (b.mes_referencia || 0));
      setRows(ordenado);
    } catch (e) {
      addToast(e.message || 'Erro ao buscar emissões', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, ano, mes, carteiraCondoIds, addToast]);

  useEffect(() => { buscar(); }, [buscar]);

  const periodoLabel = mes ? `${MESES[mes]}/${ano}` : `Ano ${ano}`;
  const baseNome = `emissoes_${mes ? String(mes).padStart(2, '0') + '-' : ''}${ano}`;

  const baixarCsv = () => {
    setGerando('csv');
    try { gerarCsv(baseNome, COLUNAS, rows); addToast('Excel (CSV) gerado.', 'success'); }
    catch (e) { addToast(e.message || 'Falha ao gerar CSV', 'error'); }
    finally { setGerando(null); }
  };
  const baixarPdf = async () => {
    setGerando('pdf');
    try {
      await gerarPdfTabela({
        titulo: 'Relatório de Emissões',
        subtitulo: `${periodoLabel} · ${rows.length} emissão(ões) · gerado em ${new Date().toLocaleString('pt-BR')}`,
        columns: COLUNAS, rows, filename: baseNome,
      });
      addToast('PDF gerado.', 'success');
    } catch (e) { addToast(e.message || 'Falha ao gerar PDF', 'error'); }
    finally { setGerando(null); }
  };

  const anos = Array.from({ length: 6 }, (_, i) => anoAtual - i);

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 rounded-2xl border border-slate-200 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center shrink-0">
          <BarChart3 className="w-5 h-5 text-violet-500" />
        </div>
        <div>
          <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Emissões por período</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Escolha o período e baixe em Excel ou PDF. {VE_TUDO.includes(role) ? 'Todos os condomínios.' : 'Sua carteira.'}</p>
        </div>
      </div>

      {/* Filtros + ações */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-200 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ano</label>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            <option value={0}>Ano inteiro</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{MESES[m]}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 mr-1">{loading ? '…' : `${rows.length} emissão(ões)`}</span>
          <button onClick={baixarCsv} disabled={loading || gerando || rows.length === 0}
            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
            {gerando === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Excel
          </button>
          <button onClick={baixarPdf} disabled={loading || gerando || rows.length === 0}
            className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
            {gerando === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF
          </button>
        </div>
      </div>

      {/* Prévia */}
      <div className="glass-panel rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>{COLUNAS.map((c) => <th key={c.key} className="px-3 py-2 font-black text-slate-600 uppercase tracking-wider text-[10px] whitespace-nowrap">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={COLUNAS.length} className="px-3 py-10 text-center"><Loader2 className="w-5 h-5 animate-spin text-violet-500 mx-auto" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLUNAS.length} className="px-3 py-10 text-center text-slate-500 text-sm">Nenhuma emissão no período.</td></tr>
              ) : (
                rows.slice(0, 100).map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    {COLUNAS.map((c) => <td key={c.key} className="px-3 py-2 text-slate-700 whitespace-nowrap">{c.value(r)}</td>)}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 100 && <div className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-200">Mostrando 100 de {rows.length} na prévia — o arquivo baixado traz todas.</div>}
      </div>
    </div>
  );
}
