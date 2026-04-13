'use client';
import { X, ExternalLink, FileText, Loader2, Download, CheckCircle2 } from 'lucide-react';

export default function FilePreviewDrawer({ isOpen, onClose, file }) {
  if (!isOpen) return null;

  const isImage = file?.format?.match(/(jpg|jpeg|png|webp|gif)/i);
  const isPdf = file?.format?.match(/pdf/i);

  return (
    <div className="fixed inset-0 z-[500] flex justify-end animate-fade-in">
      {/* Overlay */}
      <div 
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="relative w-full max-w-2xl bg-[#030712] border-l border-white/10 shadow-[-20px_0_50px_rgba(0,0,0,0.5)] h-full flex flex-col animate-slide-right overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-violet-500/10 rounded-xl flex items-center justify-center border border-violet-500/20">
              <FileText className="w-5 h-5 text-violet-400" />
            </div>
            <div className="max-w-[300px] sm:max-w-md">
              <h3 className="text-sm font-black text-white truncate uppercase tracking-tight">{file?.name || 'Arquivo'}</h3>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-0.5">Visualização Integrada</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <a 
              href={file?.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-cyan-400 rounded-xl transition-all"
              title="Abrir em Nova Aba"
            >
              <ExternalLink className="w-5 h-5" />
            </a>
            <button 
              onClick={onClose}
              className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-black/40 relative overflow-hidden">
          {!file?.url ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-10">
              <Loader2 className="w-10 h-10 text-violet-500 animate-spin mb-4" />
              <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">Carregando documento...</p>
            </div>
          ) : isPdf ? (
            <iframe 
              src={`${file.url}#toolbar=0`} 
              className="w-full h-full border-none"
              title="Visualizador de PDF"
            />
          ) : isImage ? (
            <div className="w-full h-full flex items-center justify-center p-6 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:20px_20px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={file.url} 
                className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain border border-white/10" 
                alt="Documento"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-10 space-y-6">
               <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center border border-amber-500/20">
                  <Download className="w-10 h-10 text-amber-500" />
               </div>
               <div>
                  <h4 className="text-white font-black text-lg uppercase tracking-tight">Formato não suportado para visualização</h4>
                  <p className="text-slate-500 text-sm mt-2">Arquivos Excel, Word ou ZIP devem ser baixados.</p>
               </div>
               <a 
                 href={file.url} 
                 download 
                 className="px-8 py-4 bg-amber-500 text-slate-950 font-black rounded-2xl uppercase tracking-widest text-xs hover:bg-amber-400 transition-all shadow-xl shadow-amber-500/20 active:scale-95"
               >
                 Baixar Arquivo Agora
               </a>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {(file?.onApprove || file?.onReject) && (
          <div className="p-6 border-t border-white/10 bg-black/60 backdrop-blur-md flex items-center gap-4">
            <button 
              onClick={() => file?.onReject?.()}
              className="flex-1 py-4 bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-500/30 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95"
            >
              Solicitar Correção
            </button>
            <button 
              onClick={() => file?.onApprove?.()}
              className="flex-2 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-xl shadow-emerald-600/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {file?.approveLabel || 'Confirmar Aprovação'}
            </button>
          </div>
        )}

        {/* Bottom Banner */}
        <div className="p-3 border-t border-white/5 bg-white/[0.01] text-center">
           <p className="text-[9px] text-gray-400/50 font-black uppercase tracking-[0.3em]">CondoFlow • Visualizador Seguro de Emissões</p>
        </div>
      </div>
    </div>
  );
}


