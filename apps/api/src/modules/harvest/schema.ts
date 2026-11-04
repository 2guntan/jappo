import { sql } from 'drizzle-orm';
import { bigint, date, index, jsonb, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stdCols, tstz } from '../../db/columns';
import { ackMethod } from '../operations/schema';

export const harvestStatus = pgEnum('harvest_delivery_status', ['recorded', 'dispatched', 'rejected', 'void']);
export const dispatchStatus = pgEnum('dispatch_status', ['in_transit', 'accepted', 'partially_accepted', 'rejected']);
export const buyerInvoiceStatus = pgEnum('buyer_invoice_status', ['issued', 'partially_paid', 'paid', 'overdue', 'disputed']);
export const escrowReceiptStatus = pgEnum('escrow_receipt_status', ['recorded', 'confirmed', 'rejected']);

export const harvestDeliveries = pgTable(
  'harvest_deliveries',
  {
    ...stdCols(),
    ownerOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    ticketNo: text().notNull(),
    seasonId: uuid().notNull(),
    plotId: uuid().notNull(),
    farmerId: uuid().notNull(),
    plantingId: uuid().notNull(),
    cropId: uuid().notNull(),
    deliveredAt: tstz('delivered_at').notNull(),
    grossKg: numeric({ precision: 14, scale: 3 }).notNull(),
    tareKg: numeric({ precision: 14, scale: 3 }).notNull().default('0'),
    netKg: numeric({ precision: 14, scale: 3 }).generatedAlwaysAs(sql`gross_kg - tare_kg`),
    moisturePct: numeric({ precision: 6, scale: 2 }),
    grade: text().notNull(),
    weighedByUserId: uuid(),
    photoFileId: uuid(),
    farmerAckMethod: ackMethod().notNull().default('none'),
    farmerAckAt: tstz('farmer_ack_at'),
    offlineClientId: text(),
    status: harvestStatus().notNull().default('recorded'),
    dispatchId: uuid(),
    voidReason: text(),
  },
  (t) => [uniqueIndex().on(t.blockId, t.ticketNo), index().on(t.seasonId, t.farmerId), uniqueIndex().on(t.ownerOrgId, t.offlineClientId)],
);

export const dispatches = pgTable(
  'dispatches',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    ownerOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    seasonId: uuid().notNull(),
    offtakeContractId: uuid().notNull(),
    buyerOrgId: uuid().notNull(),
    dispatchedAt: tstz('dispatched_at').notNull(),
    vehicle: text(),
    deliveryIds: uuid().array().notNull(),
    netKgTotal: numeric({ precision: 14, scale: 3 }).notNull(),
    buyerAcceptedKg: numeric({ precision: 14, scale: 3 }),
    buyerRejectedKg: numeric({ precision: 14, scale: 3 }),
    buyerAcceptedAt: tstz('buyer_accepted_at'),
    buyerComment: text(),
    status: dispatchStatus().notNull().default('in_transit'),
    invoiceId: uuid(),
  },
  (t) => [index().on(t.seasonId), index().on(t.buyerOrgId)],
);

export const buyerInvoices = pgTable(
  'buyer_invoices',
  {
    ...stdCols(),
    ref: text().notNull().unique(),
    ownerOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    seasonId: uuid().notNull(),
    offtakeContractId: uuid().notNull(),
    buyerOrgId: uuid().notNull(),
    dispatchIds: uuid().array().notNull(),
    acceptedKg: numeric({ precision: 14, scale: 3 }).notNull(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    lines: jsonb().notNull(),
    issuedAt: tstz('issued_at').notNull().defaultNow(),
    dueDate: date({ mode: 'string' }).notNull(),
    paidXof: bigint({ mode: 'number' }).notNull().default(0),
    status: buyerInvoiceStatus().notNull().default('issued'),
    disputeReason: text(),
    pdfFileId: uuid(),
  },
  (t) => [index().on(t.buyerOrgId), index().on(t.seasonId)],
);

export const escrowReceipts = pgTable(
  'escrow_receipts',
  {
    ...stdCols(),
    escrowAccountId: uuid().notNull(),
    lenderOrgId: uuid().notNull(),
    blockId: uuid().notNull(),
    seasonId: uuid(),
    amountXof: bigint({ mode: 'number' }).notNull(),
    valueDate: date({ mode: 'string' }).notNull(),
    payerOrgId: uuid().notNull(),
    bankReference: text().notNull(),
    buyerInvoiceId: uuid(),
    recordedBy: uuid(),
    recordedByOrgId: uuid().notNull(),
    confirmedByLenderAt: tstz('confirmed_by_lender_at'),
    confirmedBy: uuid(),
    proofFileId: uuid(),
    status: escrowReceiptStatus().notNull().default('recorded'),
    rejectReason: text(),
  },
  (t) => [index().on(t.blockId), index().on(t.escrowAccountId), uniqueIndex().on(t.escrowAccountId, t.bankReference)],
);
