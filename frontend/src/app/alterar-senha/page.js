'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { apiPost } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Link from 'next/link';
import { KeyRound, Loader2, Eye, EyeOff, CheckCircle2, ShieldAlert, Users, ChevronRight } from 'lucide-react';

export default function AlterarSenhaPage() {
  const router = useRouter();
  const { user, refreshProfile } = useAuth();
  const { addToast } = useToast();
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const isForced = !!user?.must_change_password;
  const isMaster = user?.role === 'master';

  async function handleSubmit(e) {
    e.preventDefault();
    if (pwd.length < 6)  { addToast('Senha deve ter no mínimo 6 caracteres.', 'error'); return; }
    if (pwd !== pwd2)    { addToast('As senhas não coincidem.', 'error'); return; }

    setLoading(true);
    try {
      await apiPost('/api/auth/change-password', { new_password: pwd });
      addToast('Senha alterada com sucesso!', 'success');
      await refreshProfile?.();
      router.push('/dashboard');
    } catch (err) {
      addToast(err.message || 'Erro ao alterar senha', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-fade-in w-full max-w-2xl mx-auto py-8 px-4">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-cyan-400" />
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">Alterar Minha Senha</h2>
        </div>
        <p className="text-slate-400 text-sm">Defina uma nova senha para <strong>sua própria conta</strong> ({user?.email}).</p>
      </div>

      {isMaster && !isForced && (
        <Link href="/admin/usuarios"
          className="mb-6 bg-violet-500/10 border border-violet-500/30 rounded-2xl p-4 flex items-center gap-3 hover:bg-violet-500/15 transition-all group">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-violet-400" />
          </div>
          <div className="flex-1">
            <p className="text-violet-300 font-bold text-sm">Precisa alterar a senha de outro usuário?</p>
            <p className="text-violet-200/70 text-xs mt-0.5">Vá em <strong>Acessos e Perfis</strong> e clique em "Senha" no card do usuário.</p>
          </div>
          <ChevronRight className="w-5 h-5 text-violet-400 group-hover:translate-x-1 transition-transform" />
        </Link>
      )}

      {isForced && (
        <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 flex items-start gap-3 animate-fade-in">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 font-bold text-sm">Troca obrigatória no primeiro acesso</p>
            <p className="text-amber-200/70 text-xs mt-1">
              Por segurança, é necessário definir uma nova senha pessoal antes de continuar usando o sistema.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="glass-panel rounded-2xl p-6 space-y-5">
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nova senha</label>
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="w-full px-4 py-3 pr-11 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 focus:border-cyan-500 transition-all outline-none" />
            <button type="button" onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Confirmar senha</label>
          <input
            type={show ? 'text' : 'password'}
            required
            minLength={6}
            placeholder="Digite a senha novamente"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 focus:border-cyan-500 transition-all outline-none" />
        </div>

        <div className="flex gap-3 pt-2">
          {!isForced && (
            <button type="button" onClick={() => router.push('/dashboard')}
              className="px-6 py-3 text-xs font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors">
              Cancelar
            </button>
          )}
          <button type="submit" disabled={loading}
            className="flex-1 py-3 bg-cyan-500 text-slate-950 rounded-xl text-sm font-bold hover:bg-cyan-400 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {loading ? 'SALVANDO...' : 'CONFIRMAR NOVA SENHA'}
          </button>
        </div>
      </form>
    </div>
  );
}
