import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CardAliasesController } from './card-aliases.controller';
import { CardAliasesService } from './card-aliases.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CardAliasesController],
  providers: [CardAliasesService],
})
export class CardAliasesModule {}
