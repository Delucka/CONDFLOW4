'use client';

import { useAuth } from '@/lib/auth';
import { Loader2 } from 'lucide-react';
import VisaoEmissor from './components/VisaoEmissor';
import VisaoGerente from './components/VisaoGerente';
import VisaoMaster from './components/VisaoMaster';
import RegistroEmissoes from './components/RegistroEmissoes';
import { Archive } from 'lucide-react';

import { useState } from 'react';

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

  const isMasterOrSup = ['master', 'supervisora', 'supervisor_gerentes', 'supervisora_contabilidade'].includes(profile.role);
  const isGerente = profile.role === 'gerente';
  const isDepartamento = profile.role === 'departamento';

  // Montar abas conforme o perfil
  const tabs = [];

  if (isMasterOrSup) {
    tabs.push({ id: 'default', label: 'Painel de Gestão', activeClass: 'bg-cyan-500 text-slate-900 shadow-[0_0_15px_rgba(6,182,212,0.4)]' });
    tabs.push({ id: 'upload', label: 'Fazer Emissões', activeClass: 'bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' });
  } else if (isDepartamento) {
    tabs.push({ id: 'default', label: 'Fazer Emissões', activeClass: 'bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' });
  } else if (isGerente) {
    tabs.push({ id: 'default', label: 'Meus Pacotes', activeClass: 'bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' });
  }

  // Aba Registro de Emissões — visível para TODOS
  tabs.push({ id: 'registro', label: 'Registro de Emissões', icon: true, activeClass: 'bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]' });

  // Toolbar
  const toolbar = (
    <div className="flex gap-4 mb-6 border-b border-white/5 pb-6">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveView(tab.id)}
          className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
            activeView === tab.id ? tab.activeClass : 'bg-white/5 text-gray-500 hover:text-white hover:bg-white/10'
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
  } else if (activeView === 'upload' && isMasterOrSup) {
    content = <VisaoEmissor profile={profile} />;
  } else if (isDepartamento) {
    content = <VisaoEmissor profile={profile} />;
  } else if (isGerente) {
    content = <VisaoGerente profile={profile} />;
  } else if (isMasterOrSup) {
    content = <VisaoMaster profile={profile} />;
  } else {
    content = (
      <div className="p-12 text-center bg-white/5 rounded-3xl border border-white/10 max-w-2xl mx-auto mt-10 shadow-2xl">
        <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <div className="w-8 h-8 rounded-full bg-rose-500/50"></div>
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Acesso Restrito</h3>
        <p className="text-gray-400">Você não tem permissão para acessar o módulo Central de Emissões com o perfil atual ({profile.role}).</p>
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
