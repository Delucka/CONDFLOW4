/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.NODE_ENV === 'development' 
          ? 'http://127.0.0.1:8001/api/:path*' 
          : '/api/:path*'
      }
    ];
  }
};

export default nextConfig;
