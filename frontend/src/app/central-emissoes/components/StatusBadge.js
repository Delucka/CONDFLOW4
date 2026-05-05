export default function StatusBadge({ status }) {
  const statusLower = (status || '').toLowerCase();

  const map = {
    'rascunho': { label: 'Em edição', class: 'bg-slate-600/20 text-slate-400 border-slate-500/20' },
    'pendente_gerente': { label: 'Com gerente', class: 'bg-pink-500/10 text-pink-400 border-pink-500/20' },
    'pendente_sup_gerentes': { label: 'Com sup. gerentes', class: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    'pendente_sup_contabilidade': { label: 'Com sup. contabilidade', class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    'aprovado': { label: 'Aguardando registro', class: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    'registrado': { label: 'Emissão registrada', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    'solicitar_correcao': { label: 'Correção Solicitada', class: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
    // Compatibilidade com termos antigos
    'pendente': { label: 'Com gerente', class: 'bg-pink-500/10 text-pink-400 border-pink-500/20' },
    'aguardando gerente': { label: 'Com gerente', class: 'bg-pink-500/10 text-pink-400 border-pink-500/20' },
    'aguardando chefe': { label: 'Com sup. gerentes', class: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    'aguardando supervisor': { label: 'Com sup. contabilidade', class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    'aguardando supervisora': { label: 'Com sup. contabilidade', class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' }
  };
  
  const current = map[statusLower] || { label: status || 'Sem status', class: 'bg-gray-500/10 text-gray-400 border-gray-500/20' };

  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black border uppercase tracking-widest ${current.class}`}>
      {current.label}
    </span>
  );
}
