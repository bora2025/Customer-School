#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const coreRoutes = require('../core-routes.json');

const frontendRoot = path.resolve(__dirname, '..');
const workspace = path.join(frontendRoot, '.core-build');
const allowedExact = new Set(coreRoutes.exact);
const allowedPrefixes = coreRoutes.prefixes;
const allowedArtifactDynamic = new Set(coreRoutes.artifactDynamicRoutes || []);

function assertWorkspaceSafety() {
  const relative = path.relative(frontendRoot, workspace);
  if (relative !== '.core-build' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe core build workspace: ${workspace}`);
  }
}

function routeForDirectory(relativeDirectory) {
  const segments = relativeDirectory
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
  return segments.length ? `/${segments.join('/')}` : '/';
}

function routeAllowed(route) {
  // Marketplace account authentication/commerce belongs to the separately deployed control-plane
  // web app. The school core talks to Marketplace only through its authenticated backend connector.
  if (route.startsWith('/api/marketplace')) return false;
  if (route.startsWith('/plugins/')) return allowedArtifactDynamic.has(route);
  return allowedExact.has(route) || allowedPrefixes.some((prefix) => route.startsWith(prefix));
}

function copyTree(source, destination, appRelative = null) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const nextAppRelative = appRelative === null ? null : path.join(appRelative, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to, nextAppRelative);
      continue;
    }
    if (!entry.isFile()) continue;
    if (appRelative !== null && /^(page|route)\.(tsx?|jsx?)$/.test(entry.name)) {
      const route = routeForDirectory(appRelative);
      if (!routeAllowed(route)) continue;
    }
    fs.copyFileSync(from, to);
  }
}

function prepareWorkspace() {
  assertWorkspaceSafety();
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });

  for (const file of [
    'package.json', 'package-lock.json', 'next-env.d.ts', 'next.config.js', 'postcss.config.js',
    'proxy.ts', 'server.js', 'tailwind.config.js', 'tsconfig.json', 'core-routes.json',
  ]) {
    fs.copyFileSync(path.join(frontendRoot, file), path.join(workspace, file));
  }
  copyTree(path.join(frontendRoot, 'app'), path.join(workspace, 'app'), '');
  for (const directory of ['components', 'lib', 'public']) {
    copyTree(path.join(frontendRoot, directory), path.join(workspace, directory));
  }
  fs.symlinkSync(path.join(frontendRoot, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
}

function materializeStandaloneDependencies() {
  if (process.env.CORE_BUILD_NODE_MODULES_MODE !== 'copy') return;
  const standaloneModules = path.join(workspace, '.next', 'standalone', 'node_modules');
  fs.rmSync(standaloneModules, { recursive: true, force: true });
  // The isolated workspace deliberately uses a fast dependency junction while Next compiles.
  // Its standalone tracer preserves that junction, which points outside a runner image. Replace
  // it only after a successful build with a real dependency tree so the image is portable.
  fs.cpSync(path.join(frontendRoot, 'node_modules'), standaloneModules, {
    recursive: true,
    dereference: true,
  });
}

function build() {
  prepareWorkspace();
  const nextBin = path.join(frontendRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  const result = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
    cwd: workspace,
    env: {
      ...process.env,
      NEXT_PUBLIC_WATTANAM_DISTRIBUTION: 'core',
      WATTANAM_DISTRIBUTION: 'core',
    },
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  materializeStandaloneDependencies();
}

if (require.main === module) build();

module.exports = { assertWorkspaceSafety, materializeStandaloneDependencies, prepareWorkspace, routeAllowed, routeForDirectory };
