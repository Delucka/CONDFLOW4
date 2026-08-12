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

  // Mapas de origem no build de produção.
  //
  // O erro da Central de Emissões chega como `Cannot access 'tP' before
  // initialization` — `tP` é nome inventado pelo minificador, então o rastro não
  // aponta arquivo nem linha, e sem isso o diagnóstico vira adivinhação. Com o
  // mapa, o mesmo erro passa a nomear o arquivo e a linha reais.
  //
  // Custo: o build publica os `.map`, então o código-fonte fica legível por quem
  // abrir o DevTools. Não é vazamento de segredo — o JS já vai inteiro para o
  // navegador, só ilegível —, mas também não é para ficar ligado para sempre.
  // DESLIGUE assim que o erro estiver identificado.
  productionBrowserSourceMaps: true,

  // `experimental.optimizePackageImports: ['lucide-react']` foi REMOVIDO aqui.
  //
  // A Central de Emissões quebrava em produção com
  //   ReferenceError: Cannot access 'tP' before initialization
  // lançado durante o render, dentro de um chunk minificado — não de nenhum
  // arquivo nosso. Descartados por verificação, e não por suposição:
  //   • nenhum commit recente toca o caminho que quebra (VisaoMaster/VisaoEmissor
  //     não são alterados há semanas; o resto foi só troca de className);
  //   • ESLint com `no-use-before-define` não acha temporal dead zone em src/;
  //   • o grafo de módulos não tem nenhuma importação circular.
  //
  // Sobra o único transform não-padrão do build. Esta opção é `experimental` e
  // reescreve `import { A, B } from 'lucide-react'` em imports por ícone; quando
  // o mesmo módulo é importado mais de uma vez no arquivo, a reescrita pode gerar
  // ligações que se referenciam antes de inicializar — exatamente este erro. Os
  // quatro arquivos que tinham import duplicado de lucide-react eram os de
  // /aprovacoes e /central-emissoes: as telas que quebraram. Os duplicados também
  // foram unificados, então a hipótese está atacada dos dois lados.
  //
  // Custo de remover: bundle um pouco maior. Custo de manter: tela fora do ar.
  // Se algum dia voltar, volte junto com uma verificação em produção.
};

export default nextConfig;
