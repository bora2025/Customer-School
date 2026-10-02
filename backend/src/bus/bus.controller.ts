import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { BusService } from './bus.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('bus')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BusController {
  constructor(private busService: BusService) {}

  // ── Buses ──
  @Roles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT')
  @Get()
  getAllBuses() { return this.busService.getAllBuses(); }

  @Roles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT')
  @Get(':id')
  getBus(@Param('id') id: string) { return this.busService.getBus(id); }

  @Roles('ADMIN')
  @Post()
  createBus(@Body() body: any) { return this.busService.createBus(body); }

  @Roles('ADMIN')
  @Put(':id')
  updateBus(@Param('id') id: string, @Body() body: any) { return this.busService.updateBus(id, body); }

  @Roles('ADMIN')
  @Delete(':id')
  deleteBus(@Param('id') id: string) { return this.busService.deleteBus(id); }

  // ── Routes ──
  @Roles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT')
  @Get('routes/all')
  getAllRoutes() { return this.busService.getAllRoutes(); }

  @Roles('ADMIN')
  @Post('routes')
  createRoute(@Body() body: any) { return this.busService.createRoute(body); }

  @Roles('ADMIN')
  @Put('routes/:id')
  updateRoute(@Param('id') id: string, @Body() body: any) { return this.busService.updateRoute(id, body); }

  @Roles('ADMIN')
  @Delete('routes/:id')
  deleteRoute(@Param('id') id: string) { return this.busService.deleteRoute(id); }

  // ── Stops ──
  @Roles('ADMIN')
  @Post('routes/:routeId/stops')
  addStop(@Param('routeId') routeId: string, @Body() body: any) { return this.busService.addStop(routeId, body); }

  @Roles('ADMIN')
  @Delete('stops/:id')
  deleteStop(@Param('id') id: string) { return this.busService.deleteStop(id); }

  // ── Location ──
  @Roles('ADMIN', 'TEACHER', 'PARENT', 'STUDENT')
  @Get(':id/location')
  getLocation(@Param('id') id: string) { return this.busService.getLatestLocation(id); }

  @Roles('ADMIN', 'WATTAMAN')
  @Post(':id/location')
  recordLocation(@Param('id') id: string, @Body() body: any) { return this.busService.recordLocation(id, body); }

  @Roles('ADMIN')
  @Get(':id/history')
  getHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.busService.getLocationHistory(id, limit ? Number(limit) : 100);
  }
}
