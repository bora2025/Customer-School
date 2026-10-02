'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const playwrightBin = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
let server;
let stopped = false;

function parsePlaywrightResult(output) {
  const matches = [...output.matchAll(/WATTANAM_PLAYWRIGHT_RESULT=(passed|failed|timedout|interrupted)/g)];
  return matches.at(-1)?.[1] || null;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
  else { try { process.kill(-pid, 'SIGTERM'); } catch { /* already stopped */ } }
}
function stopServer() {
  if (stopped) return;
  stopped = true;
  killTree(server?.pid);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const address = probe.address(); probe.close(() => resolve(String(address.port))); });
  });
}
async function waitUntilReady(port) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next test server exited with code ${server.exitCode}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/login`); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the plugin UI test server');
}

async function main() {
  let code = 1;
  try {
    const port = await freePort();
    const environment = { ...process.env, PLAYWRIGHT_WEB_PORT: port };
    // Do not let a framework worker inherit the caller's output handles: on Windows an orphaned
    // descendant can otherwise keep CI's PTY open after both Playwright and the HTTP listener exit.
    server = spawn(process.execPath, [nextBin, 'start', '--port', port], { cwd: root, env: environment, stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
    await waitUntilReady(port);
    const args = ['test', '--config', 'playwright.plugin-ui.config.ts', ...process.argv.slice(2)];
    const test = spawn(process.execPath, [playwrightBin, ...args], { cwd: root, env: { ...environment, PLAYWRIGHT_EXTERNAL_SERVER: 'true' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    code = await new Promise((resolve, reject) => {
      let output = '', settled = false;
      const forward = (stream, target) => stream.on('data', (chunk) => {
        target.write(chunk); output = `${output}${chunk}`.slice(-8192);
        const plain = output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
        const result = parsePlaywrightResult(plain);
        if (result && !settled) {
          settled = true;
          setTimeout(() => { killTree(test.pid); resolve(result === 'passed' ? 0 : 1); }, 250);
        }
      });
      forward(test.stdout, process.stdout); forward(test.stderr, process.stderr);
      test.once('error', (error) => { if (!settled) { settled = true; reject(error); } });
      test.once('exit', (value) => { if (!settled) { settled = true; resolve(value ?? 1); } });
    });
  } finally { stopServer(); }
  // Playwright/browser descendants can retain inherited Windows pipe handles even after their
  // process tree is terminated. The final result is already known here, so exit deterministically.
  process.exit(code);
}

if (require.main === module) {
  process.on('SIGINT', () => { stopServer(); process.exit(130); });
  process.on('SIGTERM', () => { stopServer(); process.exit(143); });
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; stopServer(); });
}

module.exports = { parsePlaywrightResult };
