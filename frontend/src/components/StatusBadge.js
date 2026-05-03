export default function StatusBadge({ status }) {
  const styles = {
    'Em edição': 'bg-slate-800 text-slate-400 border border-white/10',
    'Em produção': 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    'Em processo': 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20',
    'Enviado': 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
    'Aguardando Gerente': 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
    'Aguardando Supervisora': 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    'Aguardando Sup. Gerentes': 'bg-pink-500/10 text-pink-400 border border-pink-500/20',
    'Aguardando Sp. Contabilidade': 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    'Aprovado': 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    'Solicitar alteração': 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    'Emitido': 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    'pendente': 'bg-slate-700 text-slate-300',
    'solicitar_correcao': 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    'aprovado': 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  };

  const label = status === 'Solicitar alteração' ? 'Alteração solicitada' : status;
  const cls = styles[status] || 'bg-slate-800/80 text-slate-400 border border-slate-700';

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>
      {label || 'Sem processo'}
    </span>
  );
}
