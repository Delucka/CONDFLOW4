export default function StatusBadge({ status }) {
  const statusLower = (status || '').toLowerCase();

  const map = {
    'rascunho': { label: 'Em edição', class: 'bg-slate-100 text-slate-600 border-slate-200' },
    'pendente_gerente': { label: 'Com gerente', class: 'bg-pink-50 text-pink-700 border-pink-200' },
    'pendente_sup_gerentes': { label: 'Com sup. gerentes', class: 'bg-purple-50 text-purple-700 border-purple-200' },
    'pendente_sup_contabilidade': { label: 'Com sup. contabilidade', class: 'bg-amber-50 text-amber-700 border-amber-200' },
    'aprovado': { label: 'Aguardando registro', class: 'bg-blue-50 text-blue-700 border-blue-200' },
    'registrado': { label: 'Emissão registrada', class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    'solicitar_correcao': { label: 'Correção Solicitada', class: 'bg-rose-50 text-rose-700 border-rose-200' },
    // Compatibilidade com termos antigos
    'pendente': { label: 'Com gerente', class: 'bg-pink-50 text-pink-700 border-pink-200' },
    'aguardando gerente': { label: 'Com gerente', class: 'bg-pink-50 text-pink-700 border-pink-200' },
    'aguardando chefe': { label: 'Com sup. gerentes', class: 'bg-purple-50 text-purple-700 border-purple-200' },
    'aguardando supervisor': { label: 'Com sup. contabilidade', class: 'bg-amber-50 text-amber-700 border-amber-200' },
    'aguardando supervisora': { label: 'Com sup. contabilidade', class: 'bg-amber-50 text-amber-700 border-amber-200' }
  };

  const current = map[statusLower] || { label: status || 'Sem status', class: 'bg-slate-100 text-slate-600 border-slate-200' };

  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black border uppercase tracking-widest ${current.class}`}>
      {current.label}
    </span>
  );
}
