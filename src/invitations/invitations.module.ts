import { Module } from '@nestjs/common';
import { InvitationMail } from './invitation.mail.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, InvitationMail],
})
export class InvitationsModule {}
