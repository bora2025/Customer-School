import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';
import { readRuntimeConfig } from '../config/environment';
import { InstallDto } from './dto/install.dto';

export type InstallationState = 'ready' | 'installed' | 'legacy_unadopted';

@Injectable()
export class InstallationService {
  constructor(private readonly prisma: PrismaService) {}

  async status() {
    const installation = await this.prisma.installation.findUnique({
      where: { id: 'singleton' },
      select: {
        installationId: true,
        status: true,
        schoolName: true,
        schoolSlug: true,
        locale: true,
        timezone: true,
        currency: true,
        coreVersion: true,
        installedAt: true,
      },
    });

    if (installation) {
      return { state: 'installed' as InstallationState, installation };
    }

    const existingUsers = await this.prisma.user.count();
    return {
      state: (existingUsers === 0 ? 'ready' : 'legacy_unadopted') as InstallationState,
      installation: null,
    };
  }

  async install(dto: InstallDto) {
    this.assertValidTimezone(dto.timezone);
    const config = readRuntimeConfig();
    const ownerEmail = dto.ownerEmail.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(dto.ownerPassword, 12);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [installation, userCount] = await Promise.all([
          tx.installation.findUnique({ where: { id: 'singleton' }, select: { id: true } }),
          tx.user.count(),
        ]);

        if (installation || userCount > 0) {
          throw new ConflictException('Installation is already initialized or requires legacy adoption');
        }

        const owner = await tx.user.create({
          data: {
            email: ownerEmail,
            password: passwordHash,
            name: dto.ownerName.trim(),
            role: 'SUPER_ADMIN',
          },
          select: { id: true, email: true, name: true, role: true },
        });

        await tx.siteSetting.upsert({
          where: { id: 'singleton' },
          create: { id: 'singleton', siteName: dto.schoolName.trim() },
          update: { siteName: dto.schoolName.trim() },
        });

        const created = await tx.installation.create({
          data: {
            id: 'singleton',
            schoolName: dto.schoolName.trim(),
            schoolSlug: dto.schoolSlug,
            locale: dto.locale,
            timezone: dto.timezone,
            currency: dto.currency,
            coreVersion: config.appVersion,
            acceptedLicenseVersion: dto.acceptedLicenseVersion || null,
            acceptedLicenseAt: dto.acceptedLicenseVersion ? new Date() : null,
          },
          select: {
            installationId: true,
            status: true,
            schoolName: true,
            schoolSlug: true,
            locale: true,
            timezone: true,
            currency: true,
            coreVersion: true,
            installedAt: true,
          },
        });

        return { state: 'installed' as const, installation: created, owner };
      }, {
        isolationLevel: 'Serializable',
      });
    } catch (error: any) {
      if (error instanceof ConflictException) throw error;
      if (error?.code === 'P2002' || error?.code === 'P2034') {
        throw new ConflictException('Installation was initialized by another request');
      }
      throw error;
    }
  }

  private assertValidTimezone(timezone: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException('timezone must be a valid IANA timezone');
    }
  }
}
