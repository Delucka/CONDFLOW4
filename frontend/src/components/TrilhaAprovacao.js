'use client';
import { siglaRole } from '@/lib/roles';
import { FLUXO_ROLES, faltamAprovar, aprovacoesValidas } from '@/lib/aprovacaoFluxo';

// Trilha "quem aprovou e quando" + quem ainda falta — visível para TODOS os perfis.
// pacote precisa de: aprovacoes[] (preferencial) e/ou aprovado_em + nivel_aprovacao (fallback).
export default function TrilhaAprovacao({ pacote, className = '' }) {
  if (!pacote) return null;
  const aprovacoes = aprovacoesValidas(pacote.aprovacoes);
  const temTrilha = aprovacoes.length > 0;
  const temDerivado = !temTrilha && !!pacote.aprovado_em;

  const sl = (pacote.status || '').toLowerCase();
  const finalizado = ['aprovado', 'registrado', 'expedida'].includes(sl) || !!pacote.aprovado_em;
  const emAprovacao = !finalizado && (/aguardando|pendente/.test(sl) || temTrilha);
  const faltam = emAprovacao ? faltamAprovar(pacote) : [];

  if (!temTrilha && !temDerivado && !emAprovacao && !pacote.correcao_em) return null;

  return (
    <div className={className}>
      {temTrilha ? (
        <div className="flex items-center gap-1 flex-wrap mt-1">
          <span className="text-[9px] text-slate-400 uppercase tracking-wider">Aprovações:</span>
          {aprovacoes.map((a, i) => {
            const s = siglaRole(a.role);
            const quando = new Date(a.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' ');
            return (
              <span key={`a${i}`} title={`${s.label} · ${a.usuario_nome || '—'}${a.usuario_email ? ' · ' + a.usuario_email : ''} · ${quando}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold cursor-help">
                ✓ {s.sigla}
              </span>
            );
          })}
          {faltam.map((role, i) => {
            const s = siglaRole(role);
            return (
              <span key={`f${i}`} title={`Aguardando aprovação de ${s.label}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-dashed border-slate-300 text-[9px] font-bold cursor-help">
                ⏳ {s.sigla}
              </span>
            );
          })}
        </div>
      ) : temDerivado ? (
        <div className="flex items-center gap-1 flex-wrap mt-1">
          <span className="text-[9px] text-slate-400 uppercase tracking-wider">Aprovações:</span>
          {(FLUXO_ROLES[Number(pacote.nivel_aprovacao) || 1] || ['supervisora_contabilidade']).map((role, i) => {
            const s = siglaRole(role);
            const quando = new Date(pacote.aprovado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return (
              <span key={i} title={`${s.label} · aprovador não registrado (pacote anterior) · concluído em ${quando}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200 text-[9px] font-bold cursor-help">
                ✓ {s.sigla}
              </span>
            );
          })}
          <span className="text-[9px] text-slate-300 italic">histórico não detalhado</span>
        </div>
      ) : emAprovacao ? (
        <div className="flex items-center gap-1 flex-wrap mt-1">
          <span className="text-[9px] text-slate-400 uppercase tracking-wider">Aguardando:</span>
          {faltam.map((role, i) => {
            const s = siglaRole(role);
            return (
              <span key={i} title={`Aguardando aprovação de ${s.label}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 border border-dashed border-slate-300 text-[9px] font-bold cursor-help">
                ⏳ {s.sigla}
              </span>
            );
          })}
        </div>
      ) : null}
      {pacote.correcao_em && (
        <p className="text-[10px] text-amber-600 mt-0.5">⚠ Correção por {pacote.correcao_por_nome || '—'} · {new Date(pacote.correcao_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' ')}</p>
      )}
    </div>
  );
}
