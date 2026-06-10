'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';

function tempoRelativo(iso) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 604800) return `${Math.floor(s / 86400)} d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function NotificationsBell() {
  const { user } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef(null);

  const naoLidas = items.filter(n => !n.lida).length;

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from('notificacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    setItems(data || []);
    setLoading(false);
  }, [supabase]);

  // Carrega + polling leve + realtime
  useEffect(() => {
    if (!user) return;
    fetchItems();
    const t = setInterval(fetchItems, 60000);
    const ch = supabase
      .channel(`notif_${user.id}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes', filter: `user_id=eq.${user.id}` }, fetchItems)
      .subscribe();
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, [user, fetchItems, supabase]);

  // Fecha ao clicar fora
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function marcarLida(n) {
    if (!n.lida) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, lida: true } : x));
      await supabase.from('notificacoes').update({ lida: true }).eq('id', n.id);
    }
  }

  async function marcarTodas() {
    const ids = items.filter(n => !n.lida).map(n => n.id);
    if (!ids.length) return;
    setItems(prev => prev.map(x => ({ ...x, lida: true })));
    await supabase.from('notificacoes').update({ lida: true }).in('id', ids);
  }

  function abrir(n) {
    marcarLida(n);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="relative p-1.5 rounded-lg hover:bg-slate-100 transition-all group" title="Notificações">
        <Bell className="w-4 h-4 text-slate-400 group-hover:text-slate-700" />
        {naoLidas > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[9px] font-black min-w-[15px] h-[15px] px-1 rounded-full flex items-center justify-center leading-none">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-w-[90vw] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-[60]">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <p className="text-xs font-black uppercase tracking-widest text-slate-600">Notificações</p>
            {naoLidas > 0 && (
              <button onClick={marcarTodas} className="text-[10px] font-bold text-violet-600 hover:text-violet-700 inline-flex items-center gap-1">
                <CheckCheck className="w-3.5 h-3.5" /> Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
            ) : items.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Nenhuma notificação.</p>
              </div>
            ) : (
              items.map(n => (
                <button key={n.id} onClick={() => abrir(n)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors flex gap-3 ${n.lida ? '' : 'bg-violet-50/50'}`}>
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.lida ? 'bg-transparent' : 'bg-violet-500'}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs ${n.lida ? 'font-bold text-slate-700' : 'font-black text-slate-900'} truncate`}>{n.titulo}</p>
                    {n.mensagem && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-2">{n.mensagem}</p>}
                    <p className="text-[10px] text-slate-400 mt-1">{tempoRelativo(n.created_at)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
