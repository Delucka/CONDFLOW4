'use client';
import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Ban, Loader2, X, AlertTriangle } from 'lucide-react';

/**
 * Cancelar uma emissão — sem apagar o que aconteceu.
 *
 * O botão antigo era "excluir": apagava os arquivos do bucket, a trilha de
 * aprovação e o pacote. Sumia como se nunca tivesse existido.
 *
 * Isso é ruim justamente quando mais importa. A emissão foi cancelada PORQUE
 * teve um erro, e o erro é o que se quer poder olhar depois: o que saiu errado,
 * quem decidiu refazer, e por quê.
 *
 * Aqui o cancelamento é um estado. O pacote fica no Registro, marcado, com os
 * arquivos e o motivo. E uma emissão nova nasce no lugar, ligada à antiga, para
 * o trabalho ser refeito direito.
 */
export default function ModalCancelarEmissao({ pacote, onFechar, onPronto }) {
  const supabase = createClient();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [motivo, setMotivo] = useState('');
  const [abrirNova, setAbrirNova] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const curto = motivo.trim().length < 15;

  async function confirmar() {
    if (curto) {
      addToast('Descreva o motivo — quem ler daqui a três meses precisa entender.', 'error');
      return;
    }
    setSalvando(true);
    try {
      let novoId = null;

      // A nova emissão nasce PRIMEIRO: se algo falhar aqui, a antiga continua
      // como está e ninguém fica sem emissão nenhuma no mês.
      if (abrirNova) {
        const { data: nova, error: errNova } = await supabase
          .from('emissoes_pacotes')
          .insert({
            condominio_id: pacote.condominio_id,
            mes_referencia: pacote.mes_referencia,
            ano_referencia: pacote.ano_referencia,
            status: 'rascunho',
            uploaded_by: user?.id || null,
            nivel_aprovacao: pacote.nivel_aprovacao || null,
            ...(pacote.grupo_id ? { grupo_id: pacote.grupo_id } : {}),
          })
          .select('id')
          .single();
        if (errNova) throw errNova;
        novoId = nova?.id || null;
      }

      const { error } = await supabase
        .from('emissoes_pacotes')
        .update({
          status: 'cancelada',
          cancelamento_motivo: motivo.trim(),
          cancelada_em: new Date().toISOString(),
          cancelada_por: user?.profile_id || user?.id || null,
          cancelada_por_nome: user?.full_name || user?.email || null,
          substituida_por: novoId,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', pacote.id);
      if (error) throw error;

      addToast(novoId
        ? 'Emissão cancelada. Uma nova foi aberta para refazer.'
        : 'Emissão cancelada.', 'success');
      onPronto?.(novoId);
      onFechar();
    } catch (e) {
      addToast('Não consegui cancelar: ' + (e.message || e), 'error');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onFechar} />
      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
              <Ban className="w-5 h-5 text-rose-600" aria-hidden="true" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Cancelar emissão</h4>
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

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] text-slate-600 leading-relaxed">
            A emissão <strong>não é apagada</strong>. Ela fica no Registro, marcada como cancelada,
            com os arquivos e o motivo — é assim que dá para entender o erro depois.
          </p>
        </div>

        <label className="block">
          <span className="text-[11px] font-medium text-slate-500">
            Por que está cancelando <span className="text-rose-500">*</span>
          </span>
          <textarea
            rows={3}
            autoFocus
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ex.: fatura da SABESP anexada era de outro condomínio; valores do rateio saíram errados"
            className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500 resize-y"
          />
          <span className={`text-[10px] ${curto ? 'text-rose-500' : 'text-slate-400'}`}>
            {curto ? 'Escreva ao menos uma frase completa.' : 'Fica gravado com seu nome e a data.'}
          </span>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={abrirNova} onChange={e => setAbrirNova(e.target.checked)}
            className="w-4 h-4 accent-violet-600 mt-0.5 shrink-0" />
          <span className="text-xs text-slate-700">
            Abrir uma nova emissão para refazer
            <span className="block text-[11px] text-slate-500">
              Mesmo condomínio, mês e vencimento. Desmarque só se o mês não deve ter emissão nenhuma.
            </span>
          </span>
        </label>

        {!abrirNova && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Sem emissão nova, este condomínio fica sem emissão no mês até alguém abrir uma.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onFechar} disabled={salvando}
            className="rounded-xl px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
            Voltar
          </button>
          <button onClick={confirmar} disabled={salvando || curto}
            className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            Cancelar emissão
          </button>
        </div>
      </div>
    </div>
  );
}
