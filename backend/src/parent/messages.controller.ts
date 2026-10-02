import { Controller, Get, Post, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('messages')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MessagesController {
  constructor(private svc: MessagesService) {}

  @Roles('PARENT', 'TEACHER', 'ADMIN', 'STUDENT')
  @Get('inbox')
  getInbox(@Request() req: any) { return this.svc.getInbox(req.user.userId); }

  @Roles('PARENT', 'TEACHER', 'ADMIN', 'STUDENT')
  @Get('conversation/:partnerId')
  getConversation(@Param('partnerId') partnerId: string, @Request() req: any) {
    return this.svc.getConversation(req.user.userId, partnerId);
  }

  @Roles('PARENT', 'TEACHER', 'ADMIN', 'STUDENT')
  @Post()
  send(@Body() body: { receiverId: string; content: string }, @Request() req: any) {
    return this.svc.send(req.user.userId, body.receiverId, body.content);
  }

  @Roles('PARENT', 'TEACHER', 'ADMIN', 'STUDENT')
  @Patch('read/:partnerId')
  markRead(@Param('partnerId') partnerId: string, @Request() req: any) {
    return this.svc.markRead(req.user.userId, partnerId);
  }

  @Roles('PARENT', 'TEACHER', 'ADMIN', 'STUDENT')
  @Get('unread-count')
  unreadCount(@Request() req: any) {
    return this.svc.unreadCount(req.user.userId);
  }

  @Roles('PARENT', 'STUDENT', 'ADMIN')
  @Get('teachers')
  getTeachers() { return this.svc.getTeachers(); }

  @Roles('TEACHER', 'ADMIN')
  @Get('parents-students')
  getParentsStudents() { return this.svc.getParentsStudents(); }

  @Roles('PARENT', 'STUDENT')
  @Get('family-contacts')
  getFamilyContacts(@Request() req: any) { return this.svc.getFamilyContacts(req.user.userId); }
}
