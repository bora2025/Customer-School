import { Controller, Post, Body, UseGuards, Get, Query, Put, Delete, Param, HttpException, HttpStatus, Request, Res } from '@nestjs/common';
import { Response } from 'express';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuditService } from '../audit/audit.service';
import { getJwtSecret } from '../config/environment';
import { PasswordResetService } from './password-reset.service';
import { ConfirmPasswordResetDto, RequestPasswordResetDto } from './dto/password-reset.dto';
import { MfaService } from './mfa.service';

const isProduction = process.env.NODE_ENV === 'production';
const secureCookies = process.env.COOKIE_SECURE === undefined
  ? isProduction
  : process.env.COOKIE_SECURE === 'true';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: secureCookies,
  sameSite: (secureCookies ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private audit: AuditService,
    private passwordReset: PasswordResetService,
    private mfa: MfaService,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('forgot-password')
  async requestPasswordReset(@Body() body: RequestPasswordResetDto, @Request() req: any) {
    await this.passwordReset.request(body.email);
    await this.audit.log({ action: 'PASSWORD_RESET_REQUESTED', resource: 'AUTH', actorEmail: body.email, method: 'POST', path: '/auth/forgot-password', ip: this.clientIp(req) });
    return { requested: true };
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('reset-password')
  async confirmPasswordReset(@Body() body: ConfirmPasswordResetDto, @Request() req: any) {
    await this.passwordReset.confirm(body.token, body.newPassword);
    await this.audit.log({ action: 'PASSWORD_RESET', resource: 'AUTH', method: 'POST', path: '/auth/reset-password', ip: this.clientIp(req) });
    return { reset: true };
  }

  /** Extract client IP honouring X-Forwarded-For */
  private clientIp(req: any): string | null {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }

  /**
   * Only a SUPER_ADMIN can modify or delete another SUPER_ADMIN.
   * Throws 403 otherwise.
   */
  private async assertCanManageTarget(actorRole: string | undefined, targetUserId: string) {
    const target = await this.authService.findById(targetUserId);
    if (!target) throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    if (target.role === 'SUPER_ADMIN' && actorRole !== 'SUPER_ADMIN') {
      throw new HttpException('Only a Super Admin can modify another Super Admin', HttpStatus.FORBIDDEN);
    }
    return target;
  }

  /** Helper: set both access + refresh cookies */
  private setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
    res.cookie('access_token', accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });
    res.cookie('refresh_token', refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth/refresh', // only sent to the refresh endpoint (via Next.js proxy)
    });
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  async login(@Body() body: LoginDto, @Request() req: any, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      this.audit.log({
        action: 'LOGIN_FAILED',
        resource: 'AUTH',
        actorEmail: body?.email ?? null,
        method: 'POST',
        path: '/auth/login',
        ip: this.clientIp(req),
        userAgent: req.headers?.['user-agent'] ?? null,
        success: false,
        errorMessage: 'Invalid credentials',
      });
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }
    await this.mfa.assertLoginCode(user.id, body.mfaCode);
    const { access_token, refresh_token } = await this.authService.login(user);
    this.setTokenCookies(res, access_token, refresh_token);
    this.audit.log({
      action: 'LOGIN',
      resource: 'AUTH',
      actorId: user.id,
      actorRole: user.role,
      actorName: user.name,
      actorEmail: user.email,
      method: 'POST',
      path: '/auth/login',
      ip: this.clientIp(req),
      userAgent: req.headers?.['user-agent'] ?? null,
      success: true,
    });
    // Return tokens in body as well (mobile app needs them)
    return { access_token, refresh_token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup')
  setupMfa(@Request() req: any, @Body() body: { currentPassword?: string }) {
    return this.mfa.begin(req.user.userId, body?.currentPassword || '');
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  enableMfa(@Request() req: any, @Body() body: { code?: string }) {
    return this.mfa.enable(req.user.userId, body?.code || '');
  }

  @SkipThrottle()
  @Post('refresh')
  async refresh(@Request() req, @Body() body: { refresh_token?: string } = {}, @Res({ passthrough: true }) res: Response) {
    // Cookie for web; body for mobile (no cookies available).
    const oldToken = req.cookies?.refresh_token || body?.refresh_token;
    if (!oldToken) {
      throw new HttpException('No refresh token', HttpStatus.UNAUTHORIZED);
    }
    const { accessToken, refreshToken } = await this.authService.rotateRefreshToken(oldToken);
    this.setTokenCookies(res, accessToken, refreshToken);
    // Return both tokens in body so mobile clients can persist them.
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  @Post('logout')
  async logout(@Request() req, @Res({ passthrough: true }) res: Response) {
    // Try to revoke refresh tokens if user is authenticated, but don't require it
    let logoutActorId: string | null = null;
    try {
      const token = req.cookies?.access_token;
      if (token) {
        const payload = require('jsonwebtoken').verify(token, getJwtSecret());
        if (payload?.sub) {
          logoutActorId = payload.sub;
          await this.authService.revokeAllRefreshTokens(payload.sub);
        }
      }
    } catch { /* token expired or invalid – still allow logout */ }
    res.clearCookie('access_token', { ...COOKIE_OPTIONS });
    res.clearCookie('refresh_token', { ...COOKIE_OPTIONS, path: '/api/auth/refresh' });
    this.audit.log({
      action: 'LOGOUT',
      resource: 'AUTH',
      actorId: logoutActorId,
      method: 'POST',
      path: '/auth/logout',
      ip: this.clientIp(req),
      userAgent: req.headers?.['user-agent'] ?? null,
      success: true,
    });
    return { message: 'Logged out' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('register')
  async register(@Body() body: RegisterDto & { departmentId?: string }) {
    try {
      return await this.authService.register(body.email, body.password, body.name, body.role, body.departmentId, body.phone);
    } catch (error: any) {
      if (error.message === 'Email already exists' || error.message === 'Phone number already registered' || error.message === 'Email or phone is required' || error.message === 'Invalid email address' || error.message?.startsWith('Core installations')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile')
  getProfile(@Request() req) {
    return req.user;
  }

  /** Changing your own password, unlike an administrator resetting someone else's, requires the
   * current one — otherwise a stolen session is enough to take the account permanently. */
  @UseGuards(JwtAuthGuard)
  @Post('password/change')
  async changeOwnPassword(@Body() body: { currentPassword?: string; newPassword?: string }, @Request() req: any) {
    return this.authService.changeOwnPassword(req.user.userId, body?.currentPassword || '', body?.newPassword || '');
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getCurrentUser(@Request() req) {
    return this.authService.getUserById(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('users')
  async getUsers(@Query('role') role?: string, @Query('roles') roles?: string) {
    if (roles) {
      const rolesArr = roles.split(',').map(r => r.trim().toUpperCase());
      return this.authService.getUsers(undefined, rolesArr);
    }
    return this.authService.getUsers(role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('users/bulk')
  async bulkRegister(@Body() body: { users: { email: string; password: string; name: string; role: string; photo?: string }[] }) {
    return this.authService.bulkRegister(body.users);
  }

  /** Your own photo. No id in the path, so there is nothing to point at somebody else. */
  @UseGuards(JwtAuthGuard)
  @Post('profile/photo')
  async updateOwnPhoto(@Body() body: { photo?: string }, @Request() req: any) {
    return this.authService.updateUserPhoto(req.user.userId, body?.photo ?? '');
  }

  /**
   * Changing *someone else's* photo. This previously carried only JwtAuthGuard, so any signed-in
   * account — a student or parent included — could overwrite any other user's photo by naming
   * their id, a Super Admin's among them. Self-service now has its own route above, leaving this
   * one for administrators acting on people they may manage.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Put('users/:id/photo')
  async updateUserPhoto(@Param('id') id: string, @Body() body: { photo: string }, @Request() req: any) {
    await this.assertCanManageTarget(req.user?.role, id);
    return this.authService.updateUserPhoto(id, body.photo);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Put('users/:id/password')
  async resetUserPassword(@Param('id') id: string, @Body() body: { password: string }, @Request() req: any) {
    if (!body?.password || body.password.length < 6) {
      throw new HttpException('Password must be at least 6 characters', HttpStatus.BAD_REQUEST);
    }
    await this.assertCanManageTarget(req.user?.role, id);
    await this.authService.resetUserPassword(id, body.password);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Put('users/:id')
  async updateUser(
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string; role?: string; phone?: string; departmentId?: string | null },
    @Request() req: any,
  ) {
    await this.assertCanManageTarget(req.user?.role, id);
    // Also: only SUPER_ADMIN may promote a user TO SUPER_ADMIN.
    if (body?.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
      throw new HttpException('Only a Super Admin can assign the Super Admin role', HttpStatus.FORBIDDEN);
    }
    try {
      return await this.authService.updateUser(id, body);
    } catch (error: any) {
      if (error.message === 'Email already exists' || error.message === 'Phone number already registered') {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error.message === 'Invalid role' || error.message?.startsWith('Core installations')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Put('users/:id/parent')
  async setStudentParent(
    @Param('id') studentUserId: string,
    @Body() body: { parentId: string | null },
  ) {
    try {
      return await this.authService.setStudentParent(studentUserId, body?.parentId ?? null);
    } catch (e: any) {
      throw new HttpException(e?.message ?? 'Failed to set parent', HttpStatus.BAD_REQUEST);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/search')
  async searchUsers(@Query('q') query: string, @Query('role') role?: string) {
    return this.authService.searchUsers(query || '', role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete('users/:id')
  async deleteUser(@Param('id') id: string, @Request() req: any) {
    if (req.user?.userId === id) {
      throw new HttpException('Cannot delete your own account', HttpStatus.FORBIDDEN);
    }
    await this.assertCanManageTarget(req.user?.role, id);
    try {
      return await this.authService.deleteUser(id);
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to delete user', HttpStatus.BAD_REQUEST);
    }
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('users/:id/schedule')
  getStudentSchedule(@Param('id') id: string) {
    return this.authService.getStudentSchedule(id);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Get('my-schedule')
  getMySchedule(@Request() req: any) {
    return this.authService.getStudentSchedule(req.user.userId);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Get('my-teacher-schedule')
  getMyTeacherSchedule(@Request() req: any) {
    return this.authService.getTeacherSchedule(req.user.userId);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT', 'ADMIN', 'SUPER_ADMIN')
  @Get('child-schedule/:childUserId')
  getChildSchedule(@Param('childUserId') childUserId: string) {
    return this.authService.getStudentSchedule(childUserId);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('users/:id/full-profile')
  getFullProfile(@Param('id') id: string) {
    return this.authService.getFullProfile(id);
  }
}
