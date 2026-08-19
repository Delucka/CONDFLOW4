'use client';
import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { registrarNaTrilha, avisoTrilhaFalhou } from '@/lib/aprovacaoFluxo';
import StatusBadge from './StatusBadge';
import { Route, Loader2, X, ArrowRight } from 'lucide-react';

/**
 * Mandar uma emissão para qualquer etapa do fluxo.
 *
 * O fluxo normal só anda para frente (aprovação) ou volta inteiro (correção).
 * Isso cobre o dia a dia e deixa de fora o que a vida real produz: a emissão
 * que foi parar na etapa errada, a que precisa voltar para o gerente conferir
 * uma coisa específica, a que já pode pular para aprovada porque a conversa
 * aconteceu por fora.
 *
 * Sem esta saída, cada um desses casos virava um UPDATE no banco — feito por
 * alguém que sabe SQL, sem registro de quem fez nem por quê.
 *
 * Por isso o motivo é obrigatório e vai para a trilha: um atalho sem rastro
 * seria pior do que não ter atalho.
 *
 * QUEM PODE: só o master. O emissor empurrar a própria emissão para "aprovado"
 * seria pular a conferência que o fluxo existe para garantir.
 */

const ETAPAS = [
  { id: 'rascunho',                   rotulo: 'Em edição',            dica: 'Volta para quem monta a emissão' },
  { id: 'pendente_gerente',           rotulo: 'Com o gerente',        dica: 'O gerente do condomínio confere' },
  { id: 'pendente_sup_gerentes',      rotulo: 'Sup. de gerentes',     dica: 'Revisão do supervisor de gerentes' },
  { id: 'pendente_sup_contabilidade', rotulo: 'Sup. contabilidade',   dica: 'Última conferência antes de aprovar' },
  { id: 'aprovado',                   rotulo: 'Aprovada',             dica: 'Libera para registro — pula as conferências que faltam' },
];

// Estados finais: têm caminhos próprios (retificação, cancelamento) e não devem
// ser desfeitos por aqui.
const FINAIS = ['registrado', 'expedida', 'cancelada'];

export default function ModalDirecionarEmissao({ pacote, onFechar, onPronto }) {
  const supabase = createClient();
  const { user } = useAuth();
  const { addToast } = useToast();
  const atual = (pacote.status || '').toLowerCase();
  const [destino, setDestino] = useState('');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const curto = motivo.trim().length < 10;
  const ehFinal = FINAIS.includes(atual);

  async function confirmar() {
    if (!destino || curto) return;
    setSalvando(true);
    try {
      const { error } = await supabase
        .from('emissoes_pacotes')
        .update({
          status: destino,
          // O direcionamento também vira o marco: se pedirem correção depois,
          // a emissão volta para onde ela está agora, não para onde estava
          // antes de alguém mover.
          status_pre_correcao: destino,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', pacote.id);
      if (error) throw error;

      // Rastro: quem mandou, para onde e por quê. `direcionamento` não conta
      // como assinatura — `aprovacoesValidas` só soma 'aprovacao'.
      const { error: errTrilha } = await registrarNaTrilha(supabase, {
        pacoteId: pacote.id,
        acao: 'direcionamento',
        user: { ...user, full_name: `${user?.full_name || user?.email} → ${rotulo(destino)}: ${motivo.trim()}` },
      });
      if (errTrilha) addToast(avisoTrilhaFalhou('direcionamento', errTrilha), 'warning');

      addToast(`Emissão enviada para ${rotulo(destino)}.`, 'success');
      onPronto?.();
      onFechar();
    } catch (e) {
      addToast('Não consegui direcionar: ' + (e.message || e), 'error');
    } finally {
      setSalvando(false);
    }
  }

  function rotulo(id) {
    return ETAPAS.find(e => e.id === id)?.rotulo || id;
  }

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onFechar} />
      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center shrink-0">
              <Route className="w-5 h-5 text-violet-600" aria-hidden="true" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Direcionar emissão</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                {pacote.condominios?.name || 'Condomínio'} ·{' '}
                {String(pacote.mes_referencia).padStart(2, '0')}/{pacote.ano_referencia}
              </p>
            </div>
          </div>
          <button onClick={onFechar} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {ehFinal ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
            <p className="text-xs text-amber-900">
              Esta emissão está em <strong>{atual}</strong>, que é um estado final. Para mexer nela use
              a retificação (se já foi registrada) ou o cancelamento — os dois deixam rastro do que
              aconteceu, o que voltar o status na marra não faria.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>Agora:</span>
              <StatusBadge status={pacote.status} />
            </div>

            <div className="space-y-1.5">
              {ETAPAS.filter(e => e.id !== atual).map(e => (
                <label key={e.id}
                  className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                    destino === e.id ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="destino" value={e.id} checked={destino === e.id}
                    onChange={() => setDestino(e.id)}
                    className="w-4 h-4 accent-violet-600 mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                      {e.rotulo}
                    </span>
                    <span className="block text-[11px] text-slate-500">{e.dica}</span>
                  </span>
                </label>
              ))}
            </div>

            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">
                Por quê <span className="text-rose-500">*</span>
              </span>
              <textarea
                rows={2}
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Ex.: voltou para a supervisora sem passar pelo gerente; precisa da conferência dele"
                className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500 resize-y"
              />
              <span className="text-[10px] text-slate-400">
                Fica na trilha da emissão, com seu nome — direcionar sem rastro seria pior do que não poder direcionar.
              </span>
            </label>

            <div className="flex justify-end gap-2">
              <button onClick={onFechar} disabled={salvando}
                className="rounded-xl px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
                Voltar
              </button>
              <button onClick={confirmar} disabled={salvando || !destino || curto}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Route className="w-3.5 h-3.5" />}
                Direcionar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
