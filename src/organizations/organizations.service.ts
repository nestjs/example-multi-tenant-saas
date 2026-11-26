import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { audit } from '../audit/audit.js';
import { auditEvents, memberships, organizations } from '../database/schema.js';

const columns = {
  id: organizations.id,
  name: organizations.name,
  createdAt: organizations.createdAt,
  role: memberships.role,
};

@Injectable()
export class OrganizationsService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  /** Creates an organization, with its creator as the first owner. */
  create(userId: string, name: string) {
    return this.db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({ name }).returning();
      await tx.insert(memberships).values({ orgId: organization.id, userId, role: 'owner' });
      await audit(tx, { orgId: organization.id, actorId: userId, action: 'organization.created', data: { name } });
      return { ...organization, role: 'owner' as const };
    });
  }

  /** The organizations the user belongs to, with their role in each. */
  findMine(userId: string) {
    return this.db
      .select(columns)
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(organizations.name));
  }

  auditLog(orgId: string) {
    return this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.orgId, orgId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(100);
  }
}
