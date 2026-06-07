'use client';
import Link from 'next/link';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="relative group">
        <div className="w-32 h-32 bg-violet-500/10 rounded-full flex items-center justify-center mb-8 border border-slate-200 shadow-2xl group-hover:shadow-violet-500/20 transition-all duration-700">
           <span className="text-6xl font-black text-slate-900 selection:bg-none">404</span>
        </div>
        <div className="absolute -top-4 -right-4 w-12 h-12 bg-violet-600/20 rounded-full blur-xl animate-pulse"></div>
      </div>
      
      <h1 className="text-4xl font-black text-slate-900 mb-4 tracking-tighter uppercase">Página Não Encontrada</h1>
      <p className="text-slate-400 max-w-md mb-10 font-medium">
        O documento ou recurso que você está procurando não existe ou foi movido para uma nova categoria.
      </p>

      <Link 
        href="/dashboard"
        className="flex items-center gap-2 px-8 py-4 bg-violet-500 text-slate-950 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-violet-400 transition-all shadow-xl shadow-violet-500/20 active:scale-95"
      >
        <Home className="w-5 h-5" /> Retornar ao Painel
      </Link>
    </div>
  );
}
