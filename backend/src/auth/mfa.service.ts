import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { getJwtSecret } from '../config/environment';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(value: Buffer): string {
  let bits = '';
  for (const byte of value) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) output += ALPHABET[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  return output;
}

function base32Decode(value: string): Buffer {
  let bits = '';
  for (const character of value.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error('invalid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 30_000);
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(input).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, '0');
}

function matchesTotp(secret: string, code: string, now = Date.now()): boolean {
  return [-30_000, 0, 30_000].some((offset) => {
    const expected = totp(secret, now + offset);
    return code.length === expected.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected));
  });
}

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  private key(): Buffer { return crypto.createHash('sha256').update(getJwtSecret()).digest(); }

  private encrypt(secret: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
  }

  private decrypt(value: string): string {
    const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !ciphertext) throw new Error('invalid encrypted MFA secret');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  async begin(userId: string, currentPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, password: true, mfaEnabled: true } });
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) throw new UnauthorizedException('Current password is incorrect');
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');
    const secret = base32Encode(crypto.randomBytes(20));
    const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
    await this.prisma.user.update({ where: { id: userId }, data: {
      mfaSecretEncrypted: this.encrypt(secret),
      mfaRecoveryCodes: recoveryCodes.map((code) => crypto.createHash('sha256').update(code).digest('hex')),
    } });
    const label = encodeURIComponent(user.email || userId);
    return { secret, recoveryCodes, otpauthUrl: `otpauth://totp/Wattanam:${label}?secret=${secret}&issuer=Wattanam&digits=6&period=30` };
  }

  async enable(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { mfaSecretEncrypted: true } });
    if (!user?.mfaSecretEncrypted || !matchesTotp(this.decrypt(user.mfaSecretEncrypted), code)) throw new BadRequestException('Invalid MFA code');
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    return { enabled: true };
  }

  async assertLoginCode(userId: string, code?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true, mfaSecretEncrypted: true, mfaRecoveryCodes: true } });
    if (!user?.mfaEnabled) return;
    if (!code) throw new UnauthorizedException('MFA code required');
    if (user.mfaSecretEncrypted && /^\d{6}$/.test(code) && matchesTotp(this.decrypt(user.mfaSecretEncrypted), code)) return;
    const digest = crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
    const hashes = Array.isArray(user.mfaRecoveryCodes) ? user.mfaRecoveryCodes.filter((item): item is string => typeof item === 'string') : [];
    if (!hashes.includes(digest)) throw new UnauthorizedException('Invalid MFA code');
    await this.prisma.user.update({ where: { id: userId }, data: { mfaRecoveryCodes: hashes.filter((hash) => hash !== digest) } });
  }
}
