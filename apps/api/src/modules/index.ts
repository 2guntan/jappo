import type { JappoModule } from '../core/module';
import { validateModules } from '../core/module';
import { identityRoutes } from './identity/routes';
import { adminRoutes } from './admin/routes';
import { fileRoutes } from './files/routes';
import { notificationRoutes } from './notifications/routes';
import { systemRoutes } from './system/routes';
import { farmerRoutes } from './farmers/routes';
import { landRoutes } from './land/routes';
import { fieldRoutes } from './field/routes';
import { catalogueRoutes } from './catalogue/routes';
import { planningRoutes } from './planning/routes';
import { offtakeRoutes } from './offtake/routes';

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
  {
    name: 'farmers',
    version: '1.0.0',
    core: true,
    dependsOn: ['identity'],
    routes: farmerRoutes,
    ui: { workspace: ['operator'], navItems: [{ key: 'farmers', href: '/app/farmers', labelKey: 'nav.farmers', permission: 'farmer:read' }] },
  },
  {
    name: 'land',
    version: '1.0.0',
    core: true,
    dependsOn: ['farmers', 'files'],
    routes: landRoutes,
    ui: { workspace: ['operator', 'lender', 'guarantor', 'insurer', 'platform'], navItems: [{ key: 'blocks', href: '/app/blocks', labelKey: 'nav.blocks', permission: 'block:read' }] },
  },
  {
    name: 'admin-land',
    version: '1.0.0',
    core: true,
    dependsOn: ['land'],
    ui: { workspace: ['platform'], navItems: [{ key: 'admin-land', href: '/app/admin/land-documents', labelKey: 'nav.adminLand', permission: 'admin:read' }] },
  },
  {
    name: 'catalogue',
    version: '1.0.0',
    core: true,
    dependsOn: ['identity'],
    routes: catalogueRoutes,
    ui: { workspace: ['operator', 'platform'], navItems: [{ key: 'catalogue', href: '/app/catalogue', labelKey: 'nav.catalogue', permission: 'catalogue:read' }] },
  },
  {
    name: 'planning',
    version: '1.0.0',
    core: true,
    dependsOn: ['land', 'catalogue'],
    routes: planningRoutes,
    ui: { workspace: ['operator'], navItems: [{ key: 'quotes', href: '/app/quotes', labelKey: 'nav.quotes', permission: 'quote:read' }] },
  },
  {
    name: 'offtake',
    version: '1.0.0',
    core: true,
    dependsOn: ['land', 'catalogue'],
    routes: offtakeRoutes,
    ui: {
      workspace: ['operator', 'buyer'],
      navItems: [
        { key: 'offtake', href: '/app/offtake', labelKey: 'nav.offtake', permission: 'offtake:manage' },
        { key: 'buyer-contracts', href: '/app/buyer/contracts', labelKey: 'nav.buyerContracts', permission: 'dispatch:accept' },
      ],
    },
  },
  {
    name: 'field',
    version: '1.0.0',
    core: true,
    dependsOn: ['land'],
    routes: fieldRoutes,
    ui: { workspace: ['operator'], navItems: [{ key: 'field', href: '/field', labelKey: 'nav.field', permission: 'field:sync' }] },
  },
]);
