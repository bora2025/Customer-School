const path = require('node:path');

module.exports = (options) => ({
  ...options,
  entry: ['./src/main-core.ts'],
  resolve: {
    ...options.resolve,
    alias: {
      ...(options.resolve?.alias || {}),
      // Type-check the reachable core graph against the compatible legacy client surface, but
      // bundle the reduced client generated from prisma/core/schema.prisma. The Docker builder is
      // isolated, so a core build can never overwrite the developer's legacy @prisma/client.
      '@prisma/client$': path.resolve(__dirname, 'generated/core-client'),
    },
  },
  output: {
    ...options.output,
    path: path.resolve(__dirname, 'dist-core'),
    filename: 'main.js',
  },
});
