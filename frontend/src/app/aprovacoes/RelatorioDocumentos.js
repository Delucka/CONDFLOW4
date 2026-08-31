'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { gerarCsv, gerarPdfTabela } from '@/lib/relatorios';
import { condosDaCarteira, temRecorteDeCarteira } from '@/lib/carteira';
import { rotuloDocumento } from '@/lib/rotuloDocumento';
import { FileSpreadsheet, FileText, Loader2, ClipboardList } from 'lucide-react';

/**
 * O que foi anexado em cada emissão — e o que faltou.
 *
 * O que o emissor anexa É a emissão: planilha, correios, seguro, as contas de
 * concessionária, salão, rateio. Este relatório responde por escrito a pergunta
 * que hoje só se responde abrindo emissão por emissão.
 *
 * A coluna que importa é "Faltando", e ela só acusa o que é MESMO esperado:
 *
 *   sempre         1 Emissão a processar · 8 Relatório de rateio
 *   se tem_consumo 4 Água · 5 Gás · 6 Energia   (0091 marca quem depende de concessionária)
 *   nunca cobrado  2 Correios · 3 Seguro · 7 Salão e cobranças — opcionais por natureza
 *
 * Cobrar o que é opcional encheria a coluna de falso alarme, e uma coluna de
 * alarme que quase sempre acende é uma coluna que ninguém lê.
 */

const MESES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const prettyStatus = (s) => (s || '—').replace(/_/g, ' ').replace(/\bsup\b/gi, 'sup.');

// Rótulos curtos por passo, para caber na coluna "Faltando" do PDF.
const NOME_PASSO = { 1: 'Emissão', 4: 'Água', 5: 'Gás', 6: 'Energia', 8: 'Rateio' };
const SEMPRE = [1, 8];
const SO_COM_CONSUMO = [4, 5, 6];

const COLUNAS = [
  { key: 'condominio', label: 'Condomínio', width: 3.0, value: (r) => r.condominio },
  { key: 'competencia', label: 'Competência', width: 1.0, value: (r) => `${String(r.mes_referencia).padStart(2, '0')}/${r.ano_referencia}` },
  { key: 'status', label: 'Status', width: 1.5, value: (r) => prettyStatus(r.status) },
  { key: 'total', label: 'Documentos', width: 1.0, value: (r) => String(r.total) },
  { key: 'faltando', label: 'Faltando', width: 2.6, value: (r) => r.faltando || '—' },
  { key: 'naoIdent', label: 'Não identificados', width: 1.4, value: (r) => (r.naoIdent ? String(r.naoIdent) : '—') },
];

export default function RelatorioDocumentos() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const role = profile?.role;

  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [mes, setMes] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [gerando, setGerando] = useState(null);
  const [soFalta, setSoFalta] = useState(false);

  const buscar = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const ids = await condosDaCarteira(supabase, profile);
      if (ids !== null && ids.length === 0) { setRows([]); return; }

      let q = supabase
        .from('emissoes_pacotes')
        .select('id, condominio_id, mes_referencia, ano_referencia, status, condominios(name, tem_consumo)')
        .eq('ano_referencia', ano)
        .neq('status', 'rascunho')
        .limit(5000);
      if (mes) q = q.eq('mes_referencia', mes);
      if (ids !== null) q = q.in('condominio_id', ids);

      const { data: pacs, error } = await q;
      if (error) throw error;

      const pacoteIds = (pacs || []).map((p) => p.id);
      const porPacote = {};
      for (let i = 0; i < pacoteIds.length; i += 200) {
        const { data: arqs, error: errA } = await supabase
          .from('emissoes_arquivos')
          .select('pacote_id, categoria, subtipo, relatorio_tipo_servico, relatorio_empresa, arquivo_nome')
          .in('pacote_id', pacoteIds.slice(i, i + 200));
        if (errA) throw errA;
        (arqs || []).forEach((a) => { (porPacote[a.pacote_id] ||= []).push(a); });
      }

      const lista = (pacs || []).map((p) => {
        const arqs = porPacote[p.id] || [];
        // O boleto e a filipeta nascem DEPOIS, na expedição — não são documento
        // da emissão e não podem contar como "veio" nem como "faltou".
        const daEmissao = arqs.filter((a) => a.categoria !== 'boleto' && a.categoria !== 'filipeta');
        const passos = new Set(daEmissao.map((a) => rotuloDocumento(a).passo));

        const esperados = [...SEMPRE, ...(p.condominios?.tem_consumo ? SO_COM_CONSUMO : [])];
        const faltando = esperados
          .filter((n) => !passos.has(n))
          .sort((a, b) => a - b)
          .map((n) => `${n} ${NOME_PASSO[n]}`)
          .join(', ');

        return {
          id: p.id,
          condominio: p.condominios?.name || '—',
          mes_referencia: p.mes_referencia,
          ano_referencia: p.ano_referencia,
          status: p.status,
          total: daEmissao.length,
          faltando,
          naoIdent: daEmissao.filter((a) => rotuloDocumento(a).passo === 9).length,
        };
      }).sort((a, b) =>
        a.condominio.localeCompare(b.condominio) || a.mes_referencia - b.mes_referencia);

      setRows(lista);
    } catch (e) {
      addToast(e.message || 'Erro ao buscar os documentos', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, profile, ano, mes, addToast]);

  useEffect(() => { buscar(); }, [buscar]);

  const visiveis = soFalta ? rows.filter((r) => r.faltando) : rows;
  const comFalta = rows.filter((r) => r.faltando).length;
  const periodoLabel = mes ? `${MESES[mes]}/${ano}` : `Ano ${ano}`;
  const baseNome = `documentos_emissao_${mes ? String(mes).padStart(2, '0') + '-' : ''}${ano}`;

  const baixarCsv = () => {
    setGerando('csv');
    try { gerarCsv(baseNome, COLUNAS, visiveis); addToast('Excel (CSV) gerado.', 'success'); }
    catch (e) { addToast(e.message || 'Falha ao gerar CSV', 'error'); }
    finally { setGerando(null); }
  };

  const baixarPdf = async () => {
    setGerando('pdf');
    try {
      await gerarPdfTabela({
        titulo: 'Documentos da Emissão',
        subtitulo: `${periodoLabel} · ${visiveis.length} emissão(ões) · ${comFalta} com documento faltando · gerado em ${new Date().toLocaleString('pt-BR')}`,
        columns: COLUNAS, rows: visiveis, filename: baseNome,
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
          <ClipboardList className="w-5 h-5 text-violet-500" />
        </div>
        <div>
          <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Documentos da emissão</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            O que foi anexado em cada emissão e o que faltou. Água, gás e energia só são cobrados de
            quem depende de concessionária.{temRecorteDeCarteira(role) ? ' Sua carteira.' : ''}
          </p>
        </div>
      </div>

      <div className="glass-panel p-4 rounded-2xl border border-slate-200 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rel-doc-ano" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ano</label>
          <select id="rel-doc-ano" value={ano} onChange={(e) => setAno(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rel-doc-mes" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</label>
          <select id="rel-doc-mes" value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            <option value={0}>Ano inteiro</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{MESES[m]}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 cursor-pointer">
          <input type="checkbox" checked={soFalta} onChange={(e) => setSoFalta(e.target.checked)}
            className="w-4 h-4 accent-violet-600" />
          <span className="text-xs text-slate-600">Só as que têm documento faltando{comFalta ? ` (${comFalta})` : ''}</span>
        </label>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 mr-1">{loading ? '…' : `${visiveis.length} emissão(ões)`}</span>
          <button onClick={baixarCsv} disabled={loading || gerando || visiveis.length === 0}
            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
            {gerando === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Excel
          </button>
          <button onClick={baixarPdf} disabled={loading || gerando || visiveis.length === 0}
            className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
            {gerando === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF
          </button>
        </div>
      </div>

      <div className="glass-panel rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>{COLUNAS.map((c) => <th key={c.key} className="px-3 py-2 font-black text-slate-600 uppercase tracking-wider text-[10px] whitespace-nowrap">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={COLUNAS.length} className="px-3 py-10 text-center"><Loader2 className="w-5 h-5 animate-spin text-violet-500 mx-auto" /></td></tr>
              ) : visiveis.length === 0 ? (
                <tr><td colSpan={COLUNAS.length} className="px-3 py-10 text-center text-slate-500 text-sm">
                  {soFalta ? 'Nenhuma emissão do período está com documento faltando.' : 'Nenhuma emissão no período.'}
                </td></tr>
              ) : (
                visiveis.slice(0, 100).map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    {COLUNAS.map((c) => (
                      <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${
                        c.key === 'faltando' && r.faltando ? 'text-amber-700 font-semibold' : 'text-slate-700'}`}>
                        {c.value(r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {visiveis.length > 100 && <div className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-200">Mostrando 100 de {visiveis.length} na prévia — o arquivo baixado traz todas.</div>}
      </div>
    </div>
  );
}
