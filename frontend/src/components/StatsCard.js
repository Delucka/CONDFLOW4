export default function StatsCard({ title, value, icon: Icon, color }) {
  const colorMap = {
    cyan:    { bg: 'bg-cyan-500/10',    text: 'text-cyan-400'    },
    orange:  { bg: 'bg-orange-500/10',  text: 'text-orange-400'  },
    indigo:  { bg: 'bg-indigo-500/10',  text: 'text-indigo-400'  },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-400'    },
  };
  const theme = colorMap[color] || colorMap.cyan;

  return (
    <div className="glass-card rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${theme.bg} ${theme.text}`}>
        {Icon ? <Icon className="w-4 h-4" /> : null}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate">{title}</p>
        <p className="text-xl font-black text-white leading-tight">{value}</p>
      </div>
    </div>
  );
}
