import { z } from 'zod';

export const createInvitationSchema = z.object({
  // Stored as users.email is, so the accepting user's address matches it.
  email: z.email().transform((email) => email.normalize('NFC').toLowerCase()),
  // Owners are made, not invited: see PATCH /orgs/:orgId/members/:userId.
  role: z.enum(['admin', 'member']).default('member'),
});
export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(100),
});
export type AcceptInvitationDto = z.infer<typeof acceptInvitationSchema>;
