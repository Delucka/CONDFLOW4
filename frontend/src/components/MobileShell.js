'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS, canAccessPath } from '@/lib/roles';
import { usePendingCount } from '@/lib/usePendingCount';
import { LogoMark } from './Logo';
import NotificationsBell from './NotificationsBell';
import ThemeToggle from './ThemeToggle';
import InstallAppButton from './InstallAppButton';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  LayoutDashboard, FileCheck2, Receipt, MoreHorizontal, X,
  Building, FileText, Droplet, FileUp, Mail, Users, KeyRound, LogOut,
} from 'lucide-react';

// As 3 abas fixas da barra inferior (+ "Mais")
const TABS = [
  { href: '/dashboard',           icon: LayoutDashboard, label: 'Início' },
  { href: '/aprovacoes',          icon: FileCheck2,      label: 'Aprovações', showBadge: true },
  { href: '/carteiras/cobrancas', icon: Receipt,         label: 'Cobranças' },
];

// Tudo o mais vai na folha "Mais"
const MAIS_ITEMS = [
  { href: '/condominios',             icon: Building,  label: 'Planilha Anual' },
  { href: '/carteiras/segundas-vias', icon: FileText,  label: 'Segundas Vias' },
  { href: '/consumos',                icon: Droplet,   label: 'Consumos' },
  { href: '/central-emissoes',        icon: FileUp,    label: 'Central de Emissões' },
  { href: '/correios',                icon: Mail,      label: 'Correios' },
  { href: '/admin/usuarios',          icon: Users,     label: 'Acessos e Perfis' },
];

export default function MobileShell({ children }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { count: pendingCount } = usePendingCount();
  const [maisOpen, setMaisOpen] = useState(false);
  const sheetRef = useRef(null);

  // Fecha a folha ao trocar de rota
  useEffect(() => { setMaisOpen(false); }, [pathname]);

  // Foco preso + trava o scroll do body com a folha aberta
  useFocusTrap(sheetRef, maisOpen, () => setMaisOpen(false));
  useEffect(() => {
    if (!maisOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [maisOpen]);

  const role = profile?.role;
  const isActive = (href) => href === '/dashboard' ? pathname === href : pathname.startsWith(href);
  const roleLabel = ROLE_LABELS[role] || (role || '').replace('_', ' ');

  const visibleTabs = TABS.filter((t) => role && canAccessPath(role, t.href));
  const visibleMais = MAIS_ITEMS.filter((i) => role && canAccessPath(role, i.href));
  const maisActive = visibleMais.some((i) => isActive(i.href));

  return (
    <div className="flex flex-col bg-slate-50 font-sans" style={{ height: '100dvh' }}>

      {/* ===== Topo ===== */}
      <header className="shrink-0 h-14 px-4 flex items-center justify-between border-b border-slate-200 bg-white z-20">
        <div className="flex items-center gap-2">
          <LogoMark size={30} className="shrink-0" />
          <span className="text-base font-black tracking-tight text-slate-900">
            Condo<span className="text-violet-600">Flow</span>
          </span>
        </div>
        <NotificationsBell />
      </header>

      {/* ===== Conteúdo (rola) ===== */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="px-4 py-4 space-y-4 pb-6">
          {children}
        </div>
      </main>

      {/* ===== Barra inferior ===== */}
      <nav
        aria-label="Navegação principal"
        className="shrink-0 border-t border-slate-200 bg-white z-20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-4">
          {visibleTabs.map((t) => {
            const active = isActive(t.href);
            const badge = t.showBadge && pendingCount > 0;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className="relative flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] active:opacity-60 transition-opacity"
              >
                <span className="relative">
                  <t.icon className={`w-6 h-6 ${active ? 'text-violet-600' : 'text-slate-400'}`} aria-hidden="true" />
                  {badge && (
                    <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[9px] font-black px-1 rounded-full min-w-[15px] text-center leading-[15px]" aria-label={`${pendingCount} pendências`}>
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </span>
                <span className={`text-[10px] font-bold ${active ? 'text-violet-600' : 'text-slate-400'}`}>{t.label}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMaisOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={maisOpen}
            className="relative flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] active:opacity-60 transition-opacity"
          >
            <MoreHorizontal className={`w-6 h-6 ${maisOpen || maisActive ? 'text-violet-600' : 'text-slate-400'}`} aria-hidden="true" />
            <span className={`text-[10px] font-bold ${maisOpen || maisActive ? 'text-violet-600' : 'text-slate-400'}`}>Mais</span>
          </button>
        </div>
      </nav>

      {/* ===== Folha "Mais" ===== */}
      {maisOpen && (
        <div className="fixed inset-0 z-[80] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Mais opções">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={() => setMaisOpen(false)} aria-hidden="true" />
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="relative bg-white rounded-t-3xl px-4 pt-3 overflow-y-auto outline-none animate-slide-up"
            style={{ maxHeight: '85vh', paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
          >
            <div className="mx-auto w-10 h-1.5 rounded-full bg-slate-300 mb-3" aria-hidden="true" />

            {profile && (
              <div className="flex items-center gap-3 px-1 mb-4">
                <div className="w-11 h-11 rounded-full bg-violet-600 text-white flex items-center justify-center font-black text-lg shrink-0" aria-hidden="true">
                  {profile.full_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{profile.full_name}</p>
                  <p className="text-[10px] uppercase font-bold text-violet-600 tracking-widest truncate">{roleLabel}</p>
                </div>
                <button type="button" onClick={() => setMaisOpen(false)} aria-label="Fechar"
                  className="ml-auto tap shrink-0 inline-flex items-center justify-center rounded-full w-9 h-9 text-slate-500 hover:bg-slate-100 transition-colors">
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            )}

            {visibleMais.length > 0 && (
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {visibleMais.map((i) => {
                  const active = isActive(i.href);
                  return (
                    <Link key={i.href} href={i.href}
                      className={`flex flex-col items-center justify-center text-center gap-2 py-4 px-1 rounded-2xl border transition-colors active:opacity-70 ${active ? 'bg-violet-600 border-violet-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                      <i.icon className={`w-6 h-6 ${active ? 'text-white' : 'text-violet-600'}`} aria-hidden="true" />
                      <span className="text-[11px] font-bold leading-tight">{i.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="border-t border-slate-200 pt-2 space-y-0.5">
              <div className="px-1 pb-2"><InstallAppButton /></div>
              <div className="px-1 py-1"><ThemeToggle /></div>
              <Link href="/alterar-senha"
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-slate-600 active:opacity-70 transition-opacity">
                <KeyRound className="w-5 h-5 shrink-0 text-slate-400" aria-hidden="true" />
                Alterar senha
              </Link>
              <button type="button" onClick={signOut}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold text-rose-500 active:opacity-70 transition-opacity w-full">
                <LogOut className="w-5 h-5 shrink-0" aria-hidden="true" />
                Desconectar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
