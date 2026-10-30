import type { Sql, Tx } from '../db';

/** Record a sensitive admin action. Metadata must not contain secrets or personal data. */
export async function audit(db: Sql | Tx, adminId: string, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  await db`insert into admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (${adminId}, ${action}, ${targetType}, ${targetId}, ${db.json(metadata as never)})`;
}
