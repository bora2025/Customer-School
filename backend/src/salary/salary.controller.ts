import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('salary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  @Roles('ADMIN')
  @Get('staff')
  getStaffList() {
    return this.salaryService.getStaffList();
  }

  @Roles('ADMIN')
  @Get('summary')
  getSummary(@Query('year') year: string, @Query('month') month: string) {
    return this.salaryService.getSummary(Number(year), Number(month));
  }

  @Roles('ADMIN')
  @Get()
  getAll(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('search') search?: string,
  ) {
    return this.salaryService.getAll(
      year ? Number(year) : undefined,
      month ? Number(month) : undefined,
      search,
    );
  }

  @Roles('ADMIN')
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.salaryService.getOne(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() body: any, @Request() req: any) {
    return this.salaryService.create({ ...body, createdById: req.user.userId });
  }

  @Roles('ADMIN')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.salaryService.update(id, body);
  }

  @Roles('ADMIN')
  @Patch(':id/paid')
  markPaid(@Param('id') id: string, @Body() body: { isPaid: boolean }) {
    return this.salaryService.markPaid(id, body.isPaid);
  }

  @Roles('ADMIN')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.salaryService.delete(id);
  }
}
