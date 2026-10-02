import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface EducationInput {
  institution: string;
  degree?: string;
  fieldOfStudy?: string;
  startYear?: number | null;
  endYear?: number | null;
}

interface WorkExperienceInput {
  title: string;
  employer: string;
  startDate?: string | null;
  endDate?: string | null;
  description?: string;
}

interface CertificationInput {
  name: string;
  issuer?: string;
  issueDate?: string | null;
}

interface SaveCvInput {
  title?: string;
  summary?: string;
  skills?: string[];
  education?: EducationInput[];
  workExperience?: WorkExperienceInput[];
  certifications?: CertificationInput[];
}

@Injectable()
export class StaffCvService {
  constructor(private prisma: PrismaService) {}

  async getCv(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        photo: true,
        role: true,
        department: { select: { name: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [profile, education, workExperience, certifications] = await Promise.all([
      this.prisma.staffProfile.findUnique({ where: { userId } }),
      this.prisma.staffEducation.findMany({ where: { userId }, orderBy: { order: 'asc' } }),
      this.prisma.staffWorkExperience.findMany({ where: { userId }, orderBy: { order: 'asc' } }),
      this.prisma.staffCertification.findMany({ where: { userId }, orderBy: { order: 'asc' } }),
    ]);

    return {
      user,
      title: profile?.title ?? '',
      summary: profile?.summary ?? '',
      skills: Array.isArray(profile?.skills) ? (profile!.skills as string[]) : [],
      education,
      workExperience,
      certifications,
    };
  }

  // Saves the whole CV as one document — the profile header is upserted, and
  // each child list is replaced wholesale (delete-all/recreate), same pattern
  // exam.service.ts uses for ExamQuestion on exam update. Simpler than granular
  // per-item CRUD + reorder endpoints for what's edited as a single form.
  async saveCv(userId: string, body: SaveCvInput) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    const skills = Array.isArray(body.skills) ? body.skills.map((s) => String(s).trim()).filter(Boolean) : [];
    await this.prisma.staffProfile.upsert({
      where: { userId },
      create: { userId, title: body.title?.trim() || null, summary: body.summary?.trim() || null, skills },
      update: { title: body.title?.trim() || null, summary: body.summary?.trim() || null, skills },
    });

    if (Array.isArray(body.education)) {
      await this.prisma.staffEducation.deleteMany({ where: { userId } });
      const rows = body.education
        .filter((e) => e.institution?.trim())
        .map((e, i) => ({
          userId,
          institution: e.institution.trim(),
          degree: e.degree?.trim() || null,
          fieldOfStudy: e.fieldOfStudy?.trim() || null,
          startYear: e.startYear ?? null,
          endYear: e.endYear ?? null,
          order: i,
        }));
      if (rows.length) await this.prisma.staffEducation.createMany({ data: rows });
    }

    if (Array.isArray(body.workExperience)) {
      await this.prisma.staffWorkExperience.deleteMany({ where: { userId } });
      const rows = body.workExperience
        .filter((e) => e.title?.trim() && e.employer?.trim())
        .map((e, i) => ({
          userId,
          title: e.title.trim(),
          employer: e.employer.trim(),
          startDate: e.startDate ? new Date(e.startDate) : null,
          endDate: e.endDate ? new Date(e.endDate) : null,
          description: e.description?.trim() || null,
          order: i,
        }));
      if (rows.length) await this.prisma.staffWorkExperience.createMany({ data: rows });
    }

    if (Array.isArray(body.certifications)) {
      await this.prisma.staffCertification.deleteMany({ where: { userId } });
      const rows = body.certifications
        .filter((c) => c.name?.trim())
        .map((c, i) => ({
          userId,
          name: c.name.trim(),
          issuer: c.issuer?.trim() || null,
          issueDate: c.issueDate ? new Date(c.issueDate) : null,
          order: i,
        }));
      if (rows.length) await this.prisma.staffCertification.createMany({ data: rows });
    }

    return this.getCv(userId);
  }
}
