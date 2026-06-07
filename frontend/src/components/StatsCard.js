export default function StatsCard({ title, value, icon: Icon, color }) {
  const colorMap = {
    cyan:    { bg: 'bg-cyan-50',    text: 'text-cyan-600'    },
    orange:  { bg: 'bg-orange-50',  text: 'text-orange-600'  },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600'  },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600'    },
  };
  const theme = colorMap[color] || colorMap.cyan;

  return (
    <div className="glass-card rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${theme.bg} ${theme.text}`}>
        {Icon ? <Icon className="w-4 h-4" /> : null}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">{title}</p>
        <p className="text-xl font-black text-slate-900 leading-tight">{value}</p>
      </div>
    </div>
  );
}
