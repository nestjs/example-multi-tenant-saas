import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { memberships } from '../database/schema.js';
import type { User } from '../users/user.js';
import { MinRole, type Membership, type Role } from './membership.js';

const rank: Record<Role, number> = { member: 1, admin: 2, owner: 3 };
const uuid = z.uuid();

/** Resolves `:orgId` to the signed-in user's membership, once per request. */
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDrizzle() private readonly db: NodePgDatabase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ params: { orgId?: string }; user: User; membership?: Membership }>();
    const orgId = request.params.orgId;
    // Guards run before pipes, so the id isn't validated yet.
    if (!uuid.safeParse(orgId).success) {
      throw notFound();
    }
    const [membership] = await this.db
      .select({ orgId: memberships.orgId, userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId!), eq(memberships.userId, request.user.id)));
    // Not a member: the organization might as well not exist.
    if (!membership) {
      throw notFound();
    }
    const required = this.reflector.getAllAndOverride(MinRole, [context.getHandler(), context.getClass()]) ?? 'member';
    if (rank[membership.role] < rank[required]) {
      throw new ForbiddenException(`Requires the ${required} role`);
    }
    request.membership = membership;
    return true;
  }
}

const notFound = () => new NotFoundException('Organization not found');
