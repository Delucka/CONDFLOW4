'use client';
import { useEffect, useState } from 'react';

// Captura o evento de instalação do Chrome (beforeinstallprompt) LOGO no carregamento
// e guarda num singleton — senão o evento "passa" antes do botão (no "Mais") montar.
let deferred = null;
let inited = false;
const subs = new Set();
const notify = () => subs.forEach((f) => f());

export function initPwaCapture() {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export function usePwaInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    initPwaCapture();
    const f = () => force((n) => n + 1);
    subs.add(f);
    f(); // sincroniza caso o evento já tenha chegado
    return () => subs.delete(f);
  }, []);

  async function install() {
    if (!deferred) return 'unavailable';
    deferred.prompt();
    let outcome = 'dismissed';
    try { const choice = await deferred.userChoice; outcome = choice?.outcome || 'dismissed'; } catch {}
    deferred = null;
    notify();
    return outcome; // 'accepted' | 'dismissed'
  }

  return { canInstall: !!deferred, install };
}
