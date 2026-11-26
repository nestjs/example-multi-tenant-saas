import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});
export type ChangeRoleDto = z.infer<typeof changeRoleSchema>;
