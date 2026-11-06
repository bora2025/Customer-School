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
  if (!portableDependencies()) {
    fs.symlinkSync(path.join(frontendRoot, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
  }
}

// Portable mode (Docker images and CI) gives Next a real node_modules inside the workspace, so its
// file tracer follows imports and the standalone output contains only the packages the core
// server needs. Legacy-only dependencies are therefore absent from the core image. The tree is
// moved when the filesystem allows it (instant) and always moved back after the build. Docker's
// overlay filesystem refuses to rename a directory created by an earlier image layer (EXDEV), so
// there the tree is copied into the workspace and the copy is deleted after the build.
// Local developer builds keep the fast junction; their standalone output is not portable.
function portableDependencies() {
  return process.env.CORE_BUILD_NODE_MODULES_MODE === 'copy';
}

function withWorkspaceDependencies(run) {
  if (!portableDependencies()) return run(path.join(frontendRoot, 'node_modules'));
  const source = path.join(frontendRoot, 'node_modules');
  const target = path.join(workspace, 'node_modules');
  let moved = true;
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    moved = false;
    fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  }
  try {
    return run(target);
  } finally {
    if (moved) fs.renameSync(target, source);
    else fs.rmSync(target, { recursive: true, force: true });
  }
}

function assertPortableStandalone() {
  if (!portableDependencies()) return;
  const standaloneModules = path.join(workspace, '.next', 'standalone', 'node_modules');
  const stat = fs.lstatSync(standaloneModules);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Core standalone node_modules must be a real traced directory in portable mode');
  }
  if (!fs.existsSync(path.join(standaloneModules, 'next', 'package.json'))) {
    throw new Error('Core standalone output is missing the traced next runtime');
  }
}

function build() {
  prepareWorkspace();
  const status = withWorkspaceDependencies((modules) => {
    const nextBin = path.join(modules, 'next', 'dist', 'bin', 'next');
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
    return result.status;
  });
  if (status !== 0) process.exit(status || 1);
  assertPortableStandalone();
}

if (require.main === module) build();

module.exports = { assertPortableStandalone, assertWorkspaceSafety, prepareWorkspace, routeAllowed, routeForDirectory };
