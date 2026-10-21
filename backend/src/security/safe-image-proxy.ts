import { lookup } from 'node:dns/promises';
import { get as httpGet, RequestOptions } from 'node:http';
import { get as httpsGet } from 'node:https';
import { BlockList, isIP } from 'node:net';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
const blocked = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
] as const) blocked.addSubnet(network, prefix, 'ipv6');

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) {
    return isPublicImageAddress(address.slice(7));
  }
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

async function resolvePublic(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicImageAddress(entry.address))) {
    throw new Error('Image host resolves to a private, reserved, or unavailable address');
  }
  return addresses;
}

function validateUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS image URLs are allowed');
  if (url.username || url.password) throw new Error('Image URLs cannot contain credentials');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Image URL port is not allowed');
  return url;
}

export async function fetchSafeImage(input: string, redirects = 0): Promise<{ buffer: Buffer; contentType: string }> {
  if (redirects > MAX_REDIRECTS) throw new Error('Too many image redirects');
  const url = validateUrl(input);
  const addresses = await resolvePublic(url.hostname);
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers: { 'User-Agent': 'Wattanam-ImageProxy/2.0', Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
    timeout: 10_000,
    lookup: (_hostname, options, callback) => {
      const family = typeof options === 'number' ? options : options?.family;
      const selected = addresses.find((entry) => !family || family === entry.family) || addresses[0];
      callback(null, selected.address, selected.family);
    },
  };
  const request = url.protocol === 'https:' ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    const req = request(options, (response) => {
      const status = response.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return reject(new Error('Image redirect has no location'));
        return fetchSafeImage(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return reject(new Error(`Image origin returned ${status}`));
      }
      const contentType = String(response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
      if (!ALLOWED_TYPES.has(contentType)) {
        response.resume();
        return reject(new Error('URL did not return an allowed raster image type'));
      }
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > MAX_IMAGE_BYTES) {
        response.destroy();
        return reject(new Error('Image exceeds the maximum allowed size'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) response.destroy(new Error('Image exceeds the maximum allowed size'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Image request timed out')));
    req.on('error', reject);
  });
}
