import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Hostinger Node.js Web App target (see docs/DEPLOYMENT.md).
 * No Vercel-only features: no edge runtime, no @vercel/* packages.
 * The server is started with `next start -p $PORT`.
 */
const remotePatterns: NonNullable<NextConfig['images']>['remotePatterns'] = [];

if (process.env.S3_PUBLIC_BASE_URL) {
  try {
    const url = new URL(process.env.S3_PUBLIC_BASE_URL);
    remotePatterns.push({
      protocol: url.protocol.replace(':', '') as 'http' | 'https',
      hostname: url.hostname,
    });
  } catch {
    // Malformed value is reported by the env schema at boot; ignore here so the
    // config module itself never throws during `next build`.
  }
}

if (process.env.BUNNY_STREAM_CDN_HOSTNAME) {
  remotePatterns.push({ protocol: 'https', hostname: process.env.BUNNY_STREAM_CDN_HOSTNAME });
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  // There is an unrelated package-lock.json in a parent directory on some dev
  // machines, which makes Next infer the wrong workspace root and trace files
  // from outside the project. Pin it: the standalone output must contain this
  // app and nothing above it.
  outputFileTracingRoot: process.cwd(),

  // transformers.js loads ONNX Runtime through native bindings and resolves the
  // model cache at runtime. Bundling it breaks both, so it stays external and is
  // required from node_modules by the server at request time.
  serverExternalPackages: ['@huggingface/transformers'],

  // `sharp` is an explicit dependency: image optimization on self-hosted Node.
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns,
    deviceSizes: [360, 480, 768, 1024, 1280, 1536, 1920],
  },

  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns', 'recharts'],
  },

  // Keep the build honest: these must never be disabled.
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // The receipt capture flow needs the device camera (§9.2 step 2).
        source: '/:locale/espace/:path*',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }],
      },
      {
        // Certificate verification is meant to be embeddable by employers (§12.5).
        source: '/:locale/certificat/:code',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
