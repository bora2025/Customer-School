import express from 'express';
import request from 'supertest';
import { readRuntimeConfig } from '../config/environment';
import { clientIp } from './client-ip';

function appWithHops(hops: number) {
  const app = express();
  app.set('trust proxy', hops);
  app.get('/ip', (req, res) => res.json({ ip: clientIp(req) }));
  return app;
}

describe('client address behind trusted proxies', () => {
  it('gateway only (1 hop): ignores client-supplied X-Forwarded-For entries', async () => {
    // Gateway appends the real peer address after whatever the client sent.
    const response = await request(appWithHops(1)).get('/ip').set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');
    expect(response.body.ip).toBe('203.0.113.7');
  });

  it('Railway edge + gateway (2 hops): takes the address the edge appended', async () => {
    const response = await request(appWithHops(2))
      .get('/ip')
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7, 100.64.0.9');
    expect(response.body.ip).toBe('203.0.113.7');
  });

  it('distinct clients get distinct addresses, so rate limits are per client', async () => {
    const app = appWithHops(2);
    const first = await request(app).get('/ip').set('X-Forwarded-For', '198.51.100.1, 100.64.0.9');
    const second = await request(app).get('/ip').set('X-Forwarded-For', '198.51.100.2, 100.64.0.11');
    expect(first.body.ip).not.toBe(second.body.ip);
  });
});

describe('TRUST_PROXY_HOPS configuration', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/test' };

  it('defaults to the single school gateway', () => {
    expect(readRuntimeConfig(base).trustProxyHops).toBe(1);
  });

  it('accepts the Railway topology', () => {
    expect(readRuntimeConfig({ ...base, TRUST_PROXY_HOPS: '2' }).trustProxyHops).toBe(2);
  });

  it.each(['-1', '6', '1.5', 'true'])('rejects %s', (value) => {
    expect(() => readRuntimeConfig({ ...base, TRUST_PROXY_HOPS: value })).toThrow('TRUST_PROXY_HOPS');
  });
});
