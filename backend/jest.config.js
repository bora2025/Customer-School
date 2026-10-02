const path = require('path');

// Moved out of package.json (previously the "jest" key) so the babel-jest
// configFile option below can be an absolute, unambiguous path — babel-jest's
// own config resolution does not reliably discover a project babel.config.js
// that sits outside `rootDir` otherwise. See the A-009 upgrade notes for why
// this transform exists at all: @nestjs/jwt@12 and @nestjs/passport@12 ship
// ESM-only, which Node's native `require(esm)` handles fine at runtime but
// Jest's CJS-only module loader cannot parse without this.
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['babel-jest', { configFile: path.resolve(__dirname, 'babel.config.js') }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@nestjs/jwt|@nestjs/passport)/)'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
