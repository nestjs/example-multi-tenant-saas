import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { z } from 'zod';
import { MinRole } from '../organizations/membership.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { createProjectSchema, type CreateProjectDto } from './projects.schemas.js';
import { ProjectsService } from './projects.service.js';

const projectId = { schema: z.uuid() };

// Durable too, through ProjectsService: one instance per organization.
// Every member reads and creates projects; only admins and owners delete them.
@UseGuards(OrganizationGuard)
@Controller('orgs/:orgId/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':projectId')
  findOne(@Param('projectId', projectId) id: string) {
    return this.projectsService.findOne(id);
  }

  @Post()
  create(@Body({ schema: createProjectSchema }) dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @MinRole('admin')
  @Delete(':projectId')
  @HttpCode(204)
  remove(@CurrentUser('id') userId: string, @Param('projectId', projectId) id: string) {
    return this.projectsService.remove(userId, id);
  }
}
