import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { settings } from '../../core/schema';
import { ModuleNav } from '@jappo/contracts';
import type { JappoModule, ModuleContext } from '../../core/module';
import { hasPermission } from '../../core/authz/permissions';

export const Health = z.object({ status: z.literal('ok'), version: z.string(), time: z.string() });
export const Ready = z.object({ status: z.enum(['ready', 'not_ready']), checks: z.record(z.string(), z.boolean()) });
export const VERSION = '0.1.0';

export async function readinessChecks(ctx: ModuleContext): Promise<Record<string, boolean>> {
  const checks: Record<string, boolean> = {};
  try {
    await ctx.db.execute(sql`select 1`);
    checks.database = true;
  } catch {
    checks.database = false;
  }
  return checks;
}

export function systemRoutes(modules: () => JappoModule[]) {
  return async (app: FastifyInstance, ctx: ModuleContext) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.get('/health', {
      schema: { operationId: 'health', tags: ['system'], 'x-permission': 'public', response: { 200: Health } },
      handler: async () => ({ status: 'ok' as const, version: VERSION, time: new Date().toISOString() }),
    });
    r.get('/ready', {
      schema: { operationId: 'ready', tags: ['system'], 'x-permission': 'public', response: { 200: Ready, 503: Ready } },
      handler: async (_req, reply) => {
        const checks = await readinessChecks(ctx);
        const ok = Object.values(checks).every(Boolean);
        return reply.status(ok ? 200 : 503).send({ status: ok ? ('ready' as const) : ('not_ready' as const), checks });
      },
    });
    r.get('/legal/:doc', {
      schema: {
        operationId: 'getLegalText',
        tags: ['system'],
        summary: 'Terms of use / privacy text managed by the platform admin',
        'x-permission': 'public',
        params: z.object({ doc: z.enum(['terms', 'privacy']) }),
        response: { 200: z.object({ doc: z.string(), text: z.string() }) },
      },
      handler: async (req) => {
        const [row] = await ctx.db.select().from(settings).where(eq(settings.key, `legal.${req.params.doc}_text`));
        return { doc: req.params.doc, text: typeof row?.value === 'string' ? row.value : '' };
      },
    });
    r.get('/modules', {
      schema: {
        operationId: 'listModules',
        tags: ['system'],
        summary: 'Active modules and navigation entries for the current organisation (SPEC §11.3)',
        'x-permission': 'authenticated',
        response: { 200: z.object({ data: z.array(ModuleNav) }) },
      },
      handler: async (req) => {
        const a = req.actor;
        const data = modules()
          .filter((m) => m.ui && (!a.orgType || m.ui.workspace.includes(a.orgType)))
          .map((m) => ({
            name: m.name,
            version: m.version,
            navItems: (m.ui?.navItems ?? []).filter((n) => !n.permission || hasPermission(a.permissions, n.permission)),
          }))
          .filter((m) => m.navItems.length > 0);
        return { data };
      },
    });
  };
}
