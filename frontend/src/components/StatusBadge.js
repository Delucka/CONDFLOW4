// Sistema de status com 2 fluxos paralelos:
//   - "emissao" (emissoes_pacotes): rascunho → pendente_gerente → ... → registrado
//   - "processo" (arrecadações):    Em edição → Enviado → Em aprovação → Aprovado → Emitido
// Use a prop `flow` para garantir o mapeamento correto.

const EMISSAO_STATUS = {
  'sem_processo':              { label: 'Sem processo',         classes: 'bg-slate-500/10 text-slate-500 border-slate-500/30', dot: 'bg-slate-500' },
  // Etapas de preparação pré-emissão (tabela emissoes_preparacao)
  'aguardando_fatura':         { label: 'Aguardando fatura',    classes: 'bg-amber-500/10 text-amber-400 border-amber-500/30', dot: 'bg-amber-400' },
  'aguardando_relatorio':      { label: 'Aguardando relatório', classes: 'bg-sky-500/10 text-sky-400 border-sky-500/30',       dot: 'bg-sky-400' },
  'pronto_para_emitir':        { label: 'Pronto p/ emitir',     classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400' },
  // Pacote de emissão (emissoes_pacotes)
  'rascunho':                  { label: 'Em edição',            classes: 'bg-gray-500/10 text-gray-400 border-gray-500/30',    dot: 'bg-gray-400' },
  'pendente':                  { label: 'Com gerente',          classes: 'bg-pink-500/10 text-pink-400 border-pink-500/30',    dot: 'bg-pink-400' },
  'pendente_gerente':          { label: 'Com gerente',          classes: 'bg-pink-500/10 text-pink-400 border-pink-500/30',    dot: 'bg-pink-400' },
  'aguardando gerente':        { label: 'Com gerente',          classes: 'bg-pink-500/10 text-pink-400 border-pink-500/30',    dot: 'bg-pink-400' },
  'pendente_sup_gerentes':     { label: 'Com sup. gerentes',    classes: 'bg-purple-500/10 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
  'pendente_sup_contabilidade':{ label: 'Com sup. contábil.',   classes: 'bg-amber-500/10 text-amber-400 border-amber-500/30', dot: 'bg-amber-400' },
  'aguardando supervisor':     { label: 'Com sup. contábil.',   classes: 'bg-amber-500/10 text-amber-400 border-amber-500/30', dot: 'bg-amber-400' },
  'aprovado':                  { label: 'Aguardando registro',  classes: 'bg-blue-500/10 text-blue-400 border-blue-500/30',    dot: 'bg-blue-400' },
  'registrado':                { label: 'Registrada',           classes: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',    dot: 'bg-cyan-400' },
  'expedida':                  { label: 'Expedida',             classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400' },
};

const PROCESSO_STATUS = {
  'em edição':            { label: 'Em edição',           classes: 'bg-amber-500/10 text-amber-400 border-amber-500/30', dot: 'bg-amber-400' },
  'edição finalizada':    { label: 'Edição finalizada',   classes: 'bg-rose-500/10 text-rose-400 border-rose-500/30',    dot: 'bg-rose-400' },
  'em processo':          { label: 'Edição finalizada',   classes: 'bg-rose-500/10 text-rose-400 border-rose-500/30',    dot: 'bg-rose-400' },
  'enviado':              { label: 'Enviado',             classes: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',    dot: 'bg-cyan-400' },
  'em aprovação':         { label: 'Em aprovação',        classes: 'bg-violet-500/10 text-violet-400 border-violet-500/20', dot: 'bg-violet-400' },
  'aprovado':             { label: 'Aprovado',            classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400' },
  'solicitar alteração':  { label: 'Alteração solicitada', classes: 'bg-rose-500/10 text-rose-400 border-rose-500/20',   dot: 'bg-rose-400' },
  'solicitar_correcao':   { label: 'Correção solicitada', classes: 'bg-rose-500/10 text-rose-400 border-rose-500/20',    dot: 'bg-rose-400' },
  'emitido':              { label: 'Emitido',             classes: 'bg-blue-500/10 text-blue-400 border-blue-500/20',    dot: 'bg-blue-400' },
};

const FALLBACK = { label: '—', classes: 'bg-slate-500/10 text-slate-400 border-slate-500/30', dot: 'bg-slate-400' };

// Auto-detecta o fluxo se não for especificado (compatibilidade retro)
function detectFlow(key) {
  if (PROCESSO_STATUS[key]) return 'processo';
  if (EMISSAO_STATUS[key])  return 'emissao';
  return 'emissao';
}

export default function StatusBadge({ status, flow }) {
  const key = (status || '').toLowerCase();
  const f = flow || detectFlow(key);
  const map = f === 'processo' ? PROCESSO_STATUS : EMISSAO_STATUS;
  const config = map[key] || EMISSAO_STATUS[key] || PROCESSO_STATUS[key] || { ...FALLBACK, label: status || '—' };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${config.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} />
      {config.label}
    </span>
  );
}
