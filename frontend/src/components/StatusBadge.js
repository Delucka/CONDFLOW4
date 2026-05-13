const STATUS_CONFIG = {
  // ── Emissões (emissoes_pacotes) ──────────────────────────────────────
  'sem_processo': {
    label: 'Sem processo',
    classes: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
    dot: 'bg-slate-500'
  },
  'rascunho': {
    label: 'Em edição',
    classes: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
    dot: 'bg-gray-400'
  },
  'pendente_gerente': {
    label: 'Com gerente',
    classes: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    dot: 'bg-pink-400'
  },
  'pendente_sup_gerentes': {
    label: 'Com sup. gerentes',
    classes: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    dot: 'bg-purple-400'
  },
  'pendente_sup_contabilidade': {
    label: 'Com sup. contabilidade',
    classes: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400'
  },
  'aprovado': {
    label: 'Aguardando registro',
    classes: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    dot: 'bg-blue-400'
  },
  'registrado': {
    label: 'Registrada',
    classes: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    dot: 'bg-cyan-400'
  },
  'expedida': {
    label: 'Expedida',
    classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-400'
  },

  // ── Processos (arrecadações) — mantidos para compatibilidade ─────────
  'em edição': {
    label: 'Em edição',
    classes: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
    dot: 'bg-gray-400'
  },
  'enviado': {
    label: 'Enviado',
    classes: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    dot: 'bg-cyan-400'
  },
  'em aprovação': {
    label: 'Em aprovação',
    classes: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    dot: 'bg-violet-400'
  },
  'aprovado_processo': {
    label: 'Aprovado',
    classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    dot: 'bg-emerald-400'
  },
  'solicitar alteração': {
    label: 'Alteração solicitada',
    classes: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    dot: 'bg-rose-400'
  },
  'solicitar_correcao': {
    label: 'Correção solicitada',
    classes: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    dot: 'bg-rose-400'
  },
  'emitido': {
    label: 'Emitido',
    classes: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    dot: 'bg-blue-400'
  },
  'pendente': {
    label: 'Com gerente',
    classes: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    dot: 'bg-pink-400'
  },
  'aguardando gerente': {
    label: 'Com gerente',
    classes: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    dot: 'bg-pink-400'
  },
  'aguardando supervisor': {
    label: 'Com sup. contabilidade',
    classes: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400'
  },
};

export default function StatusBadge({ status }) {
  const key = (status || '').toLowerCase();
  const config = STATUS_CONFIG[key] || {
    label: status || 'Sem processo',
    classes: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    dot: 'bg-slate-400'
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${config.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} />
      {config.label}
    </span>
  );
}
