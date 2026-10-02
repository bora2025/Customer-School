import { JwtService } from '@nestjs/jwt';
import { getJwtKeyId, getJwtSecondarySecrets, getJwtSecret } from '../config/environment';

/**
 * Resolves which secret should verify a given JWT, supporting overlap-capable rotation: a token
 * signed under the current active key id (or with no `kid` at all -- a token issued before this
 * mechanism existed) verifies against the active secret; a token tagged with a known secondary
 * key id verifies against that secret; anything else fails closed rather than guessing.
 */
export function resolveJwtVerificationSecret(
  jwtService: JwtService,
  token: string,
  activeKeyId: string = getJwtKeyId(),
  activeSecret: string = getJwtSecret(),
  secondarySecrets: ReadonlyMap<string, string> = getJwtSecondarySecrets(),
): string {
  const decoded = jwtService.decode(token, { complete: true }) as { header?: { kid?: unknown } } | null;
  const kid = decoded?.header?.kid;
  if (!kid || typeof kid !== 'string' || kid === activeKeyId) return activeSecret;
  const secondary = secondarySecrets.get(kid);
  if (!secondary) throw new Error('JWT signing key is not trusted');
  return secondary;
}

export function verifyJwtWithRotationSupport(jwtService: JwtService, token: string): Promise<any> {
  const secret = resolveJwtVerificationSecret(jwtService, token);
  return jwtService.verifyAsync(token, { secret });
}
