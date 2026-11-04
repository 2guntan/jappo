import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { IdParam, Notification, Ok, PageQuery, page } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import { notifications } from './schema';
import { actorUserId } from '../../core/context';
import { decodeCursor, toPage } from '../../core/pagination';
import { forbidden, notFound } from '../../core/errors';

export async function notificationRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  const me = (a: Parameters<typeof actorUserId>[0]) => {
    const id = actorUserId(a);
    if (!id) throw forbidden('USER_REQUIRED');
    return id;
  };

  r.get('/notifications', {
    schema: {
      operationId: 'listMyNotifications',
      tags: ['notifications'],
      'x-permission': 'authenticated',
      querystring: PageQuery.extend({ unread: z.coerce.boolean().optional() }),
      response: { 200: page(Notification).extend({ unreadCount: z.number().int() }) },
    },
    handler: async (req) => {
      const uid = me(req.actor);
      const conds: SQL[] = [eq(notifications.recipientType, 'user'), eq(notifications.recipientId, uid), eq(notifications.channel, 'in_app')];
      if (req.query.unread) conds.push(isNull(notifications.readAt));
      const c = decodeCursor(req.query.cursor);
      if (c) conds.push(lt(notifications.id, c.id));
      const rows = await db.select().from(notifications).where(and(...conds)).orderBy(desc(notifications.id)).limit(req.query.limit + 1);
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientType, 'user'), eq(notifications.recipientId, uid), eq(notifications.channel, 'in_app'), isNull(notifications.readAt)));
      return {
        ...toPage(rows, req.query.limit, (n) => ({
          id: n.id,
          channel: n.channel,
          templateCode: n.templateCode,
          title: n.subject ?? n.templateCode,
          body: n.body ?? '',
          link: n.link,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
        unreadCount: n,
      };
    },
  });

  r.post('/notifications/:id/actions/read', {
    schema: { operationId: 'markNotificationRead', tags: ['notifications'], 'x-permission': 'authenticated', params: IdParam, response: { 200: Ok } },
    handler: async (req) => {
      const [n] = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.id, req.params.id), eq(notifications.recipientType, 'user'), eq(notifications.recipientId, me(req.actor))))
        .returning({ id: notifications.id });
      if (!n) throw notFound('Notification');
      return { ok: true as const };
    },
  });
}
