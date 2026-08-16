'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import {
  CalendarClock, PauseCircle, PlayCircle, Loader2, CheckCircle2, X, AlertTriangle,
} from 'lucide-react';

/**
 * As contas de concessionária que ainda não chegaram.
 *
 * A fila nasce da própria fatura: toda conta traz a data da PRÓXIMA leitura, e
 * é ela que marca quando a conta do mês seguinte se forma. Chegando essa data
 * sem a conta anexada, o sistema cobra o gerente e o assistente por e-mail, a
 * cada dois dias úteis.
 *
 * Duas saídas, e nenhuma delas é marcar "recebido" à mão:
 *
 *   • anexar a fatura na emissão — a linha fecha sozinha (gatilho da 0099)
 *   • escrever a justificativa — o e-mail para, e o motivo fica à vista
 *
 * A justificativa não passa por aprovação de propósito: travar isso criaria
 * fila para quem já está cheio. O controle é por transparência — master e
 * emissão leem o motivo e, se não aceitarem, mandam voltar a cobrar.
 */

const MESES = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
               'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const fmtData = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—');

export default function FilaCobrancaContas() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const { data, isLoading, mutate } = useSWR('/api/cobrancas-contas', apiFetcher);

  const [acao, setAcao] = useState(null);      // { cobranca, tipo: 'suspender'|'reativar' }
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const podeReativar = profile?.role === 'master' || profile?.role === 'departamento';

  const todas = data?.cobrancas || [];
  const abertas = todas.filter(c => c.status !== 'recebida');

  async function confirmar() {
    if (motivo.trim().length < 10) {
      addToast('Escreva o motivo — pelo menos uma frase.', 'error');
      return;
    }
    setSalvando(true);
    try {
      await apiPost(`/api/cobrancas-contas/${acao.cobranca.id}/${acao.tipo}`, { motivo: motivo.trim() });
      addToast(acao.tipo === 'suspender' ? 'Cobrança suspensa.' : 'A cobrança volta no próximo disparo.', 'success');
      setAcao(null);
      setMotivo('');
      mutate();
    } catch (e) {
      addToast('Não consegui salvar: ' + (e.message || e), 'error');
    } finally {
      setSalvando(false);
    }
  }

  if (isLoading) {
    return (
      <div className="glass-panel rounded-[2rem] border border-slate-200 px-5 py-4 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando as contas que faltam…
      </div>
    );
  }

  if (abertas.length === 0) {
    return (
      <div className="glass-panel rounded-[2rem] border border-slate-200 px-5 py-4 flex items-center gap-2 text-sm text-slate-500">
        <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        Nenhuma conta em cobrança. Toda fatura esperada já chegou ou tem justificativa.
      </div>
    );
  }

  const atrasadas = abertas.filter(c => c.atrasada && c.status === 'aguardando').length;

  return (
    <div className="glass-panel rounded-[2rem] border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2.5 flex-wrap">
        <CalendarClock className="w-5 h-5 text-violet-500" aria-hidden="true" />
        <h3 className="text-base font-semibold text-slate-900">Contas que faltam</h3>
        {atrasadas > 0 && (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
            {atrasadas} atrasada{atrasadas > 1 ? 's' : ''}
          </span>
        )}
        <p className="text-[11px] text-slate-500 w-full">
          A data vem da própria fatura do mês anterior. Anexar a conta na emissão fecha a linha sozinha.
        </p>
      </div>

      <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto">
        {abertas.map(c => {
          const suspensa = c.status === 'suspensa';
          return (
            <div key={c.id} className={`px-5 py-3 flex items-start gap-3 flex-wrap ${suspensa ? 'bg-slate-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900">
                  <span className="font-semibold">{c.condominios?.name || 'Condomínio'}</span>
                  <span className="mx-1.5 text-slate-400">·</span>
                  <span className="font-medium">{c.concessionaria}</span>
                  <span className="mx-1.5 text-slate-400">·</span>
                  <span className="text-slate-600">{MESES[c.mes_referencia]}/{String(c.ano_referencia).slice(-2)}</span>
                </p>

                <p className="text-[11px] text-slate-500 mt-0.5">
                  leitura {fmtData(c.previsto_em)}
                  {c.cobrancas > 0 && ` · ${c.cobrancas} cobrança${c.cobrancas > 1 ? 's' : ''} enviada${c.cobrancas > 1 ? 's' : ''}`}
                </p>

                {suspensa && (
                  <p className="mt-1.5 text-[11px] text-slate-600 border-l-2 border-slate-300 pl-2">
                    <span className="font-semibold">Suspensa</span>
                    {c.suspensa_por_nome ? ` por ${c.suspensa_por_nome}` : ''}: {c.suspensa_motivo}
                  </p>
                )}

                {/* A recusa fica visível para os dois lados: quem foi cobrado
                    entende por que voltou, e quem cobrou não precisa repetir. */}
                {c.reativada_motivo && c.status === 'aguardando' && (
                  <p className="mt-1.5 text-[11px] text-amber-800 border-l-2 border-amber-400 pl-2">
                    <span className="font-semibold">Justificativa não aceita</span>
                    {c.reativada_por_nome ? ` por ${c.reativada_por_nome}` : ''}: {c.reativada_motivo}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {c.atrasada && c.status === 'aguardando' && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> atrasada
                  </span>
                )}

                {c.status === 'aguardando' && (
                  <button type="button" onClick={() => { setAcao({ cobranca: c, tipo: 'suspender' }); setMotivo(''); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors">
                    <PauseCircle className="w-3.5 h-3.5" /> Justificar
                  </button>
                )}

                {suspensa && podeReativar && (
                  <button type="button" onClick={() => { setAcao({ cobranca: c, tipo: 'reativar' }); setMotivo(''); }}
                    title="A justificativa não convence — a cobrança volta"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors">
                    <PlayCircle className="w-3.5 h-3.5" /> Voltar a cobrar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {acao && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setAcao(null)} />
          <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">
                  {acao.tipo === 'suspender' ? 'Suspender a cobrança' : 'Voltar a cobrar'}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  {acao.cobranca.condominios?.name} · {acao.cobranca.concessionaria} ·{' '}
                  {MESES[acao.cobranca.mes_referencia]}/{String(acao.cobranca.ano_referencia).slice(-2)}
                </p>
              </div>
              <button onClick={() => setAcao(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            {acao.tipo === 'reativar' && acao.cobranca.suspensa_motivo && (
              <p className="text-[11px] text-slate-600 border-l-2 border-slate-300 pl-2">
                Justificativa dada: {acao.cobranca.suspensa_motivo}
              </p>
            )}

            <textarea
              rows={3}
              autoFocus
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder={acao.tipo === 'suspender'
                ? 'Por que a conta ainda não chegou. Ex.: a concessionária remarcou a leitura para o dia 20'
                : 'Por que a justificativa não foi aceita. Vai no próximo e-mail.'}
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500 resize-y"
            />
            <p className="text-[11px] text-slate-400">
              Fica registrado com seu nome e a data, visível para a emissão.
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={() => setAcao(null)} disabled={salvando}
                className="rounded-xl px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
                Cancelar
              </button>
              <button onClick={confirmar} disabled={salvando}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {acao.tipo === 'suspender' ? 'Suspender' : 'Voltar a cobrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
