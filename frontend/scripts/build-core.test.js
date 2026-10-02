const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { routeAllowed, routeForDirectory } = require('./build-core');

const frontendRoot = path.resolve(__dirname, '..');

test('maps app directories to public routes', () => {
  assert.equal(routeForDirectory(''), '/');
  assert.equal(routeForDirectory(path.join('admin', 'plugins')), '/admin/plugins');
  assert.equal(routeForDirectory(path.join('(shell)', 'admin')), '/admin');
});

test('allows only core and dynamic plugin route entries', () => {
  assert.equal(routeAllowed('/admin/plugins'), true);
  assert.equal(routeAllowed('/marketplace'), false);
  assert.equal(routeAllowed('/marketplace/link/[requestId]'), false);
  assert.equal(routeAllowed('/marketplace/publisher'), false);
  assert.equal(routeAllowed('/marketplace/reviewer/submissions/[submissionId]'), false);
  assert.equal(routeAllowed('/api/marketplace/[...path]'), false);
  assert.equal(routeAllowed('/api/[...path]'), true);
  assert.equal(routeAllowed('/plugins/[pluginId]/[[...path]]'), true);
  assert.equal(routeAllowed('/plugins/wattanam.timetable/classes'), false);
  assert.equal(routeAllowed('/admin/attendance'), false);
  assert.equal(routeAllowed('/student/courses'), false);
});

test('core Docker builds materialize dependencies for a portable standalone trace', () => {
  const source = fs.readFileSync(path.join(frontendRoot, 'scripts', 'build-core.js'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(frontendRoot, 'Dockerfile.core'), 'utf8');
  assert.match(source, /CORE_BUILD_NODE_MODULES_MODE !== 'copy'/);
  assert.match(source, /materializeStandaloneDependencies/);
  assert.match(source, /fs\.cpSync\(path\.join\(frontendRoot, 'node_modules'\), standaloneModules/);
  assert.match(dockerfile, /CORE_BUILD_NODE_MODULES_MODE=copy/);
});
