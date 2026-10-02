import { AuthService } from './auth.service';

const jwt = { sign: jest.fn() } as any;
const PNG = `data:image/png;base64,${'A'.repeat(64)}`;

function prismaWith() {
  return { user: { update: jest.fn().mockResolvedValue({ id: 'user-1', photo: PNG }) } } as any;
}

describe('AuthService.updateUserPhoto', () => {
  it('accepts a small raster data URL', async () => {
    const prisma = prismaWith();
    await new AuthService(jwt, prisma).updateUserPhoto('user-1', PNG);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ photo: PNG });
  });

  it('treats an empty value as clearing the photo', async () => {
    const prisma = prismaWith();
    await new AuthService(jwt, prisma).updateUserPhoto('user-1', '');
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ photo: null });
  });

  /**
   * The column is rendered straight into an `img` src by the UIs that show it, so anything that is
   * not a raster image is refused rather than stored and dealt with later.
   */
  it.each([
    ['an SVG, which can carry script', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['an HTML payload', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['a remote URL', 'https://example.com/avatar.png'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL with no media type', 'data:;base64,AAAA'],
  ])('refuses %s', async (_label, value) => {
    const prisma = prismaWith();
    await expect(new AuthService(jwt, prisma).updateUserPhoto('user-1', value)).rejects.toThrow('PNG, JPEG, or WebP');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // The photo lives inline in the user row, so an unbounded value is an unbounded row.
  it('refuses an image far larger than a portrait needs to be', async () => {
    const prisma = prismaWith();
    const huge = `data:image/png;base64,${'A'.repeat(2_000_001)}`;
    await expect(new AuthService(jwt, prisma).updateUserPhoto('user-1', huge)).rejects.toThrow('smaller than');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
