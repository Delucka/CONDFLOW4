'use client';
import { useAuth } from '@/lib/auth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import NotificationsBell from './NotificationsBell';
import { Loader2, Menu } from 'lucide-react';

export default function AppShell({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fecha o menu mobile ao trocar de rota
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (!loading && !user && pathname !== '/' && pathname !== '/login' && pathname !== '/reset-password') {
      router.push('/');   // sem sessão (inclui logout) → landing page, não /login
    }
  }, [user, loading, router, pathname]);

  // Forçar troca de senha no primeiro acesso (ou após reset pelo master)
  useEffect(() => {
    if (!loading && user?.must_change_password && pathname !== '/alterar-senha' && pathname !== '/login' && pathname !== '/reset-password') {
      router.replace('/alterar-senha');
    }
  }, [user?.must_change_password, loading, router, pathname]);

  // Keep-alive: mantém a função serverless (gru1) quente durante toda a sessão.
  // Sem isso ela "esfria" entre recargas e o próximo acesso paga o cold-start (~2-3s).
  // /api/health é leve (sem auth/DB), então o custo é desprezível.
  useEffect(() => {
    if (loading || !user?.id) return;
    const ping = () => { fetch('/api/health', { cache: 'no-store' }).catch(() => {}); };
    ping();
    const id = setInterval(ping, 240000); // a cada 4 min
    return () => clearInterval(id);
  }, [loading, user?.id]);

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
    '/carteiras/segundas-vias': 'Segundas Vias',
    '/aprovacoes': 'Aprovações & Auditoria',
    '/correios': 'Correios — Gerador de Rateio',
    '/admin/usuarios': 'Usuários do Sistema'
  };
  
  // Tenta achar o título, ou formata o nome da rota se houver id dinâmico
  const defaultTitle = pathname.includes('/arrecadacoes') ? 'Arrecadações Financeiras' : 
                       pathname.includes('/cobrancas') ? 'Cobranças Extras' : '';
  const pageTitle = TITLES[pathname] || defaultTitle || 'CondoFlow Premium';

  return (
    <div className="h-screen flex p-2 sm:p-3 md:p-4 gap-4 overflow-hidden selection:bg-violet-200 font-sans">

      {/* Pular para o conteúdo (aparece ao focar via teclado) */}
      <a href="#scroll-main" className="skip-link sr-only focus:not-sr-only">Pular para o conteúdo</a>

      {/* Sidebar Persistente (coluna no desktop, drawer no mobile) */}
      <Sidebar mobileOpen={drawerOpen} onCloseMobile={() => setDrawerOpen(false)} />

      <main className="flex-1 flex flex-col min-w-0 min-h-0 glass-panel rounded-2xl overflow-hidden relative">

        {/* Header Fixo */}
        <header className="h-[56px] px-3 sm:px-5 flex items-center justify-between gap-2 shrink-0 border-b border-slate-200 z-20 relative">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={drawerOpen}
              aria-controls="app-sidebar"
              className="lg:hidden tap shrink-0 -ml-1 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors">
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <h2 className="text-sm sm:text-base font-black text-slate-900 tracking-tight truncate">{pageTitle}</h2>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <NotificationsBell />
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
