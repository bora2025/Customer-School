import express from 'express';
import request from 'supertest';
import { originGuard } from './origin-guard';

function app() {
  const server = express();
  server.use(originGuard(['https://school.example']));
  server.use(express.urlencoded({ extended: true }));
  server.post('/auth/users', (_req, res) => res.status(201).json({ created: true }));
  server.get('/auth/me', (_req, res) => res.json({ ok: true }));
  return server;
}

describe('CSRF origin guard', () => {
  it('refuses a cross-site form post from another website (the CSRF attack)', async () => {
    const response = await request(app()).post('/auth/users').set('Origin', 'https://evil.example').set('Sec-Fetch-Site', 'cross-site').type('form').send('email=attacker@evil.example&role=SUPER_ADMIN');
    expect(response.status).toBe(403);
  });

  it('refuses a cross-site request even when the browser omits Origin', async () => {
    expect((await request(app()).post('/auth/users').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
  });

  it('refuses an opaque origin (sandboxed iframe, data: URL)', async () => {
    expect((await request(app()).post('/auth/users').set('Origin', 'null')).status).toBe(403);
  });

  it('allows the school web app on its own origin', async () => {
    const response = await request(app()).post('/auth/users').set('Origin', 'https://school.example').set('Sec-Fetch-Site', 'same-origin');
    expect(response.status).toBe(201);
  });

  it('allows non-browser clients (mobile app, server-to-server) that send neither header', async () => {
    expect((await request(app()).post('/auth/users')).status).toBe(201);
  });

  it('never blocks safe methods', async () => {
    expect((await request(app()).get('/auth/me').set('Origin', 'https://evil.example').set('Sec-Fetch-Site', 'cross-site')).status).toBe(200);
  });
});
