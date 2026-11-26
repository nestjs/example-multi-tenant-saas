import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Mailer } from '@nestjs/mail';
import { and, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { audit } from '../audit/audit.js';
import type { Env } from '../config.js';
import { invitations, memberships, organizations } from '../database/schema.js';
import type { Membership } from '../organizations/membership.js';
import type { User } from '../users/user.js';
import { InvitationMail } from './invitation.mail.js';
import type { CreateInvitationDto } from './invitations.schemas.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const columns = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  expiresAt: invitations.expiresAt,
  createdAt: invitations.createdAt,
};

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class InvitationsService {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async invite(actor: Membership, inviter: User, { email, role }: CreateInvitationDto) {
    const token = randomBytes(32).toString('base64url');
    const values = { role, tokenHash: hash(token), invitedBy: actor.userId, expiresAt: new Date(Date.now() + TTL_MS) };

    const { invitation, organization } = await this.db.transaction(async (tx) => {
      // Inviting the same address again replaces the token: the earlier link stops working.
      const [invitation] = await tx
        .insert(invitations)
        .values({ ...values, orgId: actor.orgId, email })
        .onConflictDoUpdate({
          target: [invitations.orgId, invitations.email],
          set: { ...values, createdAt: new Date() },
        })
        .returning(columns);
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, actor.orgId));
      await audit(tx, { orgId: actor.orgId, actorId: actor.userId, action: 'invitation.sent', data: { email, role } });
      return { invitation, organization };
    });

    // After the commit, never inside the transaction: it would hold its connection
    // and locks for as long as the mail server takes to answer.
    const url = new URL('/invitations/accept', this.config.get('APP_URL', { infer: true }));
    url.searchParams.set('token', token);
    await this.mailer.send(InvitationMail, {
      to: email,
      data: { organization: organization.name, invitedBy: inviter.email, url: url.href },
    });
    return invitation;
  }

  /** Spends the token: the signed-in user joins the organization it was sent for. */
  accept(user: User, token: string) {
    return this.db.transaction(async (tx) => {
      // Taking the invitation is the first statement: of two requests with the same
      // token, one deletes the row and the other finds nothing.
      const [invitation] = await tx
        .delete(invitations)
        .where(
          and(
            eq(invitations.tokenHash, hash(token)),
            // Only for the address it was sent to, so a forwarded link is useless.
            eq(invitations.email, user.email),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!invitation) {
        throw new NotFoundException('Invitation not found or expired');
      }
      // Already a member: keep the role they have.
      const [joined] = await tx
        .insert(memberships)
        .values({ orgId: invitation.orgId, userId: user.id, role: invitation.role })
        .onConflictDoNothing()
        .returning();
      if (joined) {
        await audit(tx, {
          orgId: invitation.orgId,
          actorId: user.id,
          action: 'member.joined',
          data: { invitationId: invitation.id, role: invitation.role },
        });
      }
      const [membership] = await tx
        .select({ orgId: memberships.orgId, userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.orgId, invitation.orgId), eq(memberships.userId, user.id)));
      return membership;
    });
  }
}
