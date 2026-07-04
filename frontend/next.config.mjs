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
