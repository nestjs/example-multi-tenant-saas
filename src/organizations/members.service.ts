import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, exists, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import { audit } from '../audit/audit.js';
import { memberships, organizations, users } from '../database/schema.js';
import type { Membership, Role } from './membership.js';

const others = alias(memberships, 'others');

@Injectable()
export class MembersService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  findAll(orgId: string) {
    return this.db
      .select({ userId: users.id, email: users.email, role: memberships.role, joinedAt: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(asc(users.email));
  }

  changeRole(actor: Membership, userId: string, role: Role) {
    return this.db.transaction(async (tx) => {
      const manager = await this.lock(tx, actor);
      if (role === 'owner' && manager.role !== 'owner') {
        throw new ForbiddenException('Only owners can make owners');
      }
      const [member] = await tx
        .update(memberships)
        .set({ role })
        .where(
          and(
            this.manageable(manager, userId),
            // Demoting an owner needs another owner to stay.
            role === 'owner' ? undefined : this.leavesAnOwner(tx),
          ),
        )
        .returning();
      if (!member) {
        return this.refuse(tx, manager, userId);
      }
      await audit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'member.role_changed',
        data: { userId, role },
      });
      return member;
    });
  }

  remove(actor: Membership, userId: string) {
    return this.db.transaction(async (tx) => {
      const manager = await this.lock(tx, actor);
      const [member] = await tx
        .delete(memberships)
        .where(and(this.manageable(manager, userId), this.leavesAnOwner(tx)))
        .returning();
      if (!member) {
        return this.refuse(tx, manager, userId);
      }
      await audit(tx, { orgId: actor.orgId, actorId: actor.userId, action: 'member.removed', data: { userId } });
    });
  }

  /**
   * Locks the organization's row until the transaction ends, so changes to its
   * memberships run one at a time, each seeing the one before it. Returns the
   * actor's membership as it is now: the guard read it before the lock.
   */
  private async lock(tx: Pick<NodePgDatabase, 'select'>, actor: Membership): Promise<Membership> {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, actor.orgId))
      .for('update');
    // A statement of its own, so it sees what committed while it waited for the lock.
    const [current] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, actor.userId)));
    if (!current) {
      throw new NotFoundException('Organization not found');
    }
    if (current.role === 'member') {
      throw new ForbiddenException('Requires the admin role');
    }
    return { ...actor, role: current.role };
  }

  /** The member's row, if the actor may change it: admins change admins and members, owners anyone. */
  private manageable(actor: Membership, userId: string) {
    return and(
      eq(memberships.orgId, actor.orgId),
      eq(memberships.userId, userId),
      actor.role === 'owner' ? undefined : ne(memberships.role, 'owner'),
    );
  }

  /** True unless the row is the organization's last owner. */
  private leavesAnOwner(tx: Pick<NodePgDatabase, 'select'>) {
    return or(
      ne(memberships.role, 'owner'),
      exists(
        tx
          .select({ one: sql`1` })
          .from(others)
          .where(
            and(eq(others.orgId, memberships.orgId), eq(others.role, 'owner'), ne(others.userId, memberships.userId)),
          ),
      ),
    );
  }

  /** Why a change matched no row: 404, 403 or 409. */
  private async refuse(tx: Pick<NodePgDatabase, 'select'>, actor: Membership, userId: string): Promise<never> {
    const [member] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, userId)));
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    if (member.role === 'owner' && actor.role !== 'owner') {
      throw new ForbiddenException('Only owners can change owners');
    }
    throw new ConflictException('An organization needs at least one owner');
  }
}
