'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useState, useRef, useEffect } from 'react';
import { ROLE_LABELS, canAccessPath } from '@/lib/roles';
import { usePendingCount } from '@/lib/usePendingCount';
import ThemeToggle from './ThemeToggle';
import { LayoutDashboard, Building, FileCheck2, Users, LogOut, ChevronLeft, ChevronRight, Receipt, FileUp, KeyRound, Droplet, Mail, X, FileText } from 'lucide-react';
import { PenguinMark } from './PenguinLogo';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useFocusTrap } from '@/hooks/useFocusTrap';

const NAV_ITEMS = [
  { href: '/dashboard',           icon: LayoutDashboard, label: 'Painel Central' },
  { href: '/condominios',         icon: Building,        label: 'Planilha Anual' },
  { href: '/carteiras/cobrancas', icon: Receipt,         label: 'Lançar Cobranças' },
  { href: '/carteiras/segundas-vias', icon: FileText,    label: 'Segundas Vias' },
  { href: '/consumos',            icon: Droplet,         label: 'Consumos' },
  { href: '/aprovacoes',          icon: FileCheck2,      label: 'Aprovações & Auditoria', showBadge: true },
  { href: '/central-emissoes',    icon: FileUp,          label: 'Central de Emissões', showBadge: true },
  { href: '/correios',            icon: Mail,            label: 'Correios' },
];
const ADMIN_ITEMS = [{ href: '/admin/usuarios', icon: Users, label: 'Acessos e Perfis' }];

export default function Sidebar({ mobileOpen = false, onCloseMobile = () => {} }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const isDesktop = useIsDesktop();
  const asideRef = useRef(null);

  // Conta pendências SUAS (filtradas por role)
  const { count: pendingCount } = usePendingCount();

  // Foco preso no drawer mobile aberto (devolve foco ao fechar)
  useFocusTrap(asideRef, mobileOpen && !isDesktop, onCloseMobile);

  // Trava o scroll do body com o drawer mobile aberto
  useEffect(() => {
    if (mobileOpen && !isDesktop) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen, isDesktop]);

  const isActive = (href) => href === '/dashboard' ? pathname === href : pathname.startsWith(href);
  const role = profile?.role;
  const visibleNav   = NAV_ITEMS.filter(i => role && canAccessPath(role, i.href));
  const visibleAdmin = ADMIN_ITEMS.filter(i => role && canAccessPath(role, i.href));
  const roleLabel    = ROLE_LABELS[role] || (role || '').replace('_', ' ');
  const isCollapsed  = isDesktop ? collapsed : false; // no mobile sempre expandido
  const handleNav    = () => { if (!isDesktop) onCloseMobile(); };

  return (
    <>
      {/* Backdrop (só mobile) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[55] bg-slate-900/50 backdrop-blur-sm lg:hidden" onClick={onCloseMobile} aria-hidden="true" />
      )}

      <aside
        id="app-sidebar"
        ref={asideRef}
        tabIndex={-1}
        role={!isDesktop ? 'dialog' : undefined}
        aria-modal={(!isDesktop && mobileOpen) ? true : undefined}
        aria-label="Menu de navegação"
        className={`fixed inset-y-0 left-0 z-[60] w-[280px] px-3 py-2 flex flex-col shrink-0 outline-none transition-transform duration-300
          lg:static lg:inset-auto lg:z-10 lg:py-3 lg:translate-x-0
          ${isCollapsed ? 'lg:w-20 lg:px-0' : 'lg:w-[240px] lg:px-3'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-[110%]'}`}
      >
        <div className="flex-1 flex flex-col py-4 glass-panel rounded-2xl overflow-hidden relative">

          <div className={`flex items-center gap-2.5 px-4 mb-6 mt-1 ${isCollapsed ? 'justify-center px-0' : ''}`}>
            <PenguinMark size={36} className="shrink-0" />
            {!isCollapsed && <h1 className="text-lg font-black tracking-tight text-slate-900">Condo<span className="text-violet-600">Flow</span></h1>}
            <button type="button" onClick={onCloseMobile} aria-label="Fechar menu"
              className="lg:hidden tap ml-auto inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {profile && (
            <div className="px-3 mb-5">
              <div className={`flex items-center gap-2.5 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl ${isCollapsed ? 'justify-center p-2' : ''}`}>
                <div className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center font-bold text-sm shrink-0" aria-hidden="true">
                  {profile.full_name?.[0]?.toUpperCase() || '?'}
                </div>
                {!isCollapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{profile.full_name}</p>
                    <p className="text-[9px] uppercase font-bold text-violet-600 truncate tracking-widest">{roleLabel}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <nav aria-label="Menu principal" className="flex-1 overflow-y-auto px-3 space-y-1 overflow-x-hidden relative z-10">
            {visibleNav.length > 0 && <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2 pl-2">Menu Principal</div>}
            {visibleNav.map((item) => {
              const active = isActive(item.href);
              const showBadge = item.showBadge && pendingCount > 0;
              return (
                <Link key={item.href} href={item.href} onClick={handleNav}
                  title={isCollapsed ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors relative ${active ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'} ${isCollapsed ? 'justify-center px-0' : ''}`}>
                  <item.icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} aria-hidden="true" />
                  {!isCollapsed && (
                    <div className="flex-1 flex justify-between items-center">
                      <span>{item.label}</span>
                      {showBadge && <span className="bg-rose-500 text-white text-[9px] font-black px-1 py-0 rounded-full min-w-[16px] text-center leading-tight" aria-label={`${pendingCount} pendências`}>{pendingCount}</span>}
                    </div>
                  )}
                  {isCollapsed && showBadge && <span className="absolute top-1 right-1 bg-rose-500 w-2 h-2 rounded-full" aria-label={`${pendingCount} pendências`} />}
                </Link>
              );
            })}

            {visibleAdmin.length > 0 && (
              <>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-6 mb-2 pl-2">Configurações</div>
                {visibleAdmin.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link key={item.href} href={item.href} onClick={handleNav}
                      title={isCollapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${active ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'} ${isCollapsed ? 'justify-center px-0' : ''}`}>
                      <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {!isCollapsed && item.label}
                    </Link>
                  );
                })}
              </>
            )}
          </nav>

          <button onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="hidden lg:flex absolute -right-3 top-24 w-7 h-7 bg-white border border-slate-300 rounded-full items-center justify-center text-slate-400 hover:text-violet-600 hover:border-violet-400 transition-all z-20 shadow-md">
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>

          <div className="px-3 mt-auto mb-4 relative z-10 space-y-0.5">
            <ThemeToggle collapsed={isCollapsed} />
            <Link href="/alterar-senha" onClick={handleNav} title={isCollapsed ? 'Alterar senha' : undefined}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-slate-100 hover:text-violet-600 transition-colors font-bold w-full ${isCollapsed ? 'justify-center px-0' : ''}`}>
              <KeyRound className="w-4 h-4 shrink-0" aria-hidden="true" />
              {!isCollapsed && 'Alterar senha'}
            </Link>
            <button onClick={signOut}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-colors font-bold w-full ${isCollapsed ? 'justify-center px-0' : ''}`}>
              <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
              {!isCollapsed && 'Desconectar'}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
