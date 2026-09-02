/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
    NEXT_PUBLIC_APP_NAME: 'Ventrix',
  },
  images: {
    domains: ['localhost', 's3.amazonaws.com'],
  },
};

module.exports = nextConfig;
