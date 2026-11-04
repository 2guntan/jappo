import { and, arrayOverlaps, eq, inArray, sql } from 'drizzle-orm';
import { renderNotification } from '@jappo/templates';
import type { DbOrTx } from '../db/client';
import { notifications } from '../modules/notifications/schema';
import { memberships, users } from '../modules/identity/schema';
import type { ModuleContext } from './module';

export interface NotifyInput {
  recipientType: 'user' | 'farmer' | 'address';
  recipientId: string;
  orgId?: string | null;
  channels: ('in_app' | 'email' | 'sms')[];
  templateCode: string;
  locale: string;
  data: Record<string, unknown>;
  email?: string | null;
  phone?: string | null;
  link?: string | null;
}

/** Queue notifications (rendered now, delivered by the worker for email/SMS). */
export async function notify(tx: DbOrTx, n: NotifyInput): Promise<void> {
  const r = renderNotification(n.templateCode, n.locale, n.data);
  const rows = n.channels
    .map((channel) => {
      const destination = channel === 'email' ? n.email : channel === 'sms' ? n.phone : null;
      if (channel !== 'in_app' && !destination) return null;
      return {
        recipientType: n.recipientType,
        recipientId: n.recipientId,
        orgId: n.orgId ?? null,
        channel,
        destination: destination ?? null,
        templateCode: n.templateCode,
        locale: n.locale,
        data: n.data,
        subject: channel === 'in_app' ? r.title : r.subject,
        body: channel === 'sms' ? r.sms : r.body,
        link: n.link ?? null,
        status: channel === 'in_app' ? ('sent' as const) : ('pending' as const),
        sentAt: channel === 'in_app' ? new Date() : null,
      };
    })
    .filter((x) => x !== null);
  if (rows.length) await tx.insert(notifications).values(rows);
}

/** Notify all active members of an org holding one of `roles`. */
export async function notifyOrgRoles(
  tx: DbOrTx,
  orgId: string,
  roles: string[],
  input: Omit<NotifyInput, 'recipientType' | 'recipientId' | 'email' | 'phone' | 'locale' | 'orgId'>,
): Promise<void> {
  const rows = await tx
    .select({ id: users.id, email: users.email, phone: users.phone, locale: users.locale })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, 'active'), eq(users.status, 'active'), arrayOverlaps(memberships.roles, roles)));
  for (const u of rows) {
    await notify(tx, { ...input, recipientType: 'user', recipientId: u.id, orgId, email: u.email, phone: u.phone, locale: u.locale });
  }
}

/** Deliver pending email/SMS notifications (worker job; callable in tests). */
/** One-time codes must not stay readable in the database after delivery (SPEC §18.1). */
function redacted(ctx: ModuleContext, n: typeof notifications.$inferSelect) {
  const data = (n.data ?? {}) as Record<string, unknown>;
  if (!ctx.env.OTP_REDACT_AFTER_DELIVERY || typeof data.code !== 'string') return {};
  const mask = (v: string | null) => (v ? v.split(data.code as string).join('••••••') : v);
  const { code: _code, ...rest } = data;
  return { data: { ...rest, codeRedacted: true }, body: mask(n.body), subject: mask(n.subject) };
}

export async function deliverPendingNotifications(ctx: ModuleContext, limit = 100): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.status, 'pending'), inArray(notifications.channel, ['email', 'sms']), sql`${notifications.attempts} < 5`))
      .orderBy(notifications.id)
      .limit(limit)
      .for('update', { skipLocked: true });
    let sent = 0;
    for (const n of pending) {
      try {
        const ref =
          n.channel === 'email'
            ? await ctx.email.send({ to: n.destination!, subject: n.subject ?? '', text: n.body ?? '' })
            : await ctx.sms.send(n.destination!, n.body ?? '');
        await tx
          .update(notifications)
          .set({ status: 'sent', sentAt: new Date(), provider: n.channel === 'email' ? ctx.email.code : ctx.sms.code, providerRef: ref.providerRef, attempts: n.attempts + 1, ...redacted(ctx, n) })
          .where(eq(notifications.id, n.id));
        sent += 1;
      } catch (e) {
        await tx
          .update(notifications)
          .set({ attempts: n.attempts + 1, error: (e as Error).message, status: n.attempts + 1 >= 5 ? 'failed' : 'pending' })
          .where(eq(notifications.id, n.id));
      }
    }
    return sent;
  });
}
