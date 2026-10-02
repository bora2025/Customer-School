import { Global, Module } from '@nestjs/common';
import { createPluginStorageProvider } from './storage-config';

export const PLUGIN_OBJECT_STORAGE = Symbol('PLUGIN_OBJECT_STORAGE');

@Global()
@Module({
  providers: [{ provide: PLUGIN_OBJECT_STORAGE, useFactory: () => createPluginStorageProvider() }],
  exports: [PLUGIN_OBJECT_STORAGE],
})
export class StorageModule {}
