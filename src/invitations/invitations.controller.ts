import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { CurrentMembership, MinRole, type Membership } from '../organizations/membership.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import type { User } from '../users/user.js';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  type AcceptInvitationDto,
  type CreateInvitationDto,
} from './invitations.schemas.js';
import { InvitationsService } from './invitations.service.js';

@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @UseGuards(OrganizationGuard)
  @MinRole('admin')
  @Post('orgs/:orgId/invitations')
  invite(
    @CurrentMembership() actor: Membership,
    @CurrentUser() user: User,
    @Body({ schema: createInvitationSchema }) dto: CreateInvitationDto,
  ) {
    return this.invitationsService.invite(actor, user, dto);
  }

  // No :orgId and no guard: the user isn't a member yet. The token says which organization.
  @Post('invitations/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: User, @Body({ schema: acceptInvitationSchema }) { token }: AcceptInvitationDto) {
    return this.invitationsService.accept(user, token);
  }
}
