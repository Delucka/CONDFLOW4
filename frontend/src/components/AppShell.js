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
    if (!loading && !user && pathname !== '/login') router.push('/login');
  }, [user, loading, router, pathname]);

  // Se for a tela de Login, AppShell não embala o layout, retorna puro
  if (pathname === '/login') return children;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#030712]">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-16 h-16 bg-gradient-to-br from-violet-600 to-cyan-500 rounded-2xl flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.6)]">
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
    '/aprovacoes': 'Fluxo de Aprovações',
    '/admin/usuarios': 'Usuários do Sistema'
  };
  
  // Tenta achar o título, ou formata o nome da rota se houver id dinâmico
  const defaultTitle = pathname.includes('/arrecadacoes') ? 'Arrecadações Financeiras' : 
                       pathname.includes('/cobrancas') ? 'Cobranças Extras' : '';
  const pageTitle = TITLES[pathname] || defaultTitle || 'CondoFlow Premium';

  return (
    <div className="h-screen flex p-3 md:p-4 gap-4 overflow-hidden selection:bg-violet-500/30 font-sans">
      
      {/* Sidebar Persistente (Nunca é reconstruída ao navegar) */}
      <Sidebar />
      
      <main className="flex-1 flex flex-col min-w-0 min-h-0 glass-panel rounded-3xl overflow-hidden relative shadow-2xl">
        
        {/* Header Fixo */}
        <header className="h-[80px] px-8 flex flex-wrap items-center justify-between shrink-0 border-b border-white/5 z-20 relative">
          <div>
            <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400">
              {pageTitle}
            </h2>
            <div className="w-1/3 h-1 bg-gradient-to-r from-cyan-400 to-violet-500 rounded-full mt-1.5 opacity-80"></div>
          </div>
          
          <div className="flex items-center gap-5">
            <button className="relative p-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all group">
              <Bell className="w-5 h-5 text-gray-400 group-hover:text-white" />
              <div className="absolute top-2 right-2.5 w-2 h-2 bg-pink-500 rounded-full shadow-[0_0_10px_rgba(236,72,153,0.8)] border border-[rgba(17,24,39,1)]"></div>
            </button>
            <div className="hidden sm:flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-bold text-gray-200 leading-tight">Painel de Acesso</p>
                <p className="text-[10px] uppercase font-bold text-violet-400 tracking-wider">Alto Fluxo API</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content Box dinâmico */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 md:p-8 relative z-30 scroll-smooth" id="scroll-main">
          <div className="max-w-[1400px] mx-auto space-y-6 pb-20">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
