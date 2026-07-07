'use client';
import { useEffect } from 'react';
import { initPwaCapture } from '@/lib/pwaInstall';

// Registra o service worker (só em produção) e captura o evento de instalação
// do PWA cedo (sempre montado no layout, então não perde o beforeinstallprompt).
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    initPwaCapture(); // captura o beforeinstallprompt já no carregamento
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return null;
}
