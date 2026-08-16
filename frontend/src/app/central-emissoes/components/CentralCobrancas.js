'use client';
import { useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { combina } from '@/lib/busca';
import { mesAnoVigente } from '@/lib/mesVigente';
import {
  CalendarClock, Send, Loader2, Search, X, CheckCircle2, AlertTriangle, PauseCircle,
} from 'lucide-react';

/**
 * Central de cobrança das contas de concessionária.
 *
 * O emissor não deveria precisar abrir cada emissão para descobrir o que falta.
 * Aqui ele vê o mês inteiro de uma vez: cada conta esperada, quando o medidor é
 * lido, se já chegou, e cobra sem sair da tela.
 *
 * A DATA É O QUE MUDA A CONVERSA
 *
 * Toda fatura traz a data da próxima leitura — o dia em que a concessionária lê
 * o medidor para formar a conta seguinte. Com ela, três situações que pareciam
 * a mesma coisa se separam:
 *
 *   leitura ainda não chegou  → a conta nem foi emitida. Não há o que cobrar.
 *   leitura passou, sem conta → é atraso de verdade. Cobre.
 *   já anexada               → resolvido.
 *
 * Cobrar antes da leitura é cobrar do gerente uma conta que a concessionária
 * ainda não emitiu — é assim que uma cobrança automática perde a credibilidade
 * em duas semanas.
 *
 * O DADO ENTRA PELOS DOIS CAMINHOS
 *
 * A data é extraída da fatura ao anexar. Quando a extração não consegue ler —
 * conta escaneada torta, PDF ruim — a tela de revisão pede o campo à mão. Então
 * "ainda não temos a informação" nunca é um beco: é uma fatura anexada antes de
 * o sistema ler esse campo (16/08/2026), e se resolve na próxima que entrar.
 *
 * Dizer isso é melhor do que esconder. Uma tela que mostra 204 linhas sem data
 * como se fossem atrasos faz a pessoa cobrar errado 204 vezes.
 */

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
               'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const fmt = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : null);

const FILTROS = [
  { id: 'cobrar',   rotulo: 'A cobrar' },
  { id: 'esperando', rotulo: 'Esperando leitura' },
  { id: 'sem_data', rotulo: 'Sem informação' },
  { id: 'anexadas', rotulo: 'Já chegaram' },
  { id: 'todas',    rotulo: 'Todas' },
];

export default function CentralCobrancas() {
  const { addToast } = useToast();
  const vig = useMemo(() => mesAnoVigente(), []);
  const [mes, setMes] = useState(vig.mes);
  const [ano, setAno] = useState(vig.ano);
  const [filtro, setFiltro] = useState('cobrar');
  const [busca, setBusca] = useState('');
  const [cobrando, setCobrando] = useState(null);

  const { data, isLoading, mutate } = useSWR(
    `/api/contas-esperadas/mes?mes=${mes}&ano=${ano}`, apiFetcher);

  const todas = useMemo(() => data?.contas || [], [data]);

  const chave = useCallback((c) => `${c.condominio_id}|${c.concessionaria}`, []);

  async function cobrar(c) {
    setCobrando(chave(c));
    try {
      const r = await apiPost('/api/cobrancas-contas/cobrar-direto', {
        condominio_id: c.condominio_id,
        concessionaria: c.concessionaria,
        mes_referencia: mes,
        ano_referencia: ano,
      });
      const para = (r?.enviados_para || []).join(', ');
      addToast(para ? `Cobrança enviada para ${para}.` : 'Cobrança enviada.', 'success');
      mutate();
    } catch (e) {
      addToast('Não consegui cobrar: ' + (e.message || e), 'error');
    } finally {
      setCobrando(null);
    }
  }

  const lista = useMemo(() => todas.filter(c => {
    if (busca.trim() && !combina(busca, c.condominio, c.concessionaria)) return false;
    switch (filtro) {
      case 'cobrar':    return !c.ja_anexada && c.leitura_passou;
      case 'esperando': return !c.ja_anexada && c.leitura_prevista && !c.leitura_passou;
      case 'sem_data':  return !c.ja_anexada && !c.leitura_prevista;
      case 'anexadas':  return c.ja_anexada;
      default:          return true;
    }
  }), [todas, filtro, busca]);

  const contagem = useMemo(() => ({
    cobrar:    todas.filter(c => !c.ja_anexada && c.leitura_passou).length,
    esperando: todas.filter(c => !c.ja_anexada && c.leitura_prevista && !c.leitura_passou).length,
    sem_data:  todas.filter(c => !c.ja_anexada && !c.leitura_prevista).length,
    anexadas:  todas.filter(c => c.ja_anexada).length,
    todas:     todas.length,
  }), [todas]);

  function navMes(dir) {
    let m = mes + dir, a = ano;
    if (m > 12) { m = 1; a++; }
    if (m < 1) { m = 12; a--; }
    setMes(m); setAno(a);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 flex-wrap">
        <CalendarClock className="w-5 h-5 text-violet-500" aria-hidden="true" />
        <h3 className="text-base font-semibold text-slate-900">Cobrança de contas</h3>
        <div className="inline-flex items-center gap-1 ml-2">
          <button type="button" onClick={() => navMes(-1)} aria-label="Mês anterior"
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">‹</button>
          <span className="text-sm font-medium text-slate-700 min-w-[120px] text-center">
            {MESES[mes]}/{ano}
          </span>
          <button type="button" onClick={() => navMes(1)} aria-label="Próximo mês"
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">›</button>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 -mt-2">
        A data vem impressa na fatura do mês anterior: é o dia em que a concessionária lê o medidor
        para formar esta conta. Antes dela, a conta ainda não existe.
      </p>

      <div className="flex gap-2.5 items-center flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Condomínio ou concessionária" aria-label="Buscar"
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500" />
          {busca && (
            <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map(f => (
          <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filtro === f.id
                ? 'border-violet-600 bg-violet-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>
            {f.rotulo}
            <span className={`ml-1.5 ${filtro === f.id ? 'text-violet-100' : 'text-slate-400'}`}>
              {contagem[f.id] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : lista.length === 0 ? (
        <div className="py-16 text-center">
          <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-slate-500 font-medium">
            {filtro === 'cobrar' ? 'Nada atrasado neste mês.' : 'Nada aqui.'}
          </p>
          {filtro === 'cobrar' && contagem.sem_data > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              {contagem.sem_data} conta{contagem.sem_data > 1 ? 's' : ''} ainda sem a informação da
              leitura — veja o filtro ao lado.
            </p>
          )}
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200">
          {lista.map(c => {
            const k = chave(c);
            const suspensa = c.cobranca?.status === 'suspensa';
            return (
              <div key={k} className={`px-4 py-3 flex items-center gap-3 flex-wrap ${c.ja_anexada ? 'bg-slate-50' : 'bg-white'}`}>
                <span className="w-20 shrink-0 text-xs font-semibold text-slate-700">{c.concessionaria}</span>

                <p className={`flex-1 min-w-0 truncate text-sm ${c.ja_anexada ? 'text-slate-500' : 'font-medium text-slate-900'}`}>
                  {c.condominio}
                </p>

                {c.ja_anexada ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" /> chegou
                  </span>
                ) : c.leitura_prevista ? (
                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums shrink-0 ${
                    c.leitura_passou
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-violet-200 bg-violet-50 text-violet-700'}`}>
                    <CalendarClock className="w-3 h-3" aria-hidden="true" />
                    leitura {fmt(c.leitura_prevista)}
                    {c.leitura_passou && ' · não veio'}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400 shrink-0"
                        title="A fatura anterior não trouxe a data, e ninguém preencheu à mão">
                    ainda não temos a informação
                  </span>
                )}

                {c.cobranca?.cobrancas > 0 && (
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {c.cobranca.cobrancas}ª cobrança
                  </span>
                )}

                {suspensa ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 shrink-0"
                        title={`${c.cobranca.suspensa_motivo}${c.cobranca.suspensa_por_nome ? ` — ${c.cobranca.suspensa_por_nome}` : ''}`}>
                    <PauseCircle className="w-3.5 h-3.5" /> suspensa
                  </span>
                ) : !c.ja_anexada && (
                  <button type="button" onClick={() => cobrar(c)} disabled={cobrando === k}
                    title={c.leitura_passou
                      ? `Manda o e-mail agora para o gerente e o assistente de ${c.condominio}`
                      : 'A leitura ainda não aconteceu — a conta pode nem existir ainda'}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
                      c.leitura_passou
                        ? 'bg-violet-600 text-white hover:bg-violet-700'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>
                    {cobrando === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Cobrar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {contagem.sem_data > 0 && filtro === 'sem_data' && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Ainda não temos a informação da leitura destas contas: a fatura anterior foi anexada
            antes de o sistema passar a ler esse campo (16/08/2026), ou veio escaneada e a extração
            não achou. Dá para cobrar assim mesmo — só não dá para saber se a conta já deveria
            existir. Isso se resolve sozinho: ao anexar a próxima fatura, o campo é lido, e quando
            a leitura falha a tela pede para preencher à mão.
          </p>
        </div>
      )}
    </div>
  );
}
