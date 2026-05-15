'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { Building2, Loader2, KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [show, setShow] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // O link de reset do Supabase cria automaticamente a sessão (via hash fragment).
    // Damos um pequeno delay pra garantir que onAuthStateChange já processou.
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setSessionReady(!!data?.session);
    }, 300);
    return () => clearTimeout(t);
  }, [supabase]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    if (pwd.length < 6) { setErro('Senha deve ter no mínimo 6 caracteres.'); return; }
    if (pwd !== pwd2)   { setErro('As senhas não coincidem.'); return; }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;

      // Limpa flag de troca obrigatória (se existir)
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        await supabase.from('profiles')
          .update({ must_change_password: false, password_changed_at: new Date().toISOString() })
          .eq('id', user.id);
      }

      setDone(true);
      setTimeout(() => router.push('/dashboard'), 2000);
    } catch (err) {
      setErro(err.message || 'Erro ao atualizar a senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed top-[-10%] left-[-10%] w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[150px] pointer-events-none" />

      <div className="glass-panel w-full max-w-md rounded-2xl p-8 relative z-10 animate-fade-up">
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-cyan-400 border border-slate-800">
            <KeyRound className="w-8 h-8" />
          </div>
        </div>
        <h2 className="text-2xl font-black text-center text-white mb-1 tracking-tight">NOVA SENHA</h2>
        <p className="text-slate-400 text-center mb-8 text-sm">Crie uma senha segura para acessar o CondoFlow</p>

        {done ? (
          <div className="text-center space-y-5 animate-fade-in">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="text-emerald-400 font-bold">Senha atualizada com sucesso!</p>
            <p className="text-xs text-slate-500">Redirecionando para o painel…</p>
          </div>
        ) : !sessionReady ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Validando link…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {erro && (
              <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400 font-semibold">{erro}</p>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nova senha</label>
              <div className="relative">
                <input type={show ? 'text' : 'password'} required minLength={6} placeholder="••••••••"
                  value={pwd} onChange={(e) => setPwd(e.target.value)}
                  className="w-full px-4 py-3 pr-11 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 focus:border-cyan-500 transition-all outline-none" />
                <button type="button" onClick={() => setShow(!show)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Confirmar senha</label>
              <input type={show ? 'text' : 'password'} required minLength={6} placeholder="••••••••"
                value={pwd2} onChange={(e) => setPwd2(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 focus:border-cyan-500 transition-all outline-none" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-cyan-500 text-slate-950 rounded-xl text-sm font-bold hover:bg-cyan-400 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {loading ? 'SALVANDO...' : 'DEFINIR SENHA'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
