'use client';
import { useAuth } from '@/lib/auth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import { Loader2, Bell } from 'lucide-react';

export default function AppShell({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && pathname !== '/' && pathname !== '/login' && pathname !== '/reset-password') {
      router.push('/login');
    }
  }, [user, loading, router, pathname]);

  // Forçar troca de senha no primeiro acesso (ou após reset pelo master)
  useEffect(() => {
    if (!loading && user?.must_change_password && pathname !== '/alterar-senha' && pathname !== '/login' && pathname !== '/reset-password') {
      router.replace('/alterar-senha');
    }
  }, [user?.must_change_password, loading, router, pathname]);

  // Rotas públicas/standalone (sem sidebar): landing, login e redefinição de senha
  if (pathname === '/' || pathname === '/login' || pathname === '/reset-password') return children;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#030712]">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-16 h-16 bg-violet-600 rounded-2xl flex items-center justify-center ">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
          <p className="text-sm font-bold tracking-widest uppercase text-violet-400 opacity-80 mt-2">AUTENTICANDO...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Mapa de Títulos automáticos por Rota
  const TITLES = {
    '/dashboard': 'Dashboard Central',
    '/condominios': 'Gestão de Condomínios',
    '/carteiras': 'Pastas e Carteiras',
    '/aprovacoes': 'Aprovações & Auditoria',
    '/admin/usuarios': 'Usuários do Sistema'
  };
  
  // Tenta achar o título, ou formata o nome da rota se houver id dinâmico
  const defaultTitle = pathname.includes('/arrecadacoes') ? 'Arrecadações Financeiras' : 
                       pathname.includes('/cobrancas') ? 'Cobranças Extras' : '';
  const pageTitle = TITLES[pathname] || defaultTitle || 'CondoFlow Premium';

  return (
    <div className="h-screen flex p-3 md:p-4 gap-4 overflow-hidden selection:bg-violet-200 font-sans">

      {/* Sidebar Persistente (Nunca é reconstruída ao navegar) */}
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 min-h-0 glass-panel rounded-2xl overflow-hidden relative">

        {/* Header Fixo */}
        <header className="h-[56px] px-5 flex flex-wrap items-center justify-between shrink-0 border-b border-slate-200 z-20 relative">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-slate-900 tracking-tight">{pageTitle}</h2>
          </div>

          <div className="flex items-center gap-3">
            <button className="relative p-1.5 rounded-lg hover:bg-slate-100 transition-all group">
              <Bell className="w-4 h-4 text-slate-400 group-hover:text-slate-700" />
              <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-rose-500 rounded-full"></div>
            </button>
            <div className="hidden sm:flex items-center gap-2">
              <div className="text-right">
                <p className="text-xs font-bold text-slate-700 leading-tight">Painel de Acesso</p>
                <p className="text-[9px] uppercase font-bold text-violet-600 tracking-wider">Alto Fluxo API</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content Box dinâmico */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-5 relative z-30 scroll-smooth" id="scroll-main">
          <div className="max-w-[1400px] mx-auto space-y-4 pb-12">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
