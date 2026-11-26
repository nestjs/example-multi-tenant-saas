import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { auditEvents } from '../database/schema.js';

export type AuditEntry = Pick<typeof auditEvents.$inferInsert, 'orgId' | 'actorId' | 'action' | 'data'>;

/** Records a change. Pass the change's transaction: the entry commits, or rolls back, with it. */
export async function audit(tx: Pick<NodePgDatabase, 'insert'>, entry: AuditEntry): Promise<void> {
  await tx.insert(auditEvents).values(entry);
}
