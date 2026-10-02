// Used only by Jest's test transform, only for the specific ESM-only node_modules
// packages listed in package.json's `jest.transformIgnorePatterns` (currently
// @nestjs/jwt@12, which ships no CommonJS build at all). This project has no local
// .js source files and does not use Babel for anything else — production builds go
// through `nest build` (SWC), and this file exists purely so Jest's CommonJS module
// loader can parse the handful of ESM node_modules files it would otherwise choke on
// with "Cannot use import statement outside a module". See the A-009 upgrade notes.
module.exports = {
  plugins: ['@babel/plugin-transform-modules-commonjs'],
};
