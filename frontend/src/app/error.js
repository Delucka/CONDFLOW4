'use client';
import { useEffect } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('ERRO FATAL NO SISTEMA:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mb-6 border border-rose-500/20 ">
        <AlertCircle className="w-10 h-10 text-rose-500" />
      </div>
      
      <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">Ops! Algo deu errado.</h1>
      <p className="text-slate-400 max-w-md mb-8 font-medium">
        Detectamos uma falha crítica na interface. Nossos engenheiros foram notificados. 
        Tente reiniciar a visualização ou atualizar a página.
      </p>

      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={() => reset()}
          className="flex items-center gap-2 px-6 py-3 bg-violet-500 text-slate-950 rounded-xl font-bold hover:bg-violet-400 transition-all shadow-lg shadow-violet-500/20"
        >
          <RotateCcw className="w-4 h-4" /> REINICIAR COMPONENTE
        </button>
        <button
          onClick={() => window.location.href = '/dashboard'}
          className="px-6 py-3 bg-slate-100 text-slate-900 rounded-xl font-bold hover:bg-slate-700 transition-all border border-slate-700"
        >
          VOLTAR AO INÍCIO
        </button>
      </div>
    </div>
  );
}
