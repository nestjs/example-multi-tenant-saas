import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../database/schema.js';

export type { Role };

/** The signed-in user's membership in the organization of the route. */
export interface Membership {
  orgId: string;
  userId: string;
  role: Role;
}

/** The lowest role a route accepts: `@MinRole('admin')` lets admins and owners in. */
export const MinRole = Reflector.createDecorator<Role>();

/** The membership that `OrganizationGuard` loaded for this request. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Membership => context.switchToHttp().getRequest().membership,
);
