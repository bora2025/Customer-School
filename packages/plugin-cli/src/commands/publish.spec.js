'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { publish } = require('./publish');

describe('wattanam-plugin publish', () => {
  let file;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-publish-')), 'x.wtp');
    fs.writeFileSync(file, Buffer.from('fake-package-bytes'));
  });
  afterEach(() => { fs.rmSync(path.dirname(file), { recursive: true, force: true }); jest.restoreAllMocks(); });

  it('POSTs a multipart request with the bearer token and expected fields', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'plugin-version-1' }) });
    global.fetch = fetchMock;

    const result = await publish({ packageFile: file, repositoryUrl: 'https://marketplace.example', adminToken: 'secret-token', channel: 'BETA', changelog: 'notes', paid: false });

    expect(result).toEqual({ id: 'plugin-version-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe('https://marketplace.example/admin/v1/plugin-releases');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer secret-token');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('throws with the server-reported message on a non-2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'The package publisher is not verified' }) });
    await expect(publish({ packageFile: file, repositoryUrl: 'https://marketplace.example', adminToken: 'x', channel: 'STABLE' }))
      .rejects.toThrow('The package publisher is not verified');
  });
});
