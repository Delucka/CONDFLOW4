import { LucideIcon } from 'lucide-react';

export default function StatsCard({ title, value, icon: Icon, color }) {
  const colorMap = {
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', shadow: 'shadow-[inset_0_0_20px_rgba(34,211,238,0.2)]', ring: 'ring-cyan-500/30' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', shadow: 'shadow-[inset_0_0_20px_rgba(249,115,22,0.2)]', ring: 'ring-orange-500/30' },
    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', shadow: 'shadow-[inset_0_0_20px_rgba(99,102,241,0.2)]', ring: 'ring-indigo-500/30' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', shadow: 'shadow-[inset_0_0_20px_rgba(16,185,129,0.2)]', ring: 'ring-emerald-500/30' },
  };

  const theme = colorMap[color] || colorMap.cyan;

  return (
    <div className="glass-card rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden group">
      
      {/* Background Glow */}
      <div className={`absolute -right-10 -top-10 w-32 h-32 blur-3xl rounded-full opacity-30 group-hover:opacity-70 transition-opacity ${theme.bg.replace('/10', '/50')}`} />
      
      <div className="flex justify-between items-start relative z-10">
        <div className={`p-4 rounded-2xl ${theme.bg} ${theme.text} ${theme.shadow} ring-1 ${theme.ring} backdrop-blur-md`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="text-right">
          <p className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-400 tracking-tighter">
            {value}
          </p>
        </div>
      </div>
      
      <div className="relative z-10 border-t border-white/5 pt-3 mt-1">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{title}</p>
      </div>
    </div>
  );
}
