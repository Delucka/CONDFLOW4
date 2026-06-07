// Sistema de status com 2 fluxos paralelos:
//   - "emissao" (emissoes_pacotes): rascunho → pendente_gerente → ... → registrado
//   - "processo" (arrecadações):    Em edição → Enviado → Em aprovação → Aprovado → Emitido
// Use a prop `flow` para garantir o mapeamento correto.

const EMISSAO_STATUS = {
  'sem_processo':              { label: 'Sem processo',         classes: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  // Etapas de preparação pré-emissão (tabela emissoes_preparacao)
  'aguardando_fatura':         { label: 'Aguardando fatura',    classes: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  'aguardando_relatorio':      { label: 'Aguardando relatório', classes: 'bg-sky-50 text-sky-700 border-sky-200',       dot: 'bg-sky-500' },
  'pronto_para_emitir':        { label: 'Pronto p/ emitir',     classes: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  // Pacote de emissão (emissoes_pacotes)
  'rascunho':                  { label: 'Em edição',            classes: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  'pendente':                  { label: 'Com gerente',          classes: 'bg-pink-50 text-pink-700 border-pink-200',    dot: 'bg-pink-500' },
  'pendente_gerente':          { label: 'Com gerente',          classes: 'bg-pink-50 text-pink-700 border-pink-200',    dot: 'bg-pink-500' },
  'aguardando gerente':        { label: 'Com gerente',          classes: 'bg-pink-50 text-pink-700 border-pink-200',    dot: 'bg-pink-500' },
  'pendente_sup_gerentes':     { label: 'Com sup. gerentes',    classes: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
  'pendente_sup_contabilidade':{ label: 'Com sup. contábil.',   classes: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  'aguardando supervisor':     { label: 'Com sup. contábil.',   classes: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  'aprovado':                  { label: 'Aguardando registro',  classes: 'bg-blue-50 text-blue-700 border-blue-200',    dot: 'bg-blue-500' },
  'registrado':                { label: 'Registrada',           classes: 'bg-cyan-50 text-cyan-700 border-cyan-200',    dot: 'bg-cyan-500' },
  'expedida':                  { label: 'Expedida',             classes: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
};

const PROCESSO_STATUS = {
  'em edição':            { label: 'Em edição',           classes: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  'edição finalizada':    { label: 'Edição finalizada',   classes: 'bg-rose-50 text-rose-700 border-rose-200',    dot: 'bg-rose-500' },
  'em processo':          { label: 'Edição finalizada',   classes: 'bg-rose-50 text-rose-700 border-rose-200',    dot: 'bg-rose-500' },
  'enviado':              { label: 'Enviado',             classes: 'bg-cyan-50 text-cyan-700 border-cyan-200',    dot: 'bg-cyan-500' },
  'em aprovação':         { label: 'Em aprovação',        classes: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  'aprovado':             { label: 'Aprovado',            classes: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  'solicitar alteração':  { label: 'Alteração solicitada', classes: 'bg-rose-50 text-rose-700 border-rose-200',   dot: 'bg-rose-500' },
  'solicitar_correcao':   { label: 'Correção solicitada', classes: 'bg-rose-50 text-rose-700 border-rose-200',    dot: 'bg-rose-500' },
  'emitido':              { label: 'Emitido',             classes: 'bg-blue-50 text-blue-700 border-blue-200',    dot: 'bg-blue-500' },
};

const FALLBACK = { label: '—', classes: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' };

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
