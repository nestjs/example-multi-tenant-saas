import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { CurrentMembership, MinRole, type Membership } from './membership.js';
import { OrganizationGuard } from './organization.guard.js';
import { createOrganizationSchema, type CreateOrganizationDto } from './organizations.schemas.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('orgs')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body({ schema: createOrganizationSchema }) dto: CreateOrganizationDto) {
    return this.organizationsService.create(userId, dto.name);
  }

  @Get()
  findMine(@CurrentUser('id') userId: string) {
    return this.organizationsService.findMine(userId);
  }

  @UseGuards(OrganizationGuard)
  @MinRole('admin')
  @Get(':orgId/audit-events')
  auditLog(@CurrentMembership() { orgId }: Membership) {
    return this.organizationsService.auditLog(orgId);
  }
}
