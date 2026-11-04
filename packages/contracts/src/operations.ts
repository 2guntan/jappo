import { z } from 'zod';
import { AllowedActions, IsoDate, IsoDateTime, Uuid, Xof } from './common';
import { GeoPoint } from './geo';

const Ack = z.enum(['otp', 'signature_photo', 'none']);
export const CROP_STAGES = ['land_prep', 'sowing', 'emergence', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested', 'failed'] as const;
export const VISIT_ISSUES = ['pest', 'disease', 'water_stress', 'flood', 'weeds', 'theft', 'livestock_damage', 'labour_shortage', 'input_missing', 'other'] as const;

export const ServiceDelivery = z
  .object({ id: Uuid, seasonId: Uuid, budgetLineId: Uuid, serviceLabel: z.string(), plotId: Uuid.nullable(), farmerId: Uuid.nullable(), qty: z.number(), unit: z.string(), deliveredAt: IsoDateTime, supplierName: z.string().nullable(), deliveredByUserId: Uuid.nullable(), photoFileId: Uuid.nullable(), farmerAckMethod: Ack, farmerAckAt: IsoDateTime.nullable(), createdAt: IsoDateTime })
  .meta({ id: 'ServiceDelivery' });
export const ServiceDeliveryCreateBody = z.object({
  budgetLineId: Uuid,
  plotId: Uuid.nullish(),
  farmerId: Uuid.nullish(),
  qty: z.number().positive().max(1e9),
  deliveredAt: IsoDateTime.optional(),
  supplierName: z.string().max(200).nullish(),
  photoFileId: Uuid.nullish(),
  farmerAckMethod: Ack.optional(),
  ackCode: z.string().regex(/^\d{6}$/).optional(),
  geo: GeoPoint.nullish(),
  offlineClientId: z.string().min(8).max(100).nullish(),
});

export const FieldVisit = z
  .object({ id: Uuid, plotId: Uuid, plantingId: Uuid.nullable(), agentUserId: Uuid.nullable(), visitedAt: IsoDateTime, geo: GeoPoint.nullable(), cropStage: z.enum(CROP_STAGES), healthScore: z.number().int(), estimatedYieldTHa: z.number().nullable(), issues: z.array(z.string()), notes: z.string().nullable(), photoFileIds: z.array(Uuid), createdAt: IsoDateTime })
  .meta({ id: 'FieldVisit' });
export const FieldVisitCreateBody = z.object({
  visitedAt: IsoDateTime.optional(),
  geo: GeoPoint.nullish(),
  cropStage: z.enum(CROP_STAGES),
  healthScore: z.number().int().min(1).max(5),
  estimatedYieldTHa: z.number().min(0).max(500).nullish(),
  issues: z.array(z.enum(VISIT_ISSUES)).max(10).optional(),
  notes: z.string().max(5000).nullish(),
  photoFileIds: z.array(Uuid).max(10).optional(),
  offlineClientId: z.string().min(8).max(100).nullish(),
});

export const Alert = z
  .object({ id: Uuid, blockId: Uuid, seasonId: Uuid.nullable(), type: z.string(), severity: z.enum(['info', 'warning', 'critical']), source: z.enum(['rule', 'manual']), ruleCode: z.string().nullable(), message: z.string(), data: z.record(z.string(), z.unknown()), status: z.enum(['open', 'acknowledged', 'resolved']), acknowledgedBy: Uuid.nullable(), acknowledgedAt: IsoDateTime.nullable(), resolvedAt: IsoDateTime.nullable(), resolutionNote: z.string().nullable(), createdAt: IsoDateTime, version: z.number().int() })
  .meta({ id: 'Alert' });
export const AlertCreateBody = z.object({ severity: z.enum(['info', 'warning', 'critical']), type: z.string().min(2).max(50), message: z.string().min(3).max(2000), seasonId: Uuid.nullish() });
export const AlertActionBody = z.object({ note: z.string().max(2000).optional() });
export const AlertRule = z.object({ code: z.string(), enabled: z.boolean(), params: z.record(z.string(), z.number()), description: z.string(), version: z.number().int() }).meta({ id: 'AlertRule' });
export const AlertRuleUpdateBody = z.object({ enabled: z.boolean().optional(), params: z.record(z.string(), z.number().min(0).max(10_000)).optional() });

export const HarvestDelivery = z
  .object({ id: Uuid, ticketNo: z.string(), seasonId: Uuid, plotId: Uuid, plotCode: z.string(), farmerId: Uuid, farmerCode: z.string(), plantingId: Uuid, cropId: Uuid, deliveredAt: IsoDateTime, grossKg: z.number(), tareKg: z.number(), netKg: z.number(), moisturePct: z.number().nullable(), grade: z.string(), photoFileId: Uuid.nullable(), farmerAckMethod: Ack, farmerAckAt: IsoDateTime.nullable(), status: z.enum(['recorded', 'dispatched', 'rejected', 'void']), dispatchId: Uuid.nullable(), voidReason: z.string().nullable(), version: z.number().int() })
  .meta({ id: 'HarvestDelivery' });
export const HarvestDeliveryCreateBody = z.object({
  plotId: Uuid,
  farmerId: Uuid,
  deliveredAt: IsoDateTime.optional(),
  grossKg: z.number().positive().max(1e7),
  tareKg: z.number().min(0).max(1e7).optional(),
  moisturePct: z.number().min(0).max(100).nullish(),
  grade: z.string().min(1).max(20),
  photoFileId: Uuid.nullish(),
  farmerAckMethod: Ack.optional(),
  ackCode: z.string().regex(/^\d{6}$/).optional(),
  offlineClientId: z.string().min(8).max(100).nullish(),
});
export const VoidBody = z.object({ reason: z.string().min(3).max(2000) });

export const Dispatch = z
  .object({ id: Uuid, ref: z.string(), seasonId: Uuid, blockId: Uuid, blockRef: z.string(), offtakeContractId: Uuid, offtakeRef: z.string(), buyerOrgId: Uuid, buyerName: z.string(), dispatchedAt: IsoDateTime, vehicle: z.string().nullable(), deliveryIds: z.array(Uuid), netKgTotal: z.number(), buyerAcceptedKg: z.number().nullable(), buyerRejectedKg: z.number().nullable(), buyerAcceptedAt: IsoDateTime.nullable(), buyerComment: z.string().nullable(), status: z.enum(['in_transit', 'accepted', 'partially_accepted', 'rejected']), invoiceId: Uuid.nullable(), version: z.number().int(), allowedActions: AllowedActions })
  .meta({ id: 'Dispatch' });
export const DispatchCreateBody = z.object({ offtakeContractId: Uuid, deliveryIds: z.array(Uuid).min(1).max(2000), vehicle: z.string().max(100).nullish(), dispatchedAt: IsoDateTime.optional() });
export const DispatchAcceptBody = z.object({ acceptedKg: z.number().min(0).max(1e8), rejectedKg: z.number().min(0).max(1e8), comment: z.string().max(2000).nullish() });

export const BuyerInvoice = z
  .object({
    id: Uuid,
    ref: z.string(),
    blockId: Uuid,
    blockRef: z.string(),
    seasonId: Uuid,
    offtakeContractId: Uuid,
    offtakeRef: z.string(),
    buyerOrgId: Uuid,
    buyerName: z.string(),
    dispatchIds: z.array(Uuid),
    acceptedKg: z.number(),
    amountXof: Xof,
    paidXof: Xof,
    outstandingXof: Xof,
    lines: z.array(z.object({ grade: z.string(), acceptedKg: z.number(), adjustmentPct: z.number(), unitPriceXof: z.number(), amountXof: Xof })),
    issuedAt: IsoDateTime,
    dueDate: IsoDate,
    status: z.enum(['issued', 'partially_paid', 'paid', 'overdue', 'disputed']),
    hasPdf: z.boolean(),
    version: z.number().int(),
    allowedActions: AllowedActions,
  })
  .meta({ id: 'BuyerInvoice' });
export const BuyerInvoiceCreateBody = z.object({ dispatchIds: z.array(Uuid).min(1).max(200) });

export const EscrowReceipt = z
  .object({ id: Uuid, escrowAccountId: Uuid, lenderOrgId: Uuid, blockId: Uuid, seasonId: Uuid.nullable(), amountXof: Xof, valueDate: IsoDate, payerOrgId: Uuid, payerName: z.string(), bankReference: z.string(), buyerInvoiceId: Uuid.nullable(), invoiceRef: z.string().nullable(), recordedByOrgId: Uuid, confirmedByLenderAt: IsoDateTime.nullable(), proofFileId: Uuid.nullable(), status: z.enum(['recorded', 'confirmed', 'rejected']), rejectReason: z.string().nullable(), createdAt: IsoDateTime, version: z.number().int(), allowedActions: AllowedActions })
  .meta({ id: 'EscrowReceipt' });
export const EscrowReceiptCreateBody = z.object({ escrowAccountId: Uuid, amountXof: Xof.min(1), valueDate: IsoDate, bankReference: z.string().min(3).max(100), buyerInvoiceId: Uuid.nullish(), payerOrgId: Uuid.nullish(), proofFileId: Uuid.nullish() });
export const ReceiptActionBody = z.object({ reason: z.string().max(2000).optional() });
