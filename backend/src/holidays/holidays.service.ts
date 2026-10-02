import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class HolidaysService {
  constructor(private prisma: PrismaService) {}

  /** Get all holidays for a given year */
  async getHolidaysByYear(year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    return this.prisma.holiday.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    });
  }

  /** Get all holidays for a given month */
  async getHolidaysByMonth(year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return this.prisma.holiday.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    });
  }

  /** Get holidays in a date range */
  async getHolidaysInRange(startDate: Date, endDate: Date) {
    return this.prisma.holiday.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      orderBy: { date: 'asc' },
    });
  }

  /** Check if a specific date is a holiday */
  async isHoliday(date: Date): Promise<boolean> {
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const count = await this.prisma.holiday.count({
      where: { date: { gte: dayStart, lt: dayEnd } },
    });
    return count > 0;
  }

  /** Create a new holiday */
  async createHoliday(data: {
    date: string; // ISO date string
    name: string;
    description?: string;
    type?: string;
    createdById: string;
  }) {
    const dateObj = new Date(data.date + 'T00:00:00.000Z');
    return this.prisma.holiday.create({
      data: {
        date: dateObj,
        name: data.name,
        description: data.description || null,
        type: data.type || 'HOLIDAY',
        createdById: data.createdById,
      },
    });
  }

  /** Update a holiday */
  async updateHoliday(id: string, data: {
    name?: string;
    description?: string;
    type?: string;
    date?: string;
  }) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.date !== undefined) updateData.date = new Date(data.date + 'T00:00:00.000Z');
    return this.prisma.holiday.update({ where: { id }, data: updateData });
  }

  /** Delete a holiday */
  async deleteHoliday(id: string) {
    return this.prisma.holiday.delete({ where: { id } });
  }
}
