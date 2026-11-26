import { Inject, Injectable, Logger, NotFoundException, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { audit } from '../audit/audit.js';
import { projects, type Project } from '../database/schema.js';
import type { OrganizationPayload } from '../tenancy/organization-context-id.strategy.js';
import type { CreateProjectDto } from './projects.schemas.js';

/** One instance per organization, built with its id: no caller can pass another one. */
@Injectable({ scope: Scope.REQUEST, durable: true })
export class ProjectsService {
  private readonly orgId: string;

  constructor(
    // The strategy's payload, not the HTTP request: this instance serves every request of the organization.
    @Inject(REQUEST) { orgId }: OrganizationPayload,
    @InjectDrizzle() private readonly db: NodePgDatabase,
  ) {
    // Not a valid organization id: built for this request alone, which the guard would refuse anyway.
    if (!orgId) {
      throw new NotFoundException('Organization not found');
    }
    this.orgId = orgId;
    new Logger(ProjectsService.name).log(`Created for organization ${orgId}`);
  }

  findAll(): Promise<Project[]> {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.orgId, this.orgId))
      .orderBy(desc(projects.createdAt), desc(projects.id))
      .limit(100);
  }

  async findOne(id: string): Promise<Project> {
    const [project] = await this.db.select().from(projects).where(this.inOrg(id));
    return project ?? notFound();
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    const [project] = await this.db
      .insert(projects)
      .values({ ...dto, orgId: this.orgId })
      .returning();
    return project;
  }

  remove(actorId: string, id: string): Promise<void> {
    return this.db.transaction(async (tx) => {
      const [project] = await tx.delete(projects).where(this.inOrg(id)).returning();
      if (!project) {
        notFound();
      }
      await audit(tx, {
        orgId: this.orgId,
        actorId,
        action: 'project.deleted',
        data: { projectId: id, name: project.name },
      });
    });
  }

  private inOrg(id: string) {
    return and(eq(projects.id, id), eq(projects.orgId, this.orgId));
  }
}

function notFound(): never {
  throw new NotFoundException('Project not found');
}
