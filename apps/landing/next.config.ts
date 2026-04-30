import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@shipfox/react-ui'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
