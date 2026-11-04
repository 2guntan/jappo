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
import { financeRoutes } from './finance/routes';
import { dossierRoutes } from './dossier/routes';
import { renderDossierPdf } from './dossier/pdf';
import { marketplaceRoutes } from './marketplace/routes';
import { runDeadlines } from './marketplace/rfp';
import { agreementRoutes } from './agreements/routes';
import { facilityRoutes } from './facilities/routes';
import { hasConfirmedDisbursement, runArrears } from './facilities/service';
import { seasonStartGuards } from './planning/routes';
import { operationsRoutes } from './operations/routes';
import { runAlerts } from './operations/service';
import { harvestRoutes } from './harvest/routes';
import { settlementRoutes } from './settlement/routes';
import { monitoringRoutes } from './monitoring/routes';
import { snapshotKpis } from './monitoring/service';
import { billingRoutes } from './billing/routes';
import { adminConsoleRoutes } from './admin/console';
import { deliverWebhooks, onAwardAccepted, onSeasonStarted, queueWebhooks, runBilling } from './billing/service';

// Season start guard (SPEC §8.2) is provided by the facilities module.
seasonStartGuards.hasConfirmedDisbursement = (tx, seasonId) => hasConfirmedDisbursement(tx, seasonId);

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
        { key: 'admin-alert-rules', href: '/app/admin/alert-rules', labelKey: 'nav.adminAlertRules', permission: 'alert_rule:manage' },
        { key: 'admin-console', href: '/app/admin/console', labelKey: 'nav.adminConsole', permission: 'settings:manage' },
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
  { name: 'finance', version: '1.0.0', core: true, dependsOn: ['planning'], routes: financeRoutes },
  {
    name: 'dossier',
    version: '1.0.0',
    core: true,
    dependsOn: ['finance', 'offtake'],
    routes: dossierRoutes,
    eventHandlers: { 'dossier.frozen': async (e, ctx) => void (await renderDossierPdf(ctx, e.aggregate.id)) },
  },
  {
    name: 'marketplace',
    version: '1.0.0',
    core: true,
    dependsOn: ['dossier'],
    routes: marketplaceRoutes,
    jobs: [{ name: 'rfp.deadlines', cron: '* * * * *', handler: async (ctx) => void (await runDeadlines(ctx.db)) }],
    ui: {
      workspace: ['operator', 'lender'],
      navItems: [
        { key: 'opportunities', href: '/app/lender/opportunities', labelKey: 'nav.opportunities', permission: 'bid:draft' },
        { key: 'awards', href: '/app/lender/awards', labelKey: 'nav.awards', permission: 'award:respond' },
        { key: 'profiles', href: '/app/lender/profiles', labelKey: 'nav.profiles', permission: 'lender_profile:manage' },
        { key: 'financing', href: '/app/financing', labelKey: 'nav.financing', permission: 'financing_request:manage' },
      ],
    },
  },
  {
    name: 'agreements',
    version: '1.0.0',
    core: true,
    dependsOn: ['marketplace'],
    routes: agreementRoutes,
    ui: {
      workspace: ['operator', 'lender', 'buyer'],
      navItems: [{ key: 'contracts', href: '/app/contracts', labelKey: 'nav.contracts', permission: 'contract:read' }],
    },
  },
  {
    name: 'facilities',
    version: '1.0.0',
    core: true,
    dependsOn: ['agreements'],
    routes: facilityRoutes,
    jobs: [{ name: 'facilities.arrears', cron: '15 0 * * *', handler: async (ctx) => void (await runArrears(ctx.db)) }],
    ui: {
      workspace: ['operator', 'lender'],
      navItems: [{ key: 'facilities', href: '/app/facilities', labelKey: 'nav.facilities', permission: 'facility:read' }],
    },
  },
  {
    name: 'operations',
    version: '1.0.0',
    core: true,
    dependsOn: ['facilities'],
    routes: operationsRoutes,
    jobs: [{ name: 'alerts.evaluate', cron: '30 1 * * *', handler: async (ctx) => void (await runAlerts(ctx.db)) }],
    ui: { workspace: ['operator', 'lender'], navItems: [] },
  },
  {
    name: 'harvest',
    version: '1.0.0',
    core: true,
    dependsOn: ['operations'],
    routes: harvestRoutes,
    ui: {
      workspace: ['buyer'],
      navItems: [
        { key: 'buyer-dispatches', href: '/app/buyer/dispatches', labelKey: 'nav.buyerDispatches', permission: 'dispatch:accept' },
        { key: 'buyer-invoices', href: '/app/buyer/invoices', labelKey: 'nav.buyerInvoices', permission: 'dispatch:accept' },
      ],
    },
  },
  {
    name: 'settlement',
    version: '1.0.0',
    core: true,
    dependsOn: ['harvest'],
    routes: settlementRoutes,
    ui: {
      workspace: ['operator', 'lender'],
      navItems: [{ key: 'settlements', href: '/app/settlements', labelKey: 'nav.settlements', permission: 'settlement:read' }],
    },
  },
  {
    name: 'monitoring',
    version: '1.0.0',
    core: true,
    dependsOn: ['settlement'],
    routes: monitoringRoutes,
    jobs: [{ name: 'kpis.snapshot', cron: '0 2 * * *', handler: async (ctx) => void (await snapshotKpis(ctx.db)) }],
    ui: {
      workspace: ['operator', 'lender', 'guarantor', 'insurer'],
      navItems: [{ key: 'reports', href: '/app/reports', labelKey: 'nav.reports', permission: 'report:read' }],
    },
  },
  {
    // Guarantor / insurer workspace (SPEC §12.6); API routes live in `monitoring`.
    name: 'guarantor-portfolio',
    version: '1.0.0',
    core: true,
    dependsOn: ['monitoring'],
    ui: { workspace: ['guarantor', 'insurer'], navItems: [{ key: 'portfolio', href: '/app/guarantor', labelKey: 'nav.guarantor', permission: 'kpi:read' }] },
  },
  {
    name: 'billing',
    version: '1.0.0',
    core: true,
    dependsOn: ['marketplace', 'planning'],
    routes: async (app, ctx) => {
      await billingRoutes(app, ctx);
      await adminConsoleRoutes(app, ctx);
    },
    eventHandlers: {
      'season.started': (e, ctx) => onSeasonStarted(ctx, e),
      'award.accepted': (e, ctx) => onAwardAccepted(ctx, e),
      '*': (e, ctx) => queueWebhooks(ctx, e),
    },
    jobs: [
      { name: 'billing.daily', cron: '45 3 * * *', handler: async (ctx) => void (await runBilling(ctx)) },
      { name: 'webhooks.deliver', cron: '* * * * *', handler: async (ctx) => void (await deliverWebhooks(ctx)) },
    ],
    ui: {
      workspace: ['operator', 'lender', 'buyer', 'guarantor', 'insurer', 'platform'],
      navItems: [
        { key: 'billing', href: '/app/settings/billing', labelKey: 'nav.billing', permission: 'billing:read' },
        { key: 'webhooks', href: '/app/settings/webhooks', labelKey: 'nav.webhooks', permission: 'webhook:manage' },
        { key: 'admin-billing', href: '/app/admin/billing', labelKey: 'nav.adminBilling', permission: 'invoice:manage' },
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
