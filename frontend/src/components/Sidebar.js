'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useState } from 'react';
import { ROLE_LABELS, canAccessPath } from '@/lib/roles';
import { usePendingCount } from '@/lib/usePendingCount';
import ThemeToggle from './ThemeToggle';
import { LayoutDashboard, Building, FileCheck2, Users, LogOut, ChevronLeft, ChevronRight, Zap, Receipt, FileUp, KeyRound, Droplet, Mail } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard',           icon: LayoutDashboard, label: 'Painel Central' },
  { href: '/condominios',         icon: Building,        label: 'Planilha Anual' },
  { href: '/carteiras/cobrancas', icon: Receipt,         label: 'Lançar Cobranças' },
  { href: '/consumos',            icon: Droplet,         label: 'Consumos' },
  { href: '/aprovacoes',          icon: FileCheck2,      label: 'Aprovações & Auditoria', showBadge: true },
  { href: '/central-emissoes',    icon: FileUp,          label: 'Central de Emissões', showBadge: true },
  { href: '/correios',            icon: Mail,            label: 'Correios' },
];
const ADMIN_ITEMS = [{ href: '/admin/usuarios', icon: Users, label: 'Acessos e Perfis' }];

export default function Sidebar() {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  // Conta pendências SUAS (filtradas por role)
  const { count: pendingCount } = usePendingCount();

  const isActive = (href) => href === '/dashboard' ? pathname === href : pathname.startsWith(href);
  const role = profile?.role;
  const visibleNav   = NAV_ITEMS.filter(i => role && canAccessPath(role, i.href));
  const visibleAdmin = ADMIN_ITEMS.filter(i => role && canAccessPath(role, i.href));
  const roleLabel    = ROLE_LABELS[role] || (role || '').replace('_', ' ');

  return (
    <aside className={`${collapsed ? 'w-20' : 'w-[240px] px-3'} flex flex-col z-10 shrink-0 transition-all duration-300 relative py-3`}>
      <div className="flex-1 flex flex-col py-4 glass-panel rounded-2xl overflow-hidden relative">

        <div className={`flex items-center gap-2.5 px-4 mb-6 mt-1 ${collapsed ? 'justify-center px-0' : ''}`}>
          <div className="w-8 h-8 bg-violet-600 rounded-xl flex items-center justify-center text-white shrink-0">
            <Zap className="w-4 h-4 fill-white" />
          </div>
          {!collapsed && <h1 className="text-lg font-black tracking-tight text-slate-900 italic">CONDO<span className="text-violet-600">FLOW</span></h1>}
        </div>

        {profile && (
          <div className="px-3 mb-5">
            <div className={`flex items-center gap-2.5 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl ${collapsed ? 'justify-center p-2' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                {profile.full_name?.[0]?.toUpperCase() || '?'}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">{profile.full_name}</p>
                  <p className="text-[9px] uppercase font-bold text-violet-600 truncate tracking-widest">{roleLabel}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 space-y-1 overflow-x-hidden relative z-10">
          {visibleNav.length > 0 && <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2 pl-2">Menu Principal</div>}
          {visibleNav.map((item) => {
            const active = isActive(item.href);
            const showBadge = item.showBadge && pendingCount > 0;
            return (
              <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors relative ${active ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'} ${collapsed ? 'justify-center px-0' : ''}`}>
                <item.icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} />
                {!collapsed && (
                  <div className="flex-1 flex justify-between items-center">
                    <span>{item.label}</span>
                    {showBadge && <span className="bg-rose-500 text-white text-[9px] font-black px-1 py-0 rounded-full min-w-[16px] text-center leading-tight">{pendingCount}</span>}
                  </div>
                )}
                {collapsed && showBadge && <span className="absolute top-1 right-1 bg-rose-500 w-2 h-2 rounded-full" />}
              </Link>
            );
          })}

          {visibleAdmin.length > 0 && (
            <>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-6 mb-2 pl-2">Configurações</div>
              {visibleAdmin.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${active ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'} ${collapsed ? 'justify-center px-0' : ''}`}>
                    <item.icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        <button onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-24 w-7 h-7 bg-white border border-slate-300 rounded-full flex items-center justify-center text-slate-400 hover:text-violet-600 hover:border-violet-400 transition-all z-20 shadow-md">
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        <div className="px-3 mt-auto mb-4 relative z-10 space-y-0.5">
          <ThemeToggle collapsed={collapsed} />
          <Link href="/alterar-senha" title={collapsed ? 'Alterar senha' : undefined}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-slate-100 hover:text-violet-600 transition-colors font-bold w-full ${collapsed ? 'justify-center px-0' : ''}`}>
            <KeyRound className="w-4 h-4 shrink-0" />
            {!collapsed && 'Alterar senha'}
          </Link>
          <button onClick={signOut}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-colors font-bold w-full ${collapsed ? 'justify-center px-0' : ''}`}>
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && 'Desconectar'}
          </button>
        </div>
      </div>
    </aside>
  );
}
