/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: '/api/index.py', // No Vercel, o arquivo index.py dentro de api/ responderá por este caminho
      },
    ]
  },
};

export default nextConfig;
