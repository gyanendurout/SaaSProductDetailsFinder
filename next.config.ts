import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // The ingest imports node-only modules. They never reach a client bundle, but
  // marking them external stops the server build tracing into them.
  serverExternalPackages: ['pg', 'playwright'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'cdn.shopify.com' }],
  },
  webpack: (webpackConfig) => {
    // The ingest is written for Node ESM, where a relative import must carry the
    // '.js' extension even though the file on disk is '.ts'. tsx resolves that
    // natively; webpack needs to be told. This keeps one import convention
    // across the CLI and the app instead of two.
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    }
    return webpackConfig
  },
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
  },
}

export default config
