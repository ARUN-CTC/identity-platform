import { Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Phase 1 REPLACEMENT for TravelOS's PlatformEmailService (which is wired to
 * a specific outbound provider and template system — TravelOS-only, not
 * extracted). This dev implementation only logs; a later phase can swap in a
 * real provider behind this same interface without touching any caller
 * (invitations, forgot-password).
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      `[dev mailer] to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
  }
}
