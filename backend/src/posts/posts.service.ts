import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface CreatePostDto {
  title: string;
  excerpt?: string;
  body?: string;
  type?: 'text' | 'image' | 'video';
  imageUrl?: string;
  videoUrl?: string;
  published?: boolean;
  pinned?: boolean;
  tags?: string[];
  authorId?: string;
}

export type UpdatePostDto = Partial<CreatePostDto>;

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService) {}

  /** Admin: list all posts (any status). */
  async listAll() {
    const posts = await this.prisma.post.findMany({
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
    return posts.map((p) => this.deserialize(p));
  }

  /** Public: list published posts only. */
  async listPublished(limit = 12) {
    const posts = await this.prisma.post.findMany({
      where: { published: true },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return posts.map((p) => this.deserialize(p));
  }

  /** Get single post by id. */
  async findOne(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return this.deserialize(post);
  }

  /** Create a post. */
  async create(dto: CreatePostDto) {
    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        excerpt: dto.excerpt ?? '',
        body: dto.body ?? '',
        type: dto.type ?? 'text',
        imageUrl: dto.imageUrl ?? '',
        videoUrl: dto.videoUrl ?? '',
        published: dto.published ?? false,
        pinned: dto.pinned ?? false,
        tags: JSON.stringify(dto.tags ?? []),
        authorId: dto.authorId,
      },
    });
    return this.deserialize(post);
  }

  /** Update a post. */
  async update(id: string, dto: UpdatePostDto) {
    await this.findOne(id); // throws if not found
    const data: Record<string, unknown> = { ...dto };
    if (dto.tags !== undefined) data.tags = JSON.stringify(dto.tags);
    const post = await this.prisma.post.update({ where: { id }, data });
    return this.deserialize(post);
  }

  /** Delete a post. */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.post.delete({ where: { id } });
    return { success: true };
  }

  private deserialize(post: any) {
    return {
      ...post,
      tags: this.parseJson(post.tags, []),
    };
  }

  private parseJson<T>(value: string, fallback: T): T {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
}
