// `loading` é obrigatório de fato: sem ele o card mostrava "0" enquanto o painel
// carregava e depois pulava pro número real — parecia dado, era placeholder.
export default function StatsCard({ title, value, icon: Icon, color, loading = false }) {
  const colorMap = {
    cyan:    { bg: 'bg-violet-50',    text: 'text-violet-600'    },
    orange:  { bg: 'bg-amber-50',  text: 'text-amber-600'  },
    indigo:  { bg: 'bg-violet-50',  text: 'text-violet-600'  },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    blue:    { bg: 'bg-violet-50',    text: 'text-violet-600'    },
  };
  const theme = colorMap[color] || colorMap.cyan;

  return (
    <div className="glass-card rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${theme.bg} ${theme.text}`}>
        {Icon ? <Icon className="w-4 h-4" /> : null}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">{title}</p>
        {loading
          ? <span className="mt-1 block h-5 w-12 rounded bg-slate-200 animate-pulse" aria-label="Carregando…" />
          : <p className="text-xl font-black text-slate-900 leading-tight tabular-nums">{value}</p>}
      </div>
    </div>
  );
}
