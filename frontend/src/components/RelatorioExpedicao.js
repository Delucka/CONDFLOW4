'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { gerarCsv, gerarPdfTabela } from '@/lib/relatorios';
import { condosDaCarteira, temRecorteDeCarteira } from '@/lib/carteira';
import { FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';

/**
 * Relatório da expedição — quando o trabalho chegou até eles, e quando saiu impresso.
 *
 * Os dois marcos já existiam no banco e ninguém os cruzava:
 *
 *   entrou   `emissoes_arquivos.criado_em` do primeiro boleto ou filipeta. O modal
 *            "Expedir" só existe depois do registro, então o instante em que o
 *            arquivo nasce é o instante em que o trabalho aparece para a expedição.
 *   impresso `impresso_em` (0094), a baixa que a fila carimba.
 *
 * Não usei `lacrada_em` para o primeiro marco, embora fosse o candidato óbvio: o
 * gatilho da 0016 o reescreve quando a emissão vira 'registrado', e o "Expedir"
 * grava por cima dele de novo. Mediria um intervalo que muda de significado.
 *
 * O componente é montado em DOIS lugares — a Central de Relatórios (gestão) e a
 * tela /expedicao (quem imprime). Por isso mora em `components/` e não em
 * `app/aprovacoes/`, onde ficam os relatórios de uma rota só.
 */

const MESES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const fmtDataHora = (ts) => {
  try {
    return ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  } catch { return '—'; }
};

const DIA = 86400000;
const diasEntre = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / DIA));

const COLUNAS = [
  { key: 'condominio', label: 'Condomínio', width: 3.2, value: (r) => r.condominio },
  { key: 'competencia', label: 'Competência', width: 1.1, value: (r) => `${String(r.mes_referencia).padStart(2, '0')}/${r.ano_referencia}` },
  { key: 'prazo', label: 'Prazo de entrega', width: 1.2, value: (r) => (r.prazo ? `dia ${r.prazo}` : '—') },
  { key: 'entrou', label: 'Entrou na expedição', width: 1.7, value: (r) => fmtDataHora(r.entrou) },
  { key: 'impresso', label: 'Impresso em', width: 1.7, value: (r) => fmtDataHora(r.impresso) },
  { key: 'quem', label: 'Quem imprimiu', width: 1.8, value: (r) => r.quem || '—' },
  { key: 'dias', label: 'Dias', width: 1.4, value: (r) => r.diasTexto },
  { key: 'documentos', label: 'Documentos', width: 1.4, value: (r) => r.documentos },
  { key: 'situacao', label: 'Situação', width: 1.2, value: (r) => r.situacao },
];

export default function RelatorioExpedicao() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const role = profile?.role;

  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [mes, setMes] = useState(0);            // 0 = ano inteiro
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [gerando, setGerando] = useState(null); // 'csv' | 'pdf'

  const buscar = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      // O recorte de carteira sai de lib/carteira.js, não reescrito aqui: é lá
      // que mora a diferença entre gerente e assistente, que já foi errada uma vez.
      const ids = await condosDaCarteira(supabase, profile);
      if (ids !== null && ids.length === 0) { setRows([]); return; }

      let q = supabase
        .from('emissoes_pacotes')
        .select('id, condominio_id, mes_referencia, ano_referencia, status, condominios(name, prazo_expedicao_dia)')
        .in('status', ['registrado', 'expedida'])
        .eq('ano_referencia', ano)
        .limit(5000);
      if (mes) q = q.eq('mes_referencia', mes);
      if (ids !== null) q = q.in('condominio_id', ids);

      const { data: pacs, error } = await q;
      if (error) throw error;

      const pacoteIds = (pacs || []).map((p) => p.id);
      const porPacote = {};
      if (pacoteIds.length) {
        // Em blocos: `in` com milhares de ids estoura o tamanho da URL.
        for (let i = 0; i < pacoteIds.length; i += 200) {
          const { data: arqs, error: errA } = await supabase
            .from('emissoes_arquivos')
            .select('pacote_id, categoria, criado_em, impresso_em, impresso_por_nome')
            .in('pacote_id', pacoteIds.slice(i, i + 200))
            .in('categoria', ['boleto', 'filipeta']);
          if (errA) throw errA;
          (arqs || []).forEach((a) => { (porPacote[a.pacote_id] ||= []).push(a); });
        }
      }

      const agora = Date.now();
      const lista = (pacs || [])
        .map((p) => {
          const docs = porPacote[p.id] || [];
          if (!docs.length) return null;      // sem anexo não é trabalho de expedição

          const entrou = docs.reduce((min, d) => (!min || d.criado_em < min ? d.criado_em : min), null);
          const todosImpressos = docs.every((d) => d.impresso_em);
          const impresso = todosImpressos
            ? docs.reduce((max, d) => (!max || d.impresso_em > max ? d.impresso_em : max), null)
            : null;
          const quem = docs.find((d) => d.impresso_por_nome)?.impresso_por_nome || null;
          const boletos = docs.filter((d) => d.categoria !== 'filipeta').length;
          const filipetas = docs.filter((d) => d.categoria === 'filipeta').length;

          return {
            id: p.id,
            condominio: p.condominios?.name || '—',
            mes_referencia: p.mes_referencia,
            ano_referencia: p.ano_referencia,
            prazo: p.condominios?.prazo_expedicao_dia ?? null,
            entrou,
            impresso,
            quem: todosImpressos ? quem : null,
            documentos: `${boletos} bol${filipetas ? ` · ${filipetas} fil` : ''}`,
            situacao: todosImpressos ? 'Impresso' : 'A imprimir',
            // Fechado conta o intervalo; aberto conta desde que entrou — dizer
            // "0 dias" para o que ainda está na mesa esconderia justamente o atraso.
            diasTexto: impresso
              ? `${diasEntre(entrou, impresso)}`
              : `aberto há ${diasEntre(entrou, agora)}`,
            _ordem: entrou || '',
          };
        })
        .filter(Boolean)
        .sort((a, b) => String(b._ordem).localeCompare(String(a._ordem)));

      setRows(lista);
    } catch (e) {
      addToast(e.message || 'Erro ao buscar a expedição', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, profile, ano, mes, addToast]);

  useEffect(() => { buscar(); }, [buscar]);

  const periodoLabel = mes ? `${MESES[mes]}/${ano}` : `Ano ${ano}`;
  const baseNome = `expedicao_${mes ? String(mes).padStart(2, '0') + '-' : ''}${ano}`;
  const pendentes = rows.filter((r) => r.situacao === 'A imprimir').length;

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
        titulo: 'Relatório de Expedição',
        subtitulo: `${periodoLabel} · ${rows.length} remessa(s) · ${pendentes} a imprimir · gerado em ${new Date().toLocaleString('pt-BR')}`,
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
          <Printer className="w-5 h-5 text-violet-500" />
        </div>
        <div>
          <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Expedição por período</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Quando cada remessa chegou à expedição e quando foi impressa.
            {temRecorteDeCarteira(role) ? ' Sua carteira.' : ' Todos os condomínios.'}
          </p>
        </div>
      </div>

      <div className="glass-panel p-4 rounded-2xl border border-slate-200 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rel-exp-ano" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ano</label>
          <select id="rel-exp-ano" value={ano} onChange={(e) => setAno(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rel-exp-mes" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</label>
          <select id="rel-exp-mes" value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            <option value={0}>Ano inteiro</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{MESES[m]}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 mr-1">
            {loading ? '…' : `${rows.length} remessa(s)${pendentes ? ` · ${pendentes} a imprimir` : ''}`}
          </span>
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
                <tr><td colSpan={COLUNAS.length} className="px-3 py-10 text-center text-slate-500 text-sm">Nenhuma remessa chegou à expedição neste período.</td></tr>
              ) : (
                rows.slice(0, 100).map((r) => (
                  <tr key={r.id} className={`hover:bg-slate-50 ${r.situacao === 'A imprimir' ? '' : 'text-slate-500'}`}>
                    {COLUNAS.map((c) => <td key={c.key} className="px-3 py-2 whitespace-nowrap">{c.value(r)}</td>)}
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
