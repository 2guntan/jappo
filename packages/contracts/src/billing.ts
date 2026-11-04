import { z } from 'zod';
import { IsoDate, IsoDateTime, Uuid, Xof } from './common';

export const Plan = z.object({ id: Uuid, code: z.string(), name: z.string(), orgTypes: z.array(z.string()), priceModel: z.enum(['per_ha_season', 'annual_seat', 'free']), unitPriceXof: Xof, structuringFeeBps: z.number().int(), includedSeats: z.number().int(), features: z.array(z.string()), active: z.boolean(), version: z.number().int() }).meta({ id: 'Plan' });
export const PlanUpdateBody = z.object({ name: z.string().min(2).max(100).optional(), unitPriceXof: Xof.min(0).optional(), structuringFeeBps: z.number().int().min(0).max(10_000).optional(), includedSeats: z.number().int().min(0).max(10_000).optional(), features: z.array(z.string().max(100)).max(30).optional(), active: z.boolean().optional() });
export const BillingSubscription = z
  .object({ subscription: z.object({ id: Uuid, startDate: IsoDate, endDate: IsoDate.nullable(), status: z.string(), plan: Plan }).nullable(), billingStatus: z.enum(['ok', 'overdue', 'restricted']) })
  .meta({ id: 'BillingSubscription' });
export const SubscribeBody = z.object({ planCode: z.string().min(2).max(50) });
export const PlatformInvoice = z
  .object({ id: Uuid, ref: z.string(), orgId: Uuid, periodStart: IsoDate, periodEnd: IsoDate, lines: z.array(z.object({ description: z.string(), qty: z.number(), unitPriceXof: z.number(), amountXof: Xof })), amountXof: Xof, taxXof: Xof, totalXof: Xof, status: z.enum(['draft', 'issued', 'paid', 'void']), issuedAt: IsoDateTime.nullable(), dueDate: IsoDate, hasPdf: z.boolean(), paidAt: IsoDateTime.nullable(), paymentReference: z.string().nullable(), version: z.number().int() })
  .meta({ id: 'PlatformInvoice' });
export const InvoiceAdminActionBody = z.object({ reference: z.string().max(100).optional(), reason: z.string().max(2000).optional() });

export const WebhookEndpoint = z.object({ id: Uuid, url: z.string(), eventTypes: z.array(z.string()), active: z.boolean(), createdAt: IsoDateTime }).meta({ id: 'WebhookEndpoint' });
export const WebhookCreateBody = z.object({ url: z.url().max(500), eventTypes: z.array(z.string().regex(/^(\*|[a-z_]+\.[a-z_]+)$/)).min(1).max(100) });
export const WebhookDelivery = z.object({ id: Uuid, eventId: Uuid, eventType: z.string(), status: z.enum(['pending', 'delivered', 'failed']), attempts: z.number().int(), lastStatusCode: z.number().int().nullable(), lastError: z.string().nullable(), nextAttemptAt: IsoDateTime.nullable(), deliveredAt: IsoDateTime.nullable(), createdAt: IsoDateTime }).meta({ id: 'WebhookDelivery' });
export const EventEnvelope = z.object({ id: Uuid, type: z.string(), version: z.number().int(), occurredAt: IsoDateTime, orgId: Uuid.nullable(), aggregate: z.object({ type: z.string(), id: z.string() }), actor: z.object({ type: z.string(), id: z.string().nullable() }), data: z.record(z.string(), z.unknown()) }).meta({ id: 'EventEnvelope' });
