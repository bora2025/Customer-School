import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { PostsService, CreatePostDto, UpdatePostDto } from './posts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('posts')
export class PostsController {
  constructor(private readonly svc: PostsService) {}

  /** Admin: all posts (including drafts) — defined first so @Get() doesn't clash */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  listAll() {
    return this.svc.listAll();
  }

  /** Public: published posts feed (homepage, etc.) */
  @Get('published')
  listPublished(@Query('limit') limit?: string) {
    return this.svc.listPublished(limit ? parseInt(limit, 10) : 12);
  }

  /** Public: single post */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  /** Admin: create */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreatePostDto, @Request() req: any) {
    return this.svc.create({ ...dto, authorId: req.user?.sub });
  }

  /** Admin: update */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.svc.update(id, dto);
  }

  /** Admin: delete */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
