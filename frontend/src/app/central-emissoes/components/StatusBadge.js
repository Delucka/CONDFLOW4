export default function StatusBadge({ status }) {
  const map = {
    'rascunho': { label: 'Rascunho', class: 'bg-slate-600/20 text-slate-400 border-slate-500/20' },
    'pendente': { label: 'Pendente', class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    'Aguardando Gerente': { label: 'Com o Gerente', class: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
    'Aguardando Chefe': { label: 'Com o Sup. Gerente', class: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
    'Aguardando Supervisor': { label: 'Com a Sup. Contabilidade', class: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    'Aguardando Supervisora': { label: 'Com a Sup. Contabilidade', class: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    'aprovado': { label: 'Aguard. Registro', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    'solicitar_correcao': { label: 'Correção', class: 'bg-rose-500/10 text-rose-400 border-rose-500/20' }
  };
  
  const current = map[status] || { label: status || 'Sem status', class: 'bg-gray-500/10 text-gray-400 border-gray-500/20' };

  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black border uppercase tracking-widest ${current.class}`}>
      {current.label}
    </span>
  );
}
