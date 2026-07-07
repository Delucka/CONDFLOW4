/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/api/:path*',
          destination: 'http://127.0.0.1:8001/api/:path*'
        }
      ];
    }
    return [];
  },
  // ───────── Segurança: cabeçalhos de blindagem ─────────
  // Os "duros" (HSTS, anti-clickjacking, nosniff, etc.) entram ENFORCE — não quebram nada.
  // A CSP entra em Report-Only (monitor): não bloqueia, só reporta, pra confirmarmos que
  // OCR (jsdelivr/tesseract), Supabase e uploads seguem 100% antes de virar bloqueio.
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';

    // Fontes permitidas (o que o app realmente usa)
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      // scripts do próprio site + inline (tema/Next) + WASM (pdf.js/tesseract) + CDN do OCR
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.emissaonline.com https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
      "frame-src 'self' blob: https://*.supabase.co https://api.emissaonline.com",
      "media-src 'self' blob: data:",
      "manifest-src 'self'",
      'upgrade-insecure-requests',
    ].join('; ');

    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()' },
    ];

    if (isProd) {
      securityHeaders.push(
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Content-Security-Policy-Report-Only', value: csp },
      );
    }

    return [{ source: '/:path*', headers: securityHeaders }];
  },

  // Endereço oficial = emissaonline.com. Quem abrir o domínio antigo do Vercel
  // é levado ao novo mantendo o caminho (favoritos e links antigos não quebram).
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'condominios-gamma.vercel.app' }],
        destination: 'https://emissaonline.com/:path*',
        permanent: true,
      },
    ];
  },
  typescript: { ignoreBuildErrors: true },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
