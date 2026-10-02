import { Injectable } from '@nestjs/common';
import sgMail from '@sendgrid/mail';
import twilio from 'twilio';
import { PrismaService } from '../database/prisma.service';
import { NotificationProviderConfig, readNotificationProviderConfig } from './notification-config';

@Injectable()
export class NotificationService {
  private twilioClient: twilio.Twilio | null = null;
  private readonly config: NotificationProviderConfig;

  constructor(private prisma: PrismaService) {
    this.config = readNotificationProviderConfig();
    if (this.config.email.apiKey) {
      sgMail.setApiKey(this.config.email.apiKey);
    }
    if (this.config.sms.accountSid && this.config.sms.authToken) {
      this.twilioClient = twilio(
        this.config.sms.accountSid,
        this.config.sms.authToken,
      );
    }
  }

  async sendAbsenceNotification(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { 
        user: true, 
        parent: true
      },
    });

    if (!student || !student.parent) return;

    const parent = student.parent as any;
    const message = `Your child ${student.user.name} was marked absent today.`;

    // Send email (skip if no API key configured)
    if (parent.email && this.config.email.enabled) {
      try {
        await sgMail.send({
          to: parent.email,
          from: this.config.email.from,
          subject: 'Student Absence Notification',
          text: message,
        });
      } catch (err) {
        console.error('SendGrid email failed:', err?.message || err);
      }
    }

    // Send SMS (skip if no credentials configured)
    if (parent.phone && this.twilioClient && this.config.sms.from) {
      try {
        await this.twilioClient.messages.create({
          body: message,
          from: this.config.sms.from,
          to: parent.phone,
        });
      } catch (err) {
        console.error('Twilio SMS failed:', err?.message || err);
      }
    }

    // Log notification
    try {
      await this.prisma.notification.create({
        data: {
          userId: parent.id,
          message,
          type: 'absence',
        },
      });
    } catch (err) {
      console.error('Failed to log notification:', err?.message || err);
    }
  }

  /** Generic email dispatcher used by announcements and future notifications. */
  async sendEmail(to: string, subject: string, text: string) {
    if (!this.config.email.enabled) return { skipped: true, reason: 'no-api-key' };
    await sgMail.send({
      to,
      from: this.config.email.from,
      subject,
      text,
    });
    return { sent: true };
  }

  /** Generic SMS dispatcher used by announcements and future notifications. */
  async sendSms(to: string, body: string) {
    if (!this.twilioClient || !this.config.sms.from) {
      return { skipped: true, reason: 'no-twilio' };
    }
    await this.twilioClient.messages.create({
      body,
      from: this.config.sms.from,
      to,
    });
    return { sent: true };
  }

  /** Logs a row in the shared in-app Notification inbox -- the same table assignments, courses, messages, etc. already write to. */
  async notifyInApp(userId: string, message: string, type: string) {
    const notification = await this.prisma.notification.create({ data: { userId, message, type } });
    return { id: notification.id };
  }
}
