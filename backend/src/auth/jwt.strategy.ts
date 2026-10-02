import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { resolveJwtVerificationSecret } from './jwt-verification';

function extractJwtFromCookieOrHeader(req: Request): string | null {
  // 1) Try HttpOnly cookie first (web)
  if (req.cookies?.access_token) {
    return req.cookies.access_token;
  }
  // 2) Fallback to Authorization header (mobile app)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(jwtService: JwtService) {
    super({
      jwtFromRequest: extractJwtFromCookieOrHeader,
      ignoreExpiration: false,
      // secretOrKeyProvider (rather than a static secretOrKey) lets an in-flight token signed
      // under a previous JWT_SECRET keep verifying during a rotation's overlap window -- see
      // src/auth/jwt-verification.ts and docs/operations/secret-rotation-runbooks.md.
      secretOrKeyProvider: (_request: Request, rawJwtToken: string, done: (err: unknown, secret?: string) => void) => {
        try { done(null, resolveJwtVerificationSecret(jwtService, rawJwtToken)); }
        catch (error) { done(error); }
      },
    });
  }

  async validate(payload: any) {
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
