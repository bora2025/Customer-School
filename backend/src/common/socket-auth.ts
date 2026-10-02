import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { WsException } from '@nestjs/websockets';
import { verifyJwtWithRotationSupport } from '../auth/jwt-verification';

export interface SocketUser {
  userId: string;
  email?: string;
  role: string;
}

function cookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export function extractSocketToken(client: Socket): string | null {
  const authToken = client.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken) return authToken;

  const authorization = client.handshake.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);

  return cookieValue(client.handshake.headers.cookie, 'access_token');
}

export async function authenticateSocket(jwt: JwtService, client: Socket): Promise<SocketUser> {
  const token = extractSocketToken(client);
  if (!token) throw new WsException('Authentication required');

  try {
    const payload = await verifyJwtWithRotationSupport(jwt, token);
    if (!payload?.sub || !payload?.role) throw new Error('Invalid token payload');
    const user = { userId: payload.sub, email: payload.email, role: payload.role };
    client.data.user = user;
    return user;
  } catch {
    throw new WsException('Invalid or expired authentication token');
  }
}

export function requireSocketUser(client: Socket): SocketUser {
  const user = client.data?.user as SocketUser | undefined;
  if (!user) throw new WsException('Authentication required');
  return user;
}

