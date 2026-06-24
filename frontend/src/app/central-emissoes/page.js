'use client';

import { useAuth } from '@/lib/auth';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Archive } from 'lucide-react';

import { useState } from 'react';

// Carrega só a view ativa (cada papel usa uma) — bundle inicial menor, navegação mais rápida.
const ViewLoader = () => (
  <div className="flex h-[400px] items-center justify-center">
    <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
  </div>
);
const VisaoEmissor = dynamic(() => import('./components/VisaoEmissor'), { loading: ViewLoader, ssr: false });
const VisaoMaster = dynamic(() => import('./components/VisaoMaster'), { loading: ViewLoader, ssr: false });
const RegistroEmissoes = dynamic(() => import('./components/RegistroEmissoes'), { loading: ViewLoader, ssr: false });

export default function CentralEmissoesPage() {
  const { profile, loading } = useAuth();
  const [activeView, setActiveView] = useState('default');

  if (loading || !profile) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
      </div>
    );
  }

  // Acesso restrito a master e departamento (emissor)
  const isMaster = profile.role === 'master';
  const isDepartamento = profile.role === 'departamento';

  // Montar abas conforme o perfil
  const tabs = [];

  if (isMaster) {
    tabs.push({ id: 'default', label: 'Painel de Gestão', activeClass: 'bg-violet-500 text-white ' });
    tabs.push({ id: 'upload', label: 'Fazer Emissões', activeClass: 'bg-violet-600 text-white ' });
  } else if (isDepartamento) {
    tabs.push({ id: 'default', label: 'Fazer Emissões', activeClass: 'bg-violet-600 text-white ' });
  }

  // Aba Registro de Emissões
  tabs.push({ id: 'registro', label: 'Registro de Emissões', icon: true, activeClass: 'bg-emerald-600 text-white ' });

  // Toolbar
  const toolbar = (
    <div className="flex gap-4 mb-6 border-b border-slate-200 pb-6">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveView(tab.id)}
          className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
            activeView === tab.id ? tab.activeClass : 'bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          {tab.icon && <Archive className="w-4 h-4" />}
          {tab.label}
        </button>
      ))}
    </div>
  );

  // Conteúdo
  let content = null;

  if (activeView === 'registro') {
    content = <RegistroEmissoes profile={profile} />;
  } else if (activeView === 'upload' && isMaster) {
    content = <VisaoEmissor profile={profile} />;
  } else if (isDepartamento) {
    content = <VisaoEmissor profile={profile} />;
  } else if (isMaster) {
    content = <VisaoMaster profile={profile} />;
  } else {
    content = (
      <div className="p-12 text-center bg-slate-50 rounded-3xl border border-slate-200 max-w-2xl mx-auto mt-10 shadow-2xl">
        <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <div className="w-8 h-8 rounded-full bg-rose-500/50"></div>
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">Acesso Restrito</h3>
        <p className="text-slate-500">Você não tem permissão para acessar o módulo Central de Emissões com o perfil atual ({profile.role}).</p>
      </div>
    );
  }

  return (
    <>
      {toolbar}
      {content}
    </>
  );
}
