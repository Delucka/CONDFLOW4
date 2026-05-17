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
  typescript: { ignoreBuildErrors: true },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
