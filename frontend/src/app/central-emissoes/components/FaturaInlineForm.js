'use client';
import { useState } from 'react';

/**
 * Preenchimento manual dos dados da fatura de concessionária — quando a
 * extração não achou nome, vencimento, valor ou a próxima leitura.
 *
 * A próxima leitura entra aqui porque é dado de agenda, não de conferência:
 * é por ela que se sabe quando cobrar o responsável pela conta do mês seguinte.
 * Fatura escaneada torta perde esse campo na extração, e sem um lugar para
 * digitar ele se perdia de vez.
 */

// Form inline para dados manuais da fatura de concessionaria
export default function FaturaInlineForm({ arq, condoNome, maskValor, parseValor, saving, onCancel, onSave }) {
  const [nome, setNome]   = useState(arq.nome_condominio_fatura || condoNome || '');
  const [venc, setVenc]   = useState(arq.vencimento_fatura || '');
  const [proxLeitura, setProxLeitura] = useState(arq.proxima_leitura_fatura || '');
  const [valorMask, setValorMask] = useState(
    arq.valor_fatura != null
      ? Number(arq.valor_fatura).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : ''
  );

  function handleSubmit(e) {
    e.preventDefault();
    onSave({
      nome_condominio_fatura: nome.trim() || null,
      vencimento_fatura: venc || null,
      proxima_leitura_fatura: proxLeitura || null,
      valor_fatura: parseValor(valorMask),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-amber-500/20 grid grid-cols-1 md:grid-cols-12 gap-2">
      <div className="md:col-span-4">
        <label className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">Cliente na conta</label>
        <input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: EDIFICIO ANDREA"
          className="w-full mt-0.5 bg-slate-100 border border-amber-500/20 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 outline-none"
        />
      </div>
      <div className="md:col-span-2">
        <label className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">Vencimento</label>
        <input
          type="date"
          value={venc}
          onChange={(e) => setVenc(e.target.value)}
          className="w-full mt-0.5 bg-slate-100 border border-amber-500/20 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 outline-none"
        />
      </div>
      <div className="md:col-span-2">
        <label className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">Próxima leitura</label>
        <input
          type="date"
          value={proxLeitura}
          onChange={(e) => setProxLeitura(e.target.value)}
          title="Data em que a concessionária lê o medidor de novo — é quando a conta do mês seguinte se forma"
          className="w-full mt-0.5 bg-slate-100 border border-amber-500/20 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 outline-none"
        />
      </div>
      <div className="md:col-span-2">
        <label className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">Valor (R$)</label>
        <input
          inputMode="numeric"
          value={valorMask}
          onChange={(e) => setValorMask(maskValor(e.target.value))}
          placeholder="0,00"
          className="w-full mt-0.5 bg-slate-100 border border-amber-500/20 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 outline-none text-right font-mono"
        />
      </div>
      <div className="md:col-span-2 flex items-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 px-2 py-1.5 text-xs font-bold text-slate-400 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 px-2 py-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-400 rounded-lg disabled:opacity-50"
        >
          {saving ? '...' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
