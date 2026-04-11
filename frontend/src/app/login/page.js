'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { Building2, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.push('/dashboard');
    }
  }, [user, router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      await signIn(email, senha);
      router.push('/dashboard');
    } catch (err) {
      setErro('Email ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="fixed top-[-10%] left-[-10%] w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[150px] pointer-events-none" />

      <div className="glass-panel w-full max-w-md rounded-2xl p-8 animate-fade-up relative z-10">
        {/* Logo */}
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-cyan-400 border border-slate-800 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
            <Building2 className="w-8 h-8" />
          </div>
        </div>
        <h2 className="text-3xl font-black text-center text-white mb-1 tracking-tight">
          CONDO<span className="text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.4)]">FLOW</span>
        </h2>
        <p className="text-slate-400 text-center mb-8 text-sm font-medium tracking-wide">
          SISTEMA DE GESTÃO E ARRECADAÇÕES
        </p>

        {/* Error */}
        {erro && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 p-4 rounded-xl animate-fade-in">
            <p className="text-sm text-red-400 font-semibold text-center">{erro}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              placeholder="admin@condoflow.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all outline-none"
            />
          </div>
          <div>
            <label htmlFor="senha" className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
              Senha
            </label>
            <input
              id="senha"
              type="password"
              required
              placeholder="••••••••"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-cyan-500 text-slate-950 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(34,211,238,0.3)] hover:bg-cyan-400 hover:shadow-[0_0_20px_rgba(34,211,238,0.5)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {loading ? 'AUTENTICANDO...' : 'ACESSAR PAINEL'}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-slate-500 font-medium">
          CondoFlow &copy; 2026 — Gestão Inteligente
        </p>
      </div>
    </div>
  );
}
