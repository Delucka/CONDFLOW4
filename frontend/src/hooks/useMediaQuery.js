'use client';
import { useState, useEffect } from 'react';

// Retorna true quando a media query casa. SSR-safe (começa false).
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    onChange();
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Atalho: true quando a tela é "desktop" (≥ lg / 1024px)
export function useIsDesktop() {
  return useMediaQuery('(min-width: 1024px)');
}

// Atalho: true quando a tela é um celular (< md / 768px) → usa a casca de app
export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)');
}
