// Manifest do PWA (Next App Router gera /manifest.webmanifest e injeta o <link>).
export default function manifest() {
  return {
    name: 'CondoFlow — Gestão de Condomínios',
    short_name: 'CondoFlow',
    description: 'Arrecadações, cobranças, emissões e aprovações de condomínios.',
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'pt-BR',
    dir: 'ltr',
    background_color: '#eef3fb',
    theme_color: '#1e3a8a',
    categories: ['business', 'productivity', 'finance'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
