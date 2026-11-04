import type { JappoModule } from '../core/module';
import { validateModules } from '../core/module';
import { identityRoutes } from './identity/routes';
import { adminRoutes } from './admin/routes';
import { fileRoutes } from './files/routes';
import { notificationRoutes } from './notifications/routes';
import { systemRoutes } from './system/routes';

const ALL = ['platform', 'operator', 'lender', 'buyer', 'guarantor', 'insurer', 'supplier', 'farmer_group'] as const;

/** Module registry (SPEC §11.3). Order is resolved from `dependsOn`. */
export const MODULES: JappoModule[] = validateModules([
  { name: 'system', version: '1.0.0', core: true, routes: systemRoutes(() => MODULES) },
  { name: 'files', version: '1.0.0', core: true, routes: fileRoutes },
  { name: 'notifications', version: '1.0.0', core: true, routes: notificationRoutes },
  {
    name: 'identity',
    version: '1.0.0',
    core: true,
    dependsOn: ['files', 'notifications'],
    routes: identityRoutes,
    ui: {
      workspace: [...ALL],
      navItems: [
        { key: 'home', href: '/app', labelKey: 'nav.home' },
        { key: 'settings', href: '/app/settings/organization', labelKey: 'nav.settings', permission: 'org:read' },
      ],
    },
  },
  {
    name: 'admin',
    version: '1.0.0',
    core: true,
    dependsOn: ['identity'],
    routes: adminRoutes,
    ui: {
      workspace: ['platform'],
      navItems: [
        { key: 'admin-kyc', href: '/app/admin/kyc', labelKey: 'nav.adminKyc', permission: 'admin:read' },
        { key: 'admin-audit', href: '/app/admin/audit', labelKey: 'nav.adminAudit', permission: 'admin:read' },
      ],
    },
  },
]);
