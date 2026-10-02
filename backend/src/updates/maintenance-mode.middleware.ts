import { Injectable, NestMiddleware, ServiceUnavailableException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import path from 'path';

export function updateStateDirectory() {
  return path.resolve(process.env.UPDATE_STATE_DIR || (process.env.NODE_ENV === 'production' ? '/data/update-state' : './update-state'));
}

export function maintenanceFlagPath() { return path.join(updateStateDirectory(), 'maintenance.json'); }

@Injectable()
export class MaintenanceModeMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction) {
    if (!existsSync(maintenanceFlagPath()) || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    if (/^\/?updates\/core\/operations\/[a-f0-9-]+\/complete\/?$/.test(request.path)) return next();
    throw new ServiceUnavailableException('The school is in read-only maintenance mode for a controlled update');
  }
}
