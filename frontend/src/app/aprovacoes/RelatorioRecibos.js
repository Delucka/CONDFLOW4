'use client';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { apiFetcher, apiFetch } from '@/lib/api';
import { getArquivoUrlSeguro } from '@/lib/arquivo';
import { gerarCsv } from '@/lib/relatorios';
import { linhasDoPdf, lerEmissao, lerRateio, cruzar } from '@/lib/relacaoRecibos';
import { montarRecibosPdf } from '@/lib/recibosPdf';
import SeletorCondominio from '@/components/SeletorCondominio';
import { FileSpreadsheet, FileText, Loader2, ReceiptText, AlertTriangle } from 'lucide-react';

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Uma linha por (unidade × arrecadação): é o formato que serve para o Excel,
// onde se filtra e se soma. O "Valor do recibo" repete na primeira linha de
// cada unidade e fica vazio nas seguintes, para a soma da coluna não dobrar.
const COLUNAS = [
  { key: 'bloco', label: 'Bloco', width: 0.7, value: (r) => r.bloco || '' },
  { key: 'unidade', label: 'Unidade', width: 1.1, value: (r) => r.unidade },
  { key: 'condomino', label: 'Condômino', width: 3, value: (r) => r.condomino || '' },
  { key: 'arrecadacao', label: 'Arrecadação', width: 2.6, value: (r) => r.arrecadacao },
  { key: 'valor', label: 'Valor', width: 1.1, value: (r) => brl(r.valor) },
  { key: 'recibo', label: 'Valor do recibo', width: 1.3, value: (r) => (r.recibo == null ? '' : brl(r.recibo)) },
];

/**
 * Relação de Recibos — o recibo de cada unidade, lido dos dois anexos da emissão.
 *
 * A leitura acontece NO NAVEGADOR (`lib/relacaoRecibos.js`): medido, 620 ms
 * contra 8 s do mesmo parser no servidor, onde a função do Vercel corta em 10 s.
 *
 * Não roda sozinho ao abrir, como os outros relatórios: baixar e ler dois PDFs
 * é trabalho, e ninguém quer isso acontecendo por acidente ao trocar de aba.
 */
export default function RelatorioRecibos() {
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const { data: condosData } = useSWR('/api/condominios?basico=1', apiFetcher);
  const condos = condosData?.condos || [];

  const anoAtual = new Date().getFullYear();
  const [condominioId, setCondominioId] = useState('');
  const [ano, setAno] = useState(anoAtual);
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [bloco, setBloco] = useState('');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [passo, setPasso] = useState('');
  const [gerando, setGerando] = useState(null);

  const anos = Array.from({ length: 6 }, (_, i) => anoAtual - i);
  const condoNome = condos.find((c) => c.id === condominioId)?.name || '';

  async function gerar() {
    if (!condominioId) return addToast('Escolha o condomínio.', 'error');
    setCarregando(true);
    setDados(null);
    setBloco('');
    try {
      setPasso('procurando a emissão…');
      const { data: pacotes, error } = await supabase
        .from('emissoes_pacotes')
        .select('id, mes_referencia, ano_referencia, status')
        .eq('condominio_id', condominioId).eq('ano_referencia', ano).eq('mes_referencia', mes)
        .neq('status', 'rascunho').limit(1);
      if (error) throw error;
      if (!pacotes?.length) {
        addToast(`Não há emissão de ${MESES[mes]}/${ano} para este condomínio.`, 'warning');
        return;
      }

      const { data: arquivos, error: errA } = await supabase
        .from('emissoes_arquivos').select('arquivo_nome, arquivo_url, categoria')
        .eq('pacote_id', pacotes[0].id);
      if (errA) throw errA;

      const doEmissor = (arquivos || []).find((a) => a.categoria === 'emissao');
      const doRateio = (arquivos || []).find((a) => /RelCalculoRateio/i.test(a.arquivo_nome || ''));
      if (!doEmissor || !doRateio) {
        addToast(
          `Esta emissão não tem ${!doEmissor ? 'o "Emissões a Processar"' : 'o "Relatório de Cálculo do Rateio"'} `
          + 'anexado — os dois são necessários para montar a relação.',
          'error',
        );
        return;
      }

      const baixar = async (a) => {
        const url = await getArquivoUrlSeguro(a.arquivo_url, { stream: true });
        if (!url) throw new Error(`sem acesso a ${a.arquivo_nome}`);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`falha ao baixar ${a.arquivo_nome} (HTTP ${resp.status})`);
        return resp.arrayBuffer();
      };

      setPasso('lendo a emissão…');
      const emissao = lerEmissao(await linhasDoPdf(await baixar(doEmissor)));
      setPasso('lendo o cálculo do rateio…');
      const secoes = lerRateio(await linhasDoPdf(await baixar(doRateio),
        (n, total) => setPasso(`lendo o cálculo do rateio… página ${n} de ${total}`)));

      // Os nomes vêm da API: `condominos` tem RLS sem policy pública (0071), e a
      // rota devolve só unidade → nome, sem CPF nem contato.
      setPasso('buscando os nomes…');
      let nomes = {};
      try {
        const r = await apiFetch(`/api/condominos/nomes?condominio_id=${condominioId}`);
        nomes = r?.nomes || {};
      } catch { /* sem cadastro: a coluna sai vazia, e o aviso diz isso */ }

      const relatorio = cruzar({
        emissao, secoes, nomes, condominio: condoNome, mes, ano,
      });
      if (!relatorio.recibos.length) {
        addToast('Não consegui montar nenhum recibo com estes dois documentos.', 'error');
        return;
      }
      setDados(relatorio);
      addToast(`${relatorio.recibos.length} recibos · ${relatorio.arrecadacoes.length} arrecadações.`, 'success');
    } catch (e) {
      addToast('Erro ao montar a relação: ' + (e.message || e), 'error');
    } finally {
      setCarregando(false);
      setPasso('');
    }
  }

  const recibosVisiveis = useMemo(
    () => (!dados ? [] : (bloco ? dados.recibos.filter((r) => r.bloco === bloco) : dados.recibos)),
    [dados, bloco],
  );

  // Achata para a tabela e para o Excel.
  const linhas = useMemo(() => recibosVisiveis.flatMap((r) => r.itens.map((i, n) => ({
    bloco: r.bloco, unidade: r.unidade, condomino: r.condomino,
    arrecadacao: i.historico, valor: i.valor,
    recibo: n === 0 ? r.total : null,
    _primeira: n === 0,
  }))), [recibosVisiveis]);

  const totalVisivel = recibosVisiveis.reduce((t, r) => t + r.total, 0);
  const baseNome = `relacao_recibos_${(condoNome || 'condominio').replace(/[^\w]+/g, '_')}`
    + `_${String(mes).padStart(2, '0')}-${ano}${bloco ? `_bloco_${bloco}` : ''}`;

  const baixarCsv = () => {
    setGerando('csv');
    try { gerarCsv(baseNome, COLUNAS, linhas); addToast('Excel (CSV) gerado.', 'success'); }
    catch (e) { addToast(e.message || 'Falha ao gerar CSV', 'error'); }
    finally { setGerando(null); }
  };

  const baixarPdf = async () => {
    setGerando('pdf');
    try {
      await montarRecibosPdf({ ...dados, recibos: recibosVisiveis, bloco, filename: baseNome });
      addToast('PDF gerado.', 'success');
    } catch (e) { addToast(e.message || 'Falha ao gerar PDF', 'error'); }
    finally { setGerando(null); }
  };

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 rounded-2xl border border-slate-200 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center shrink-0">
          <ReceiptText className="w-5 h-5 text-violet-500" />
        </div>
        <div>
          <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Relação de recibos</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            O recibo de cada unidade, com as arrecadações e os valores individuais. Montado do
            <b> Emissões a Processar</b> e do <b>Relatório de Cálculo do Rateio</b> anexados na emissão.
          </p>
        </div>
      </div>

      <div className="glass-panel p-4 rounded-2xl border border-slate-200 flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <SeletorCondominio condos={condos} value={condominioId} onChange={setCondominioId} />
        </div>
        <div>
          <label htmlFor="rec-ano" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ano</label>
          <select id="rec-ano" value={ano} onChange={(e) => setAno(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rec-mes" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</label>
          <select id="rec-mes" value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            {MESES.slice(1).map((nome, i) => <option key={nome} value={i + 1}>{nome}</option>)}
          </select>
        </div>
        {dados?.blocos?.length > 1 && (
          <div>
            <label htmlFor="rec-bloco" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Bloco</label>
            <select id="rec-bloco" value={bloco} onChange={(e) => setBloco(e.target.value)}
              className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
              <option value="">Todos</option>
              {dados.blocos.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        )}
        <button onClick={gerar} disabled={carregando || !condominioId}
          className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ReceiptText className="w-4 h-4" />}
          {carregando ? 'Montando…' : 'Montar relação'}
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 mr-1">
            {dados ? `${recibosVisiveis.length} recibo(s) · R$ ${brl(totalVisivel)}` : ''}
          </span>
          <button onClick={baixarCsv} disabled={!dados || !!gerando}
            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
            {gerando === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Excel
          </button>
          <button onClick={baixarPdf} disabled={!dados || !!gerando}
            className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
            {gerando === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF
          </button>
        </div>
      </div>

      {carregando && passo && (
        <p className="text-[11px] text-slate-500 px-1">{passo}</p>
      )}

      {/* As divergências primeiro: num documento de conferência, o que não bate
          é a informação mais importante da página. */}
      {dados?.divergencias?.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-black text-amber-900 uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> O rateio não bate com o que a emissão cobra
          </p>
          <ul className="mt-2 space-y-1">
            {dados.divergencias.map((d) => (
              <li key={d.rateio} className="text-[12px] text-amber-900">
                <b>{d.historico}</b> — rateado R$ {brl(d.rateado)}, cobrado na emissão R$ {brl(d.cobrado)}
                <span className="text-amber-700"> (diferença de R$ {brl(Math.abs(d.diferenca))})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dados?.avisos?.length > 0 && (
        <ul className="px-1 space-y-0.5">
          {dados.avisos.map((a) => <li key={a} className="text-[11px] text-slate-500">{a}</li>)}
        </ul>
      )}

      {dados && (
        <div className="glass-panel rounded-2xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>{COLUNAS.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-black text-slate-600 uppercase tracking-wider text-[10px] whitespace-nowrap">{c.label}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {linhas.slice(0, 300).map((l, i) => (
                  <tr key={`${l.unidade}-${l.arrecadacao}-${i}`}
                    className={l._primeira ? 'border-t border-slate-200' : ''}>
                    {COLUNAS.map((c) => (
                      <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap ${
                        l._primeira ? 'text-slate-800 font-semibold' : 'text-slate-500'}`}>
                        {c.value(l)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linhas.length > 300 && (
            <p className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-200">
              Mostrando as 300 primeiras linhas. O Excel e o PDF trazem todas as {linhas.length}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
