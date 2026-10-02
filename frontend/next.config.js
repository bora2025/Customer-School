/** @type {import('next').NextConfig} */
// build: 2026-05-08
const nextConfig = {
  // Standalone output for Docker deployment
  output: 'standalone',
  // Keep standalone traces rooted in the selected source tree. For the physical core build this
  // is the isolated `.core-build` workspace, preventing the runner layout from being nested under
  // an inferred parent workspace because both source trees have lockfiles.
  outputFileTracingRoot: __dirname,

  // Enable gzip/brotli compression
  compress: true,

  // Reduce dev-mode RAM by not opening browser & limiting source maps
  reactStrictMode: true,

  // Tree-shake large libraries to import only what's used
  experimental: {
    optimizePackageImports: ['recharts', '@zxing/library', 'jspdf'],
  },

  // Disable image optimization (no external images used, saves ~50MB RAM in dev)
  images: {
    unoptimized: true,
  },

  // Allow @imgly/background-removal (WASM/ONNX) to build correctly
  webpack(config, { dev }) {
    // The library ships WASM files — don't parse them as JS
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    if (!dev) {
      // onnxruntime-web ships pre-minified ESM chunks (ort.node.min.mjs,
      // ort.webgpu.bundle.min.mjs …) that use top-level import/export and
      // import.meta.  Next.js's SWC minifier runs without module:true and
      // therefore fails to parse them.  Since these files are already minified,
      // we flag them as "minimized" before the TerserPlugin runs (stage 400) so
      // it skips them entirely.
      config.plugins.push({
        apply(compiler) {
          compiler.hooks.compilation.tap('SkipOrtMjsMinify', (compilation) => {
            compilation.hooks.processAssets.tap(
              { name: 'SkipOrtMjsMinify', stage: 399 },
              (assets) => {
                for (const name of Object.keys(assets)) {
                  if (/ort\..+\.mjs$/.test(name)) {
                    compilation.updateAsset(
                      name,
                      (src) => src,
                      { minimized: true }
                    );
                  }
                }
              }
            );
          });
        },
      });
    }

    return config;
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
        ],
      },
      {
        // The LaTeX editor is a public, session-less tool meant to be embedded
        // in third-party LMS quiz editors (e.g. Moodle) via <iframe>. CSP's
        // frame-ancestors takes precedence over X-Frame-Options in every
        // modern browser, so this narrowly re-allows framing for this one
        // route without weakening the site-wide X-Frame-Options: DENY above.
        source: '/tools/latex-editor',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
    ];
  },
}

module.exports = nextConfig
