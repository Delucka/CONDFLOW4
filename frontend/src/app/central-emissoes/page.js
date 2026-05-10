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
  const [masterView, setMasterView] = useState('analytics'); // 'analytics' | 'upload'

  if (loading || !profile) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
      </div>
    );
  }

  const isMasterOrSup = ['master', 'supervisora', 'supervisor_gerentes', 'supervisora_contabilidade'].includes(profile.role);

  // Toolbar para Masters
  const masterToolbar = isMasterOrSup && (
    <div className="flex gap-4 mb-6 border-b border-white/5 pb-6">
      <button 
        onClick={() => setMasterView('analytics')}
        className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${masterView === 'analytics' ? 'bg-cyan-500 text-slate-900 shadow-[0_0_15px_rgba(6,182,212,0.4)]' : 'bg-white/5 text-gray-500 hover:text-white hover:bg-white/10'}`}
      >
        Painel de Gestão
      </button>
      <button 
        onClick={() => setMasterView('upload')}
        className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${masterView === 'upload' ? 'bg-violet-600 text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]' : 'bg-white/5 text-gray-500 hover:text-white hover:bg-white/10'}`}
      >
        Fazer Emissões
      </button>
      <button 
        onClick={() => setMasterView('registro')}
        className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${masterView === 'registro' ? 'bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-white/5 text-gray-500 hover:text-white hover:bg-white/10'}`}
      >
        <Archive className="w-4 h-4" />
        Registro de Emissões
      </button>
    </div>
  );

  let content = null;

  // Se for departamento, ou um Master na aba de Upload, vê a tela de envo
  if (isMasterOrSup && masterView === 'registro') {
    content = <RegistroEmissoes />;
  }
  else if (profile.role === 'departamento' || (isMasterOrSup && masterView === 'upload')) {
    content = <VisaoEmissor profile={profile} />;
  } 
  // Se for gerente, vê a tela de aprovações da sua carteira
  else if (profile.role === 'gerente') {
    content = <VisaoGerente profile={profile} />;
  } 
  // Master na visão Analytics
  else if (isMasterOrSup) {
    content = <VisaoMaster profile={profile} />;
  } 
  // Fallback de erro
  else {
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
      {masterToolbar}
      {content}
    </>
  );
}
