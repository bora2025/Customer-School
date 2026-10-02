import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class BusService {
  constructor(private prisma: PrismaService) {}

  async getAllBuses() {
    return this.prisma.bus.findMany({
      include: { route: { include: { stops: { orderBy: { order: 'asc' } } } } },
      orderBy: { name: 'asc' },
    });
  }

  async getBus(id: string) {
    const bus = await this.prisma.bus.findUnique({
      where: { id },
      include: { route: { include: { stops: { orderBy: { order: 'asc' } } } } },
    });
    if (!bus) throw new NotFoundException('Bus not found');
    return bus;
  }

  async createBus(data: { name: string; plateNumber: string; capacity?: number; routeId?: string }) {
    return this.prisma.bus.create({ data });
  }

  async updateBus(id: string, data: any) {
    return this.prisma.bus.update({ where: { id }, data });
  }

  async deleteBus(id: string) {
    return this.prisma.bus.delete({ where: { id } });
  }

  async getAllRoutes() {
    return this.prisma.busRoute.findMany({
      include: { stops: { orderBy: { order: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async createRoute(data: { name: string; description?: string }) {
    return this.prisma.busRoute.create({ data });
  }

  async updateRoute(id: string, data: any) {
    return this.prisma.busRoute.update({ where: { id }, data });
  }

  async deleteRoute(id: string) {
    return this.prisma.busRoute.delete({ where: { id } });
  }

  async addStop(routeId: string, data: { name: string; latitude: number; longitude: number; order?: number }) {
    return this.prisma.busStop.create({ data: { ...data, routeId } });
  }

  async deleteStop(id: string) {
    return this.prisma.busStop.delete({ where: { id } });
  }

  async getLatestLocation(busId: string) {
    return this.prisma.busLocation.findFirst({
      where: { busId },
      orderBy: { timestamp: 'desc' },
    });
  }

  async recordLocation(busId: string, data: { latitude: number; longitude: number; speed?: number; heading?: number }) {
    return this.prisma.busLocation.create({ data: { busId, ...data } });
  }

  async getLocationHistory(busId: string, limit = 100) {
    return this.prisma.busLocation.findMany({
      where: { busId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }
}
