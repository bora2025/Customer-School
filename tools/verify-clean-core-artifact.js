#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const coreRouteContract = require('../frontend/core-routes.json');
const CORE_EXACT_ROUTES = new Set(coreRouteContract.exact);
const CORE_ROUTE_PREFIXES = coreRouteContract.prefixes;
const CORE_ARTIFACT_DYNAMIC_ROUTES = new Set(coreRouteContract.artifactDynamicRoutes || []);

function parseArguments(argv) {
  const result = {
    backendDir: path.join(ROOT, 'backend', 'dist'),
    frontendManifest: path.join(ROOT, 'frontend', '.next', 'server', 'app-paths-manifest.json'),
    registry: path.join(ROOT, 'backend', 'src', 'distribution', 'module-registry.ts'),
    backendSource: path.join(ROOT, 'backend', 'src'),
    report: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--report') result.report = true;
    else if (argument === '--backend-dir') result.backendDir = path.resolve(argv[++index]);
    else if (argument === '--frontend-manifest') result.frontendManifest = path.resolve(argv[++index]);
    else if (argument === '--registry') result.registry = path.resolve(argv[++index]);
    else if (argument === '--backend-source') result.backendSource = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function optionalBackendDirectories(registrySource) {
  const entries = [];
  const pattern = /\{\s*module:\s*'([^']+)'\s*,\s*importPath:\s*'([^']+)'\s*,\s*classification:\s*'([^']+)'/g;
  let match;
  while ((match = pattern.exec(registrySource)) !== null) {
    const [, moduleName, importPath, classification] = match;
    if (classification === 'business' || classification === 'proxy') {
      entries.push({ moduleName, directory: path.basename(path.dirname(importPath)), classification });
    }
  }
  if (entries.length === 0) throw new Error('No optional modules were parsed from the root module registry');
  return entries;
}

function javascriptFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(resolved));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(resolved);
  }
  return files;
}

function sourceFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(resolved));
    else if (entry.isFile() && /\.(?:ts|js)$/.test(entry.name) && !/\.spec\.(?:ts|js)$/.test(entry.name)) files.push(resolved);
  }
  return files;
}

function optionalRuntimeSymbols(sourceRoot, optionalModules) {
  const decorators = '(?:Injectable|Controller|WebSocketGateway|Processor|Resolver|Cron|Interval|Timeout)';
  const symbols = [];
  for (const entry of optionalModules) {
    const directory = path.join(sourceRoot, entry.directory);
    for (const file of sourceFiles(directory)) {
      const source = fs.readFileSync(file, 'utf8');
      const pattern = new RegExp(`@${decorators}(?:\\([^)]*\\))?[\\s\\S]{0,500}?\\b(?:export\\s+)?class\\s+([A-Za-z_$][\\w$]*)`, 'g');
      let match;
      while ((match = pattern.exec(source)) !== null) {
        symbols.push({ symbol: match[1], moduleName: entry.moduleName, directory: entry.directory, file });
      }
    }
  }
  return symbols.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file));
}

function manifestKeyToRoute(key) {
  let route = key.replace(/\/page$/, '').replace(/\/route$/, '');
  route = route.replace(/\/\([^/]+\)/g, '');
  return route || '/';
}

function isCoreRoute(route) {
  if (CORE_EXACT_ROUTES.has(route)) return true;
  if (route.startsWith('/plugins/')) return CORE_ARTIFACT_DYNAMIC_ROUTES.has(route);
  return CORE_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix));
}

function verifyCleanCoreArtifact(options) {
  const violations = [];
  const registrySource = fs.readFileSync(options.registry, 'utf8');
  const optionalModules = optionalBackendDirectories(registrySource);

  if (!fs.existsSync(options.backendDir)) {
    violations.push({ kind: 'missing-backend-artifact', path: options.backendDir });
  } else {
    const compiledJavascript = javascriptFiles(options.backendDir);
    const runtimeSymbols = optionalRuntimeSymbols(options.backendSource, optionalModules);
    for (const entry of optionalModules) {
      const compiledDirectory = path.join(options.backendDir, entry.directory);
      if (fs.existsSync(compiledDirectory)) {
        violations.push({
          kind: 'optional-backend-module',
          path: entry.directory,
          detail: `${entry.moduleName} (${entry.classification})`,
        });
        continue;
      }
      const bundledIn = compiledJavascript.find((file) => fs.readFileSync(file, 'utf8').includes(entry.moduleName));
      if (bundledIn) {
        violations.push({
          kind: 'optional-backend-module-bundled',
          path: path.relative(options.backendDir, bundledIn).replaceAll('\\', '/'),
          detail: `${entry.moduleName} (${entry.classification})`,
        });
      }
    }
    for (const entry of runtimeSymbols) {
      const bundledIn = compiledJavascript.find((file) => fs.readFileSync(file, 'utf8').includes(entry.symbol));
      if (bundledIn) {
        violations.push({
          kind: 'optional-runtime-symbol-bundled',
          path: path.relative(options.backendDir, bundledIn).replaceAll('\\', '/'),
          detail: `${entry.symbol} from ${entry.directory}`,
        });
      }
    }
  }

  if (!fs.existsSync(options.frontendManifest)) {
    violations.push({ kind: 'missing-frontend-artifact', path: options.frontendManifest });
  } else {
    const manifest = JSON.parse(fs.readFileSync(options.frontendManifest, 'utf8'));
    for (const key of Object.keys(manifest).sort()) {
      const route = manifestKeyToRoute(key);
      if (key === '/_not-found/page' || key === '/_global-error/page') continue;
      if (!isCoreRoute(route)) violations.push({ kind: 'optional-frontend-route', path: route, detail: key });
    }
  }

  return {
    schemaVersion: 1,
    status: violations.length === 0 ? 'pass' : 'fail',
    backendArtifact: options.backendDir,
    frontendArtifact: options.frontendManifest,
    violationCount: violations.length,
    violations,
  };
}

function formatReport(result) {
  const lines = [
    `Clean-core artifact gate: ${result.status.toUpperCase()}`,
    `Violations: ${result.violationCount}`,
  ];
  for (const violation of result.violations) {
    lines.push(`- ${violation.kind}: ${violation.path}${violation.detail ? ` — ${violation.detail}` : ''}`);
  }
  return lines.join('\n');
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = verifyCleanCoreArtifact(options);
  process.stdout.write(`${formatReport(result)}\n`);
  if (!options.report && result.status !== 'pass') process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  CORE_EXACT_ROUTES,
  CORE_ARTIFACT_DYNAMIC_ROUTES,
  CORE_ROUTE_PREFIXES,
  formatReport,
  javascriptFiles,
  manifestKeyToRoute,
  optionalBackendDirectories,
  optionalRuntimeSymbols,
  parseArguments,
  verifyCleanCoreArtifact,
};
