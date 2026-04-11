export default function StatusBadge({ status }) {
  const styles = {
    'Em edição': 'badge-editing',
    'Enviado': 'badge-sent',
    'Aguardando Gerente': 'badge-reviewing',
    'Aguardando Chefe': 'badge-sent', 
    'Aguardando Supervisor': 'badge-reviewing',
    'Aprovado': 'badge-approved',
    'Solicitar alteração': 'badge-change',
    'Emitido': 'badge-issued',
  };

  const label = status === 'Solicitar alteração' ? 'Alteração solicitada' : status;
  const cls = styles[status] || 'bg-slate-800/80 text-slate-400 border border-slate-700';

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>
      {label || 'Sem processo'}
    </span>
  );
}
