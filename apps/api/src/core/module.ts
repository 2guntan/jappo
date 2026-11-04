import type { FastifyInstance } from 'fastify';
import type { OrgType, Role } from '@jappo/contracts';
import type { Db } from '../db/client';
import type { Env } from '../env';
import type { Storage } from './files/storage';
import type { SmsAdapter } from './adapters/sms';
import type { EmailAdapter } from './adapters/email';
import type { DomainEvent } from './events';

export interface ModuleContext {
  db: Db;
  env: Env;
  storage: Storage;
  sms: SmsAdapter;
  email: EmailAdapter;
}

export interface PermissionDef {
  permission: string;
  roles: Role[];
}
export interface NavItemDef {
  key: string;
  href: string;
  labelKey: string;
  permission?: string;
}
export interface JobDef {
  name: string;
  /** cron expression (UTC) for scheduled jobs; omitted for on-demand jobs */
  cron?: string;
  handler: (ctx: ModuleContext, data: unknown) => Promise<void>;
}

/** Extension framework contract (SPEC §11.3). */
export interface JappoModule {
  name: string;
  version: string;
  dependsOn?: string[];
  core?: boolean;
  permissions?: PermissionDef[];
  routes?: (app: FastifyInstance, ctx: ModuleContext) => Promise<void>;
  eventHandlers?: Record<string, (event: DomainEvent, ctx: ModuleContext) => Promise<void>>;
  jobs?: JobDef[];
  ui?: { navItems: NavItemDef[]; workspace: OrgType[] };
  featureFlag?: string;
}

/** Validate dependencies: all present, acyclic, core modules never depend on extensions. */
export function validateModules(mods: JappoModule[]): JappoModule[] {
  const byName = new Map(mods.map((m) => [m.name, m]));
  for (const m of mods) {
    for (const d of m.dependsOn ?? []) {
      const dep = byName.get(d);
      if (!dep) throw new Error(`Module ${m.name} depends on missing module ${d}`);
      if (m.core && !dep.core) throw new Error(`Core module ${m.name} may not depend on extension ${d}`);
    }
  }
  const order: JappoModule[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (m: JappoModule) => {
    const s = state.get(m.name);
    if (s === 'done') return;
    if (s === 'visiting') throw new Error(`Module dependency cycle at ${m.name}`);
    state.set(m.name, 'visiting');
    for (const d of m.dependsOn ?? []) visit(byName.get(d)!);
    state.set(m.name, 'done');
    order.push(m);
  };
  mods.forEach(visit);
  return order;
}
