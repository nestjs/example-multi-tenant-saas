import { Body, Controller, Delete, Get, HttpCode, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentMembership, MinRole, type Membership } from './membership.js';
import { MembersService } from './members.service.js';
import { OrganizationGuard } from './organization.guard.js';
import { changeRoleSchema, type ChangeRoleDto } from './organizations.schemas.js';

const userId = { schema: z.uuid() };

@UseGuards(OrganizationGuard)
@Controller('orgs/:orgId/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  findAll(@CurrentMembership() { orgId }: Membership) {
    return this.membersService.findAll(orgId);
  }

  @MinRole('admin')
  @Patch(':userId')
  changeRole(
    @CurrentMembership() actor: Membership,
    @Param('userId', userId) id: string,
    @Body({ schema: changeRoleSchema }) { role }: ChangeRoleDto,
  ) {
    return this.membersService.changeRole(actor, id, role);
  }

  @MinRole('admin')
  @Delete(':userId')
  @HttpCode(204)
  remove(@CurrentMembership() actor: Membership, @Param('userId', userId) id: string) {
    return this.membersService.remove(actor, id);
  }
}
