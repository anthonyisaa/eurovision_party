import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pull in source files from sibling workspace packages.
  transpilePackages: ['@eurojury/shared', '@eurojury/db'],
  experimental: {
    // Required for workspace package source imports under Next 15.
    externalDir: true,
  },
};

export default nextConfig;
