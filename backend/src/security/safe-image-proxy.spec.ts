import { isPublicImageAddress } from './safe-image-proxy';

describe('safe image proxy address policy', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1',
    'fc00::1', '::ffff:127.0.0.1', '2001:db8::1',
  ])('blocks non-public address %s', (address) => {
    expect(isPublicImageAddress(address)).toBe(false);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('allows public address %s', (address) => {
    expect(isPublicImageAddress(address)).toBe(true);
  });
});
