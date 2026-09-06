'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { gerarCsv, gerarPdfTabela } from '@/lib/relatorios';
import PeriodoRelatorio, { periodoPadrao, rotuloPeriodo, sufixoPeriodo, aplicarPeriodo } from '@/components/PeriodoRelatorio';
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

const fmtDataHora = (ts) => {
  try {
    return ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  } catch { return '—'; }
};

// Só o dia, para a quebra por data de impressão.
const fmtDia = (iso) => {
  try { return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR'); } catch { return iso; }
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

  const [periodo, setPeriodo] = useState(periodoPadrao);
  const [situacaoFiltro, setSituacaoFiltro] = useState('todas'); // 'todas' | 'a_imprimir' | 'impressos'
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

      // A CONTA COMEÇA NO BOLETO, não no pacote.
      //
      // A referência é a competência DO BOLETO: os de setembro contam em
      // setembro. E ela não é a mesma coisa que a data em que o boleto chegou
      // à expedição — o único boleto em base hoje é competência 09/2026 e foi
      // anexado e impresso em 30/08. Recortar pela chegada o jogaria em agosto,
      // que é o mês errado para quem procura "os boletos de setembro".
      //
      // Todo anexo tem competência própria (596 de 596 preenchidos), então dá
      // para perguntar direto a ele, sem passar pelo pacote.
      //
      // Os dois modos partem daqui; muda só a coluna que o período filtra:
      //   competência → `mes_referencia` / `ano_referencia` do boleto
      //   data        → `criado_em`, quando o trabalho chegou à expedição
      const porPacote = {};
      let qa = supabase
        .from('emissoes_arquivos')
        .select('pacote_id, categoria, criado_em, impresso_em, impresso_por_nome, mes_referencia, ano_referencia')
        .in('categoria', ['boleto', 'filipeta'])
        .limit(20000);
      qa = aplicarPeriodo(qa, periodo, 'criado_em');
      const { data: arqs, error: errA } = await qa;
      if (errA) throw errA;
      (arqs || []).forEach((a) => { (porPacote[a.pacote_id] ||= []).push(a); });

      const alvo = Object.keys(porPacote);
      if (!alvo.length) { setRows([]); return; }

      const SEL_PAC = 'id, condominio_id, mes_referencia, ano_referencia, status, condominios(name, prazo_expedicao_dia)';
      let pacs = [];
      // Em blocos: `in` com milhares de ids estoura o tamanho da URL.
      for (let i = 0; i < alvo.length; i += 200) {
        let qp = supabase.from('emissoes_pacotes').select(SEL_PAC)
          .in('id', alvo.slice(i, i + 200))
          .in('status', ['registrado', 'expedida']);
        if (ids !== null) qp = qp.in('condominio_id', ids);
        const { data: parte, error: errP } = await qp;
        if (errP) throw errP;
        pacs = pacs.concat(parte || []);
      }

      const agora = Date.now();
      const lista = pacs
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

          // A competência é a DO BOLETO. A do pacote costuma ser a mesma, mas
          // quem manda aqui é o documento que vai ser impresso — é dele que a
          // pessoa fala quando pede "os boletos de setembro".
          const comp = docs.find((d) => d.mes_referencia) || {};
          const docsImpressos = docs.filter((d) => d.impresso_em).length;

          return {
            id: p.id,
            condominio: p.condominios?.name || '—',
            mes_referencia: comp.mes_referencia ?? p.mes_referencia,
            ano_referencia: comp.ano_referencia ?? p.ano_referencia,
            prazo: p.condominios?.prazo_expedicao_dia ?? null,
            entrou,
            impresso,
            quem: todosImpressos ? quem : null,
            documentos: `${boletos} bol${filipetas ? ` · ${filipetas} fil` : ''}`,
            totalDocs: docs.length,
            docsImpressos,
            // Só a data, sem hora: é o que responde "que dia foi impresso" e é
            // por ela que a quebra por dia agrupa.
            diaImpressao: impresso ? String(impresso).slice(0, 10) : null,
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
  }, [supabase, profile, periodo, addToast]);

  useEffect(() => { buscar(); }, [buscar]);

  const periodoLabel = rotuloPeriodo(periodo);
  const baseNome = `expedicao_${sufixoPeriodo(periodo)}`;

  /**
   * Quanto já saiu e quanto falta — a pergunta que a expedição faz primeiro.
   *
   * Conta nos dois níveis, porque eles não andam juntos: uma remessa só é
   * "impressa" quando TODOS os seus documentos têm baixa, então dá para ter
   * poucas remessas fechadas e muitos documentos já impressos. Mostrar só o
   * primeiro número faria o trabalho parecer mais atrasado do que está.
   */
  const resumo = useMemo(() => {
    const impressas = rows.filter((r) => r.situacao === 'Impresso');
    const abertas = rows.filter((r) => r.situacao === 'A imprimir');
    const docs = rows.reduce((s, r) => s + (r.totalDocs || 0), 0);
    const docsOk = rows.reduce((s, r) => s + (r.docsImpressos || 0), 0);

    // Quantas remessas saíram em cada dia, do mais recente para o mais antigo.
    const porDia = new Map();
    impressas.forEach((r) => {
      if (!r.diaImpressao) return;
      const atual = porDia.get(r.diaImpressao) || { dia: r.diaImpressao, remessas: 0, documentos: 0 };
      atual.remessas += 1;
      atual.documentos += r.totalDocs || 0;
      porDia.set(r.diaImpressao, atual);
    });

    return {
      impressas: impressas.length,
      abertas: abertas.length,
      docs,
      docsOk,
      docsFalta: docs - docsOk,
      porDia: [...porDia.values()].sort((a, b) => b.dia.localeCompare(a.dia)),
    };
  }, [rows]);

  const pendentes = resumo.abertas;

  // O que a tabela mostra depois do filtro de situação.
  const visiveis = useMemo(() => (
    situacaoFiltro === 'impressos' ? rows.filter((r) => r.situacao === 'Impresso')
      : situacaoFiltro === 'a_imprimir' ? rows.filter((r) => r.situacao === 'A imprimir')
        : rows
  ), [rows, situacaoFiltro]);

  // Exporta o que está NA TELA. Se a pessoa filtrou por "a imprimir" e o Excel
  // viesse com tudo, o arquivo contaria outra história que a tela.
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
        titulo: 'Relatório de Expedição',
        subtitulo: `${periodoLabel} · ${visiveis.length} remessa(s) · ${resumo.impressas} impressa(s) · `
          + `${resumo.abertas} a imprimir · ${resumo.docsOk} de ${resumo.docs} documento(s) impressos · `
          + `gerado em ${new Date().toLocaleString('pt-BR')}`,
        columns: COLUNAS, rows: visiveis, filename: baseNome,
      });
      addToast('PDF gerado.', 'success');
    } catch (e) { addToast(e.message || 'Falha ao gerar PDF', 'error'); }
    finally { setGerando(null); }
  };

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
        <PeriodoRelatorio id="rel-exp" value={periodo} onChange={setPeriodo}
          rotuloData="em que o boleto chegou à expedição" />
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

      {/* Quanto saiu, quanto falta — antes da tabela, porque é a primeira
          pergunta de quem abre esta tela. */}
      {!loading && rows.length > 0 && (
        <div className="grid gap-px bg-slate-200 border border-slate-200 rounded-2xl overflow-hidden sm:grid-cols-4">
          {[
            { rotulo: 'Impressas', valor: resumo.impressas, sufixo: 'remessas', destaque: 'text-emerald-600' },
            { rotulo: 'A imprimir', valor: resumo.abertas, sufixo: 'remessas', destaque: resumo.abertas ? 'text-amber-600' : 'text-slate-400' },
            { rotulo: 'Documentos impressos', valor: resumo.docsOk, sufixo: `de ${resumo.docs}`, destaque: 'text-emerald-600' },
            { rotulo: 'Documentos a imprimir', valor: resumo.docsFalta, sufixo: 'faltam', destaque: resumo.docsFalta ? 'text-amber-600' : 'text-slate-400' },
          ].map(({ rotulo, valor, sufixo, destaque }) => (
            <div key={rotulo} className="bg-white px-4 py-3">
              <p className={`text-2xl font-black tabular-nums leading-none ${destaque}`}>{valor}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1.5">{rotulo}</p>
              <p className="text-[10px] text-slate-400">{sufixo}</p>
            </div>
          ))}
        </div>
      )}

      {/* Que dia saiu cada lote. Uma remessa fica "impressa" só quando o último
          documento dela recebe baixa, então este é o dia em que ela fechou. */}
      {!loading && resumo.porDia.length > 0 && (
        <div className="glass-panel p-4 rounded-2xl border border-slate-200">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">Dias de impressão</p>
          <div className="flex flex-wrap gap-2">
            {resumo.porDia.map(({ dia, remessas, documentos }) => (
              <span key={dia}
                className="inline-flex items-baseline gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5">
                <b className="text-xs font-black text-slate-900 tabular-nums">{fmtDia(dia)}</b>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {remessas} remessa{remessas === 1 ? '' : 's'} · {documentos} doc.
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filtro de situação: a fila de trabalho e a conferência do que já saiu
          são duas leituras da mesma lista. */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'todas', rotulo: `Todas (${rows.length})` },
            { id: 'a_imprimir', rotulo: `A imprimir (${resumo.abertas})` },
            { id: 'impressos', rotulo: `Impressas (${resumo.impressas})` },
          ].map(({ id, rotulo }) => (
            <button key={id} type="button" onClick={() => setSituacaoFiltro(id)}
              aria-pressed={situacaoFiltro === id}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                situacaoFiltro === id
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {rotulo}
            </button>
          ))}
        </div>
      )}

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
                  {rows.length === 0
                    ? 'Nenhuma remessa chegou à expedição neste período.'
                    : 'Nenhuma remessa nesta situação.'}
                </td></tr>
              ) : (
                visiveis.slice(0, 100).map((r) => (
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
