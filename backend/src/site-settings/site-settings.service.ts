import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface HeroSlide {
  id: string;
  imageUrl: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface SiteSettingDto {
  siteName?: string;
  siteTagline?: string;
  logoUrl?: string;
  heroSlides?: HeroSlide[];
  footerAddress?: string;
  footerPhone?: string;
  footerEmail?: string;
  footerFacebook?: string;
  footerInstagram?: string;
  footerTwitter?: string;
  footerYoutube?: string;
  footerCopyright?: string;
  primaryColor?: string;
  customCss?: string;
  // About section
  aboutBadge?: string;
  aboutTitle?: string;
  aboutDescription?: string;
  aboutImageUrl?: string;
  aboutFeatures?: string[];
  aboutCtaLabel?: string;
  aboutCtaHref?: string;
}

@Injectable()
export class SiteSettingsService {
  constructor(private prisma: PrismaService) {}

  /** Get or create the singleton settings record. */
  async get() {
    let settings = await this.prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
    });
    if (!settings) {
      settings = await this.prisma.siteSetting.create({
        data: { id: 'singleton' },
      });
    }
    return {
      ...settings,
      heroSlides: this.parseJson(settings.heroSlides, []),
      aboutFeatures: this.parseJson(settings.aboutFeatures, []),
    };
  }

  /** Upsert the singleton settings record. */
  async update(dto: SiteSettingDto) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.heroSlides !== undefined) {
      data.heroSlides = JSON.stringify(dto.heroSlides);
    }
    if (dto.aboutFeatures !== undefined) {
      data.aboutFeatures = JSON.stringify(dto.aboutFeatures);
    }
    const settings = await this.prisma.siteSetting.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data } as any,
      update: data as any,
    });
    return {
      ...settings,
      heroSlides: this.parseJson(settings.heroSlides, []),
      aboutFeatures: this.parseJson(settings.aboutFeatures, []),
    };
  }

  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
