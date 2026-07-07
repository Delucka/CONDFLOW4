'use client';
import { useEffect, useState } from 'react';
import { Download, Share, Plus, X, MoreVertical } from 'lucide-react';
import { usePwaInstall } from '@/lib/pwaInstall';

// Botão "Instalar app" (PWA), funciona pros DOIS sistemas:
// • Android/Chrome: dispara o instalador nativo em 1 toque (evento já capturado no carregamento).
// • iPhone/Safari: mostra o passo a passo (a Apple não permite instalação automática).
export default function InstallAppButton() {
  const { canInstall, install } = usePwaInstall();
  const [isIOS, setIsIOS] = useState(false);
  const [standalone, setStandalone] = useState(true); // assume instalado até checar (evita piscar)
  const [sheet, setSheet] = useState(null); // 'ios' | 'android' | null

  useEffect(() => {
    const nav = window.navigator;
    setIsIOS(/iphone|ipad|ipod/i.test(nav.userAgent || ''));
    setStandalone(window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true);
    const onInstalled = () => setStandalone(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  if (standalone) return null; // já instalado

  async function handleClick() {
    if (canInstall) {
      const outcome = await install();
      if (outcome === 'unavailable') setSheet(isIOS ? 'ios' : 'android');
      return;
    }
    // Sem instalador nativo disponível → passo a passo do sistema
    setSheet(isIOS ? 'ios' : 'android');
  }

  return (
    <>
      <button type="button" onClick={handleClick}
        className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-black text-white bg-violet-600 active:opacity-80 transition-opacity">
        <Download className="w-5 h-5 shrink-0" aria-hidden="true" />
        Instalar app no celular
      </button>

      {sheet && (
        <div className="fixed inset-0 z-[95] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Como instalar">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={() => setSheet(null)} />
          <div className="relative bg-white rounded-t-3xl px-5 pt-3 animate-slide-up" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
            <div className="mx-auto w-10 h-1.5 rounded-full bg-slate-300 mb-4" aria-hidden="true" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-black text-slate-900">{sheet === 'ios' ? 'Instalar no iPhone' : 'Instalar no Android'}</h3>
              <button onClick={() => setSheet(null)} aria-label="Fechar" className="tap rounded-full w-9 h-9 flex items-center justify-center text-slate-500 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            {sheet === 'ios' ? (
              <ol className="space-y-3">
                <li className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-black text-sm shrink-0">1</span>
                  <span className="text-sm text-slate-700 font-medium flex items-center gap-1.5 flex-wrap">Toque no <Share className="w-4 h-4 text-violet-600 inline" aria-label="Compartilhar" /> <strong>Compartilhar</strong> (embaixo, no Safari)</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-black text-sm shrink-0">2</span>
                  <span className="text-sm text-slate-700 font-medium flex items-center gap-1.5 flex-wrap">Escolha <Plus className="w-4 h-4 text-violet-600 inline" aria-hidden="true" /> <strong>Adicionar à Tela de Início</strong></span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-black text-sm shrink-0">3</span>
                  <span className="text-sm text-slate-700 font-medium">Toque em <strong>Adicionar</strong> — o pinguim aparece na tela inicial. 🐧</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3">
                <li className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-black text-sm shrink-0">1</span>
                  <span className="text-sm text-slate-700 font-medium flex items-center gap-1.5 flex-wrap">Abra o menu <MoreVertical className="w-4 h-4 text-violet-600 inline" aria-label="menu" /> do navegador (canto superior)</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-black text-sm shrink-0">2</span>
                  <span className="text-sm text-slate-700 font-medium"><strong>Instalar aplicativo</strong> (ou "Adicionar à tela inicial")</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-black text-sm shrink-0">3</span>
                  <span className="text-sm text-slate-700 font-medium">Confirme <strong>Instalar</strong> — pronto. 🐧</span>
                </li>
              </ol>
            )}
          </div>
        </div>
      )}
    </>
  );
}
