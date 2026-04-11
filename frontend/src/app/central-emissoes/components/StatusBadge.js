export default function StatusBadge({ status }) {
  const map = {
    pendente: { label: 'Pendente', class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    aprovado: { label: 'Aprovado', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    solicitar_correcao: { label: 'Correção', class: 'bg-rose-500/10 text-rose-400 border-rose-500/20' }
  };
  
  const current = map[status] || { label: status, class: 'bg-gray-500/10 text-gray-400 border-gray-500/20' };

  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${current.class}`}>
      {current.label}
    </span>
  );
}
