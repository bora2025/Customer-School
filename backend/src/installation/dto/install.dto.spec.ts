import { validate } from 'class-validator';
import { InstallDto } from './install.dto';

function dto(overrides: Partial<InstallDto> = {}) {
  return Object.assign(new InstallDto(), {
    schoolName: 'Test School',
    schoolSlug: 'test-school',
    locale: 'en-KH',
    timezone: 'Asia/Phnom_Penh',
    currency: 'KHR',
    ownerName: 'School Owner',
    ownerEmail: 'owner@example.com',
    ownerPassword: 'secure-password-123',
    ...overrides,
  });
}

describe('InstallDto', () => {
  it('accepts a complete installation request', async () => {
    await expect(validate(dto())).resolves.toHaveLength(0);
  });

  it('rejects whitespace-only identity fields', async () => {
    const errors = await validate(dto({ schoolName: '  ', ownerName: '   ' }));
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['schoolName', 'ownerName']));
  });

  it('rejects weak owner passwords', async () => {
    const errors = await validate(dto({ ownerPassword: 'onlyletterslong' }));
    expect(errors.some((error) => error.property === 'ownerPassword')).toBe(true);
  });

  it('rejects slugs and currencies outside their canonical format', async () => {
    const errors = await validate(dto({ schoolSlug: 'Test School', currency: 'usd' }));
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['schoolSlug', 'currency']));
  });
});
