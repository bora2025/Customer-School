import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

@Injectable()
export class PluginEventBus {
  private readonly logger = new Logger(PluginEventBus.name);
  private readonly emitter = new EventEmitter({ captureRejections: true });

  constructor() {
    this.emitter.on('error', (error) => this.logger.error(`Plugin event subscriber failed: ${error instanceof Error ? error.message : error}`));
  }

  publish<T>(event: string, payload: T) {
    if (!/^[a-z0-9.-]+\.v\d+$/.test(event)) throw new Error(`Plugin event must be versioned: ${event}`);
    this.emitter.emit(event, payload);
  }

  subscribe<T>(event: string, handler: (payload: T) => void | Promise<void>) {
    if (!/^[a-z0-9.-]+\.v\d+$/.test(event)) throw new Error(`Plugin event must be versioned: ${event}`);
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }
}
