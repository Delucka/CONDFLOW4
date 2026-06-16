'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  const audioCtxRef = useRef(null);
  const prevIdsRef = useRef(null);   // null = ainda não carregou a 1ª vez
  const tituloOrigRef = useRef(null);
  const blinkRef = useRef(null);
  const btnRef = useRef(null);
  const dropRef = useRef(null);
  const [pos, setPos] = useState({ top: 56, right: 16 });

  const naoLidas = items.filter(n => !n.lida).length;

  // Beep curto (Web Audio — sem arquivo). Desbloqueado no 1º clique do usuário.
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      [880, 1175].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        const start = t + i * 0.14;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
        o.connect(g); g.connect(ctx.destination);
        o.start(start); o.stop(start + 0.14);
      });
    } catch { /* navegador pode bloquear sem gesto — ignora */ }
  }

  function pararBlink() {
    if (blinkRef.current) { clearInterval(blinkRef.current); blinkRef.current = null; }
    if (tituloOrigRef.current != null) { document.title = tituloOrigRef.current; }
  }
  function iniciarBlink() {
    if (blinkRef.current) return;
    if (tituloOrigRef.current == null) tituloOrigRef.current = document.title;
    let on = false;
    blinkRef.current = setInterval(() => {
      document.title = on ? tituloOrigRef.current : '🔔 Nova notificação!';
      on = !on;
    }, 1000);
  }

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

  // Fecha ao clicar fora (considera o dropdown, que agora é renderizado via portal)
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && ref.current.contains(e.target)) return;
      if (dropRef.current && dropRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Desbloqueia o áudio no 1º gesto do usuário (política de autoplay)
  useEffect(() => {
    function unlock() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        audioCtxRef.current.resume?.();
      } catch {}
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  // Detecta NOVA notificação -> beep + aba piscando
  useEffect(() => {
    const ids = new Set(items.map(i => i.id));
    if (prevIdsRef.current === null) { prevIdsRef.current = ids; return; } // ignora 1ª carga
    const chegou = items.some(i => !prevIdsRef.current.has(i.id) && !i.lida);
    prevIdsRef.current = ids;
    if (chegou) { beep(); iniciarBlink(); }
  }, [items]);

  // Para de piscar quando o usuário volta pra aba, abre o sino ou zera as não lidas
  useEffect(() => {
    function onFocus() { if (!document.hidden) pararBlink(); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, []);
  useEffect(() => { if (open || naoLidas === 0) pararBlink(); }, [open, naoLidas]);
  useEffect(() => () => pararBlink(), []);

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

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) });
    }
    setOpen(o => !o);
  }

  return (
    <div className="relative" ref={ref}>
      <button ref={btnRef} onClick={toggle} type="button"
        aria-label={naoLidas > 0 ? `Notificações, ${naoLidas} não lidas` : 'Notificações'}
        aria-haspopup="true" aria-expanded={open}
        className="tap relative inline-flex items-center justify-center rounded-lg hover:bg-slate-100 transition-all group">
        <Bell className="w-4 h-4 text-slate-400 group-hover:text-slate-700" aria-hidden="true" />
        {naoLidas > 0 && (
          <span className="absolute top-0.5 right-0.5 bg-rose-500 text-white text-[9px] font-black min-w-[15px] h-[15px] px-1 rounded-full flex items-center justify-center leading-none" aria-hidden="true">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {open && createPortal(
        <div ref={dropRef} style={{ top: pos.top, right: pos.right }}
          className="fixed w-[340px] max-w-[90vw] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-[9999]">
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
        </div>,
        document.body
      )}
    </div>
  );
}
