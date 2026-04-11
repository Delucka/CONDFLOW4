'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { createClient } from '@/utils/supabase/client';
import { useEffect, useState } from 'react';
import {
  Building2, LayoutDashboard, Building, Layers,
  FileCheck2, Users, LogOut, ChevronLeft, ChevronRight, Zap, Receipt, FileUp
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Painel Central' },
  { href: '/condominios', icon: Building, label: 'Planilha Anual' },
  { href: '/carteiras', icon: Layers, label: 'Carteiras' },
  { href: '/carteiras/cobrancas', icon: Receipt, label: 'Lançar Cobranças' },
  { href: '/aprovacoes', icon: FileCheck2, label: 'Aprovações' },
  { href: '/central-emissoes', icon: FileUp, label: 'Central de Emissões', showBadge: true },
];

const ADMIN_ITEMS = [
  { href: '/admin/usuarios', icon: Users, label: 'Acessos e Perfis' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const supabase = createClient();

  useEffect(() => {
    if (!profile) return;
    
    // Função para buscar count inicial apenas de pendentes que são da "visão" do usuário
    // Como RLS (banco) cuida de limitar para gerentes apenas seus painéis e master tudo
    const fetchPendingCount = async () => {
      // Se for emissor (departamento), não precisa de badge, pois a badge é pro aprovador (Gerente/Supervisor)
      if (profile.role === 'departamento') return;

      const { count } = await supabase
        .from('emissoes_arquivos')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pendente');
      
      setPendingCount(count || 0);
    };

    fetchPendingCount();

    // Hook realtime: Se houver mudança em emissoes_arquivos, atualiza o count
    const channel = supabase.channel('realtime_emissoes_badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emissoes_arquivos' },
        (payload) => {
          fetchPendingCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, supabase]);

  function isActive(href) {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  return (
    <aside className={`${collapsed ? 'w-24' : 'w-[280px] px-4'} flex flex-col z-10 shrink-0 transition-all duration-500 relative py-4`}>
      {/* Container Flutuante */}
      <div className="flex-1 flex flex-col py-6 glass-panel rounded-3xl overflow-hidden relative border border-white/5 shadow-2xl">
        
        {/* Glow de fundo na sidebar */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 blur-3xl rounded-full"></div>
        <div className="absolute bottom-10 left-0 w-32 h-32 bg-cyan-500/10 blur-3xl rounded-full"></div>

        {/* Logo Otimizado */}
        <div className={`flex items-center gap-3 px-6 mb-8 mt-2 ${collapsed ? 'justify-center px-0' : ''}`}>
          <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-cyan-500 rounded-2xl flex items-center justify-center text-white shadow-[0_0_25px_rgba(139,92,246,0.5)] shrink-0">
            <Zap className="w-5 h-5 fill-white" />
          </div>
          {!collapsed && (
            <h1 className="text-2xl font-black tracking-tight text-white italic drop-shadow-md">
              CONDO<span className="text-cyan-400">FLOW</span>
            </h1>
          )}
        </div>

        {/* User Card Moderno */}
        {profile && (
          <div className="px-5 mb-8">
            <div className={`flex items-center gap-3 px-3 py-2.5 bg-white/5 border border-white/10 rounded-2xl ${collapsed ? 'justify-center p-2 rounded-xl' : ''}`}>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white flex items-center justify-center font-bold text-base shadow-[0_0_15px_rgba(236,72,153,0.3)] shrink-0 ring-2 ring-white/10">
                {profile.full_name?.[0]?.toUpperCase() || '?'}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-gray-100 truncate">{profile.full_name}</p>
                  <p className="text-[10px] uppercase font-bold text-violet-400 truncate tracking-widest">{profile.role.replace('_', ' ')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation Menu Vercel-like */}
        <nav className="flex-1 overflow-y-auto px-4 space-y-1.5 overflow-x-hidden relative z-10">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 pl-3">Menu Principal</div>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-bold transition-all relative ${
                  active 
                  ? 'bg-violet-600 shadow-[0_0_20px_rgba(139,92,246,0.4)] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                } ${collapsed ? 'justify-center px-0' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-white' : 'text-gray-500 group-hover:text-cyan-400'}`} />
                {!collapsed && (
                  <div className="flex-1 flex justify-between items-center">
                    <span>{item.label}</span>
                    {item.showBadge && pendingCount > 0 && profile?.role !== 'departamento' && (
                      <span className="bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center shadow-[0_0_10px_rgba(244,63,94,0.6)]">
                        {pendingCount}
                      </span>
                    )}
                  </div>
                )}
                {collapsed && item.showBadge && pendingCount > 0 && profile?.role !== 'departamento' && (
                  <span className="absolute top-1 right-1 bg-rose-500 w-2.5 h-2.5 rounded-full border border-[rgba(17,24,39,1)]"></span>
                )}
              </Link>
            );
          })}
          
          {profile?.role === 'master' && (
            <>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-8 mb-3 pl-3">Configurações</div>
              {ADMIN_ITEMS.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-bold transition-all ${
                      active 
                      ? 'bg-violet-600 shadow-[0_0_20px_rgba(139,92,246,0.4)] text-white' 
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                    } ${collapsed ? 'justify-center px-0' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-white' : 'text-gray-500 group-hover:text-fuchsia-400'}`} />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* Opção de Retrair a Sidebar num botão Flutuante */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-24 w-7 h-7 bg-gray-900 border border-white/20 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:border-violet-500 hover:shadow-[0_0_15px_rgba(139,92,246,0.5)] transition-all z-20 shadow-xl"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {/* Logout (Red) */}
        <div className="px-4 mt-auto mb-6 relative z-10">
          <button
            onClick={signOut}
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors font-bold w-full ${collapsed ? 'justify-center px-0' : ''}`}
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && 'Desconectar'}
          </button>
        </div>
      </div>
    </aside>
  );
}
