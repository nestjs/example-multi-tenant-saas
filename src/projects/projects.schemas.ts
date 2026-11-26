import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5_000).default(''),
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;
