import { and, asc, desc, eq, gt, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { canonicalJson, contractMachine, formatXof, sha256Hex, transition, upfrontFeeXof } from '@jappo/domain';
import { renderContractBody, renderContractHtml, type ContractCode } from '@jappo/templates';
import type { Db, DbOrTx } from '../../db/client';
import { contractParties, contracts, contractTemplates, signatures } from './schema';
import { escrowAccounts, facilities, facilityFarmerAllocations, scheduleLines } from '../facilities/schema';
import { awards, bids, tranches } from '../marketplace/schema';
import { memberships, organizations, otpCodes, users } from '../identity/schema';
import { farmers } from '../farmers/schema';
import { blocks, plotAllocations, plots } from '../land/schema';
import { plantings, seasons } from '../planning/schema';
import { offtakeContracts } from '../offtake/schema';
import { crops } from '../catalogue/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { badRequest, conflict, notFound, tooMany, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { grant } from '../../core/authz/visibility';
import { assertVersion } from '../../core/etag';
import { notify } from '../../core/notify';
import { geomFromGeoJson } from '../../core/geo';
import { randomDigits, sha256 } from '../../core/crypto';
import { consumeOtp } from '../identity/service';
import { storeFile, getVisibleFile } from '../files/service';
import { pdfRenderer } from '../../core/adapters/pdf';
import type { ModuleContext } from '../../core/module';
import { env } from '../../env';

type ContractRow = typeof contracts.$inferSelect;
type PartyRow = typeof contractParties.$inferSelect;
type TemplateRow = typeof contractTemplates.$inferSelect;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const link = (path: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}${path}`;
const OTP_TTL_MS = 10 * 60_000;
const OTP_WINDOW_MS = 10 * 60_000;
const OTP_MAX_PER_WINDOW = 5;
const OTP_MAX_PER_IDENTIFIER = 30;

export const CONTRACT_TYPES = ['block_framework', 'plot_production', 'offtake', 'loan_seasonal', 'loan_investment', 'escrow_mandate'] as const satisfies readonly ContractCode[];
export type ContractType = (typeof CONTRACT_TYPES)[number];
/** Which entity each contract type is generated from. */
export const RELATED_TYPE: Record<ContractType, 'season' | 'farmer' | 'offtake_contract' | 'facility'> = {
  block_framework: 'season',
  escrow_mandate: 'season',
  plot_production: 'farmer',
  offtake: 'offtake_contract',
  loan_seasonal: 'facility',
  loan_investment: 'facility',
};

// ---------------------------------------------------------------- templates

export async function listTemplates(db: DbOrTx, opts: { code?: string; locale?: string; includeInactive?: boolean } = {}) {
  const conds = [];
  if (opts.code) conds.push(eq(contractTemplates.code, opts.code));
  if (opts.locale) conds.push(eq(contractTemplates.locale, opts.locale));
  if (!opts.includeInactive) conds.push(eq(contractTemplates.active, true));
  const rows = await db.select().from(contractTemplates).where(conds.length ? and(...conds) : undefined).orderBy(asc(contractTemplates.code), asc(contractTemplates.locale), desc(contractTemplates.templateVersion));
  return rows.map(templateDto);
}

export const templateDto = (t: TemplateRow) => ({
  id: t.id,
  code: t.code as ContractType,
  locale: t.locale,
  templateVersion: t.templateVersion,
  title: t.title,
  bodyHbs: t.bodyHbs,
  variablesSchema: t.variablesSchema,
  active: t.active,
  updatedAt: t.updatedAt.toISOString(),
  version: t.version,
});

/** Admin edit: a new template version is created and becomes the active one (existing contracts keep theirs). */
export async function reviseTemplate(db: Db, actor: ActorContext, id: string, expected: number, body: { title?: string; bodyHbs?: string; variablesSchema?: TemplateRow['variablesSchema'] }) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(contractTemplates).where(eq(contractTemplates.id, id)).for('update');
    if (!t) throw notFound('Contract template');
    assertVersion(t.version, expected);
    try {
      renderContractBody(body.bodyHbs ?? t.bodyHbs, {}, t.locale);
    } catch (e) {
      throw badRequest('TEMPLATE_INVALID', `Template does not compile: ${(e as Error).message}`, [{ path: 'body.bodyHbs', message: 'invalid Handlebars' }]);
    }
    const [{ maxV } = { maxV: t.templateVersion }] = await tx.select({ maxV: sql<number>`max(${contractTemplates.templateVersion})::int` }).from(contractTemplates).where(and(eq(contractTemplates.code, t.code), eq(contractTemplates.locale, t.locale)));
    await tx.update(contractTemplates).set({ active: false }).where(and(eq(contractTemplates.code, t.code), eq(contractTemplates.locale, t.locale)));
    const [n] = await tx
      .insert(contractTemplates)
      .values({ code: t.code, locale: t.locale, templateVersion: maxV + 1, title: body.title ?? t.title, bodyHbs: body.bodyHbs ?? t.bodyHbs, variablesSchema: body.variablesSchema ?? t.variablesSchema, active: true, createdBy: actorUserId(actor) })
      .returning();
    await audit(tx, actor, { action: 'contract_template.revised', resourceType: 'contract_template', resourceId: n!.id, before: { id: t.id, templateVersion: t.templateVersion }, after: { templateVersion: n!.templateVersion } });
    return templateDto(n!);
  });
}

async function activeTemplate(tx: DbOrTx, code: string, locale: string): Promise<TemplateRow> {
  for (const loc of [locale, 'fr']) {
    const [t] = await tx.select().from(contractTemplates).where(and(eq(contractTemplates.code, code), eq(contractTemplates.locale, loc), eq(contractTemplates.active, true))).orderBy(desc(contractTemplates.templateVersion)).limit(1);
    if (t) return t;
  }
  throw unprocessable('TEMPLATE_MISSING', `No active ${code} template`);
}

// ---------------------------------------------------------------- data assembly (SPEC §10.10)

interface PartySpec {
  partyType: 'org' | 'farmer';
  orgId?: string;
  farmerId?: string;
  roleLabel: string;
  signOrder: number;
}

const orgView = (o: typeof organizations.$inferSelect | undefined) => ({ legalName: o?.legalName ?? '—', ninea: o?.ninea ?? '—', rccm: o?.rccm ?? '—', address: o?.address ?? '—' });
const ROLE_LABELS: Record<string, { fr: string; en: string }> = {
  operator: { fr: 'Opérateur', en: 'Operator' },
  lender: { fr: 'Prêteur', en: 'Lender' },
  buyer: { fr: 'Acheteur', en: 'Buyer' },
  farmer: { fr: 'Producteur', en: 'Farmer' },
  borrower: { fr: 'Emprunteur', en: 'Borrower' },
};
const roleLabel = (k: keyof typeof ROLE_LABELS, locale: string) => (locale === 'en' ? ROLE_LABELS[k]!.en : ROLE_LABELS[k]!.fr);

async function orgsById(tx: DbOrTx, ids: string[]) {
  const rows = ids.length ? await tx.select().from(organizations).where(inArray(organizations.id, [...new Set(ids)])) : [];
  return new Map(rows.map((o) => [o.id, o]));
}

/** Lenders with an accepted award on the season, with their facility amount. */
async function seasonLenders(tx: DbOrTx, seasonId: string) {
  const rows = await tx
    .select({ lenderOrgId: facilities.lenderOrgId, principalXof: facilities.principalXof })
    .from(facilities)
    .where(and(eq(facilities.seasonId, seasonId), notInArray(facilities.status, ['repaid', 'defaulted'])));
  const sum = new Map<string, number>();
  for (const r of rows) sum.set(r.lenderOrgId, (sum.get(r.lenderOrgId) ?? 0) + r.principalXof);
  return [...sum.entries()].map(([orgId, amountXof]) => ({ orgId, amountXof }));
}

async function seasonBuyers(tx: DbOrTx, blockId: string, seasonId: string) {
  const rows = await tx
    .select({ buyerOrgId: offtakeContracts.buyerOrgId })
    .from(offtakeContracts)
    .where(and(eq(offtakeContracts.blockId, blockId), notInArray(offtakeContracts.status, ['terminated', 'expired']), sql`(${offtakeContracts.seasonId} is null or ${offtakeContracts.seasonId} = ${seasonId})`));
  return [...new Set(rows.map((r) => r.buyerOrgId))];
}

async function blockEscrow(tx: DbOrTx, blockId: string) {
  const [e] = await tx.select().from(escrowAccounts).where(and(eq(escrowAccounts.blockId, blockId), eq(escrowAccounts.status, 'active'))).orderBy(asc(escrowAccounts.createdAt)).limit(1);
  return e ? { bankName: e.bankName, accountLabel: e.accountLabel, accountNumberMasked: e.accountNumberMasked } : null;
}

interface Assembled {
  blockId: string;
  seasonId: string | null;
  ownerOrgId: string;
  data: Record<string, unknown>;
  parties: PartySpec[];
}

export async function assemble(tx: DbOrTx, type: ContractType, relatedId: string, ownerOrgId: string, locale: string, seasonIdHint?: string | null): Promise<Assembled> {
  const today = new Date().toISOString().slice(0, 10);
  const loadSeason = async (id: string) => {
    const [s] = await tx.select().from(seasons).where(eq(seasons.id, id));
    if (!s || s.ownerOrgId !== ownerOrgId) throw notFound('Season');
    return s;
  };
  const loadBlock = async (id: string) => {
    const [b] = await tx.select().from(blocks).where(eq(blocks.id, id));
    if (!b || b.ownerOrgId !== ownerOrgId) throw notFound('Block');
    return b;
  };
  const blockView = (b: typeof blocks.$inferSelect) => ({ ref: b.ref, name: b.name, areaHa: Number(b.areaHa ?? 0), region: b.region, commune: b.commune ?? b.village ?? '—' });
  const seasonView = (s: typeof seasons.$inferSelect) => ({ code: s.name, startDate: s.startDate, endDate: s.endDate });
  const clauses = { disputeResolution: locale === 'en' ? 'Disputes are settled by arbitration under the OHADA Uniform Act, at the CCJA (Abidjan).' : "Les différends sont réglés par arbitrage selon l'Acte uniforme OHADA, devant la CCJA (Abidjan).", specialConditions: '' };

  if (type === 'block_framework' || type === 'escrow_mandate') {
    const s = await loadSeason(relatedId);
    const b = await loadBlock(s.blockId);
    const lenders = await seasonLenders(tx, s.id);
    const buyers = await seasonBuyers(tx, b.id, s.id);
    const orgs = await orgsById(tx, [ownerOrgId, ...lenders.map((l) => l.orgId), ...buyers]);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(distinct ${plotAllocations.farmerId})::int` }).from(plotAllocations).where(and(eq(plotAllocations.blockId, b.id), eq(plotAllocations.status, 'active')));
    const waterfall =
      locale === 'en'
        ? ['Escrow and platform fees', 'Seasonal lenders: interest then principal', 'Operator service fees', 'Investment lenders: due instalments', 'Solidarity contribution', 'Net payout to farmers']
        : ['Frais de séquestre et de plateforme', 'Prêteurs de campagne : intérêts puis principal', "Frais de services de l'opérateur", "Prêteurs d'investissement : échéances dues", 'Contribution de solidarité', 'Paiement net aux producteurs'];
    const parties: PartySpec[] = [{ partyType: 'org', orgId: ownerOrgId, roleLabel: roleLabel('operator', locale), signOrder: 1 }];
    if (type === 'escrow_mandate') for (const bo of buyers) parties.push({ partyType: 'org', orgId: bo, roleLabel: roleLabel('buyer', locale), signOrder: 1 });
    for (const l of lenders) parties.push({ partyType: 'org', orgId: l.orgId, roleLabel: roleLabel('lender', locale), signOrder: 2 });
    if (type === 'block_framework') for (const bo of buyers) parties.push({ partyType: 'org', orgId: bo, roleLabel: roleLabel('buyer', locale), signOrder: 2 });
    if (!lenders.length) throw unprocessable('NO_FACILITY', 'The season has no facility yet: accept an award first');
    return {
      blockId: b.id,
      seasonId: s.id,
      ownerOrgId,
      parties,
      data: {
        date: today,
        block: blockView(b),
        season: seasonView(s),
        operator: orgView(orgs.get(ownerOrgId)),
        lenders: lenders.map((l) => ({ legalName: orgs.get(l.orgId)?.legalName ?? '—', amountXof: l.amountXof })),
        buyers: buyers.map((id) => ({ legalName: orgs.get(id)?.legalName ?? '—' })),
        escrow: await blockEscrow(tx, b.id),
        waterfall,
        solidarity: { mode: b.solidarityMode, capPct: b.solidarityMode === 'group' ? Number(b.solidarityCapPct) : null },
        reportingFrequency: locale === 'en' ? 'monthly' : 'mensuel',
        farmerCount: n,
        clauses,
      },
    };
  }

  if (type === 'plot_production') {
    if (!seasonIdHint) throw badRequest('VALIDATION_FAILED', 'seasonId is required for plot contracts', [{ path: 'body.seasonId', message: 'required' }]);
    const s = await loadSeason(seasonIdHint);
    const b = await loadBlock(s.blockId);
    const [f] = await tx.select().from(farmers).where(eq(farmers.id, relatedId));
    if (!f || f.ownerOrgId !== ownerOrgId) throw notFound('Farmer');
    const allocs = await tx
      .select({ plotId: plots.id, code: plots.code, areaHa: plots.areaHa, sharePct: plotAllocations.sharePct })
      .from(plotAllocations)
      .innerJoin(plots, eq(plots.id, plotAllocations.plotId))
      .where(and(eq(plotAllocations.farmerId, f.id), eq(plotAllocations.blockId, b.id), eq(plotAllocations.status, 'active')));
    if (!allocs.length) throw unprocessable('NO_ALLOCATION', 'The farmer has no active plot allocation on this block');
    const pl = await tx
      .select({ areaHa: plantings.areaHa, cropFr: crops.nameFr, cropEn: crops.nameEn, plotId: plantings.plotId })
      .from(plantings)
      .innerJoin(crops, eq(crops.id, plantings.cropId))
      .where(and(eq(plantings.seasonId, s.id), inArray(plantings.plotId, allocs.map((a) => a.plotId))));
    const alloc = await facilityAllocationOf(tx, s.id, f.id);
    const orgs = await orgsById(tx, [ownerOrgId]);
    const [oc] = await tx.select().from(offtakeContracts).where(and(eq(offtakeContracts.blockId, b.id), notInArray(offtakeContracts.status, ['terminated', 'expired']))).limit(1);
    const priceFormula = oc
      ? locale === 'en'
        ? `Price paid to the farmer: offtake price of ${formatXof(oc.priceXofPerKg)} per kg (${oc.priceType}), adjusted by quality grade.`
        : `Prix payé au producteur : prix d'enlèvement de ${formatXof(oc.priceXofPerKg)} par kg (${oc.priceType}), ajusté selon le grade de qualité.`
      : locale === 'en'
        ? 'Price paid to the farmer: the sale price obtained by the Operator, adjusted by quality grade.'
        : "Prix payé au producteur : prix de vente obtenu par l'Opérateur, ajusté selon le grade de qualité.";
    return {
      blockId: b.id,
      seasonId: s.id,
      ownerOrgId,
      parties: [
        { partyType: 'farmer', farmerId: f.id, roleLabel: roleLabel('farmer', locale), signOrder: 1 },
        { partyType: 'org', orgId: ownerOrgId, roleLabel: roleLabel('operator', locale), signOrder: 2 },
      ],
      data: {
        date: today,
        block: blockView(b),
        season: seasonView(s),
        operator: orgView(orgs.get(ownerOrgId)),
        farmer: { name: `${f.firstName} ${f.lastName}`, code: f.code, village: f.village ?? '—' },
        plots: allocs.map((a) => ({ ref: a.code, areaHa: Number(a.areaHa), sharePct: Number(a.sharePct) })),
        crops: pl.map((p) => ({ name: locale === 'en' ? p.cropEn : p.cropFr, areaHa: Number(p.areaHa) })),
        creditXof: alloc?.principalXof ?? 0,
        priceFormula,
        clauses: { specialConditions: '' },
      },
    };
  }

  if (type === 'offtake') {
    const [oc] = await tx.select().from(offtakeContracts).where(eq(offtakeContracts.id, relatedId));
    if (!oc || oc.ownerOrgId !== ownerOrgId) throw notFound('Offtake contract');
    const b = await loadBlock(oc.blockId);
    const [c] = await tx.select().from(crops).where(eq(crops.id, oc.cropId));
    const orgs = await orgsById(tx, [ownerOrgId, oc.buyerOrgId]);
    const priceText =
      oc.priceType === 'fixed'
        ? `${formatXof(oc.priceXofPerKg)} / kg`
        : `${oc.formulaText ?? ''} ${locale === 'en' ? 'Reference' : 'Référence'} ${formatXof(oc.priceXofPerKg)} / kg${oc.floorXofPerKg ? `, ${locale === 'en' ? 'floor' : 'plancher'} ${formatXof(oc.floorXofPerKg)} / kg` : ''}`.trim();
    return {
      blockId: b.id,
      seasonId: oc.seasonId,
      ownerOrgId,
      parties: [
        { partyType: 'org', orgId: ownerOrgId, roleLabel: roleLabel('operator', locale), signOrder: 1 },
        { partyType: 'org', orgId: oc.buyerOrgId, roleLabel: roleLabel('buyer', locale), signOrder: 2 },
      ],
      data: {
        date: today,
        block: blockView(b),
        operator: orgView(orgs.get(ownerOrgId)),
        buyer: orgView(orgs.get(oc.buyerOrgId)),
        offtake: {
          ref: oc.ref,
          cropName: c ? (locale === 'en' ? c.nameEn : c.nameFr) : '—',
          volumeMinT: Number(oc.minVolumeKg) / 1000,
          volumeMaxT: Number(oc.maxVolumeKg) / 1000,
          quality: oc.qualitySpec.map((g) => g.grade).join(', ') || '—',
          priceText,
          paymentTermsDays: oc.paymentTermsDays,
        },
        escrow: await blockEscrow(tx, b.id),
        clauses: { specialConditions: '' },
      },
    };
  }

  // loan_seasonal | loan_investment
  const [fac] = await tx.select().from(facilities).where(eq(facilities.id, relatedId));
  if (!fac || fac.operatorOrgId !== ownerOrgId) throw notFound('Facility');
  if ((type === 'loan_seasonal') !== (fac.trancheType === 'seasonal')) throw unprocessable('CONTRACT_TYPE_MISMATCH', `Facility ${fac.ref} is a ${fac.trancheType} facility`);
  const b = await loadBlock(fac.blockId);
  const [award] = await tx.select().from(awards).where(eq(awards.id, fac.awardId));
  const [bid] = award ? await tx.select().from(bids).where(eq(bids.id, award.bidId)) : [];
  const [tr] = await tx.select().from(tranches).where(eq(tranches.id, fac.trancheId));
  const lines = await tx.select().from(scheduleLines).where(eq(scheduleLines.facilityId, fac.id)).orderBy(asc(scheduleLines.seq));
  const fa = await tx
    .select({ code: farmers.code, principalXof: facilityFarmerAllocations.principalXof, interestXof: facilityFarmerAllocations.interestXof, dueXof: facilityFarmerAllocations.dueXof })
    .from(facilityFarmerAllocations)
    .innerJoin(farmers, eq(farmers.id, facilityFarmerAllocations.farmerId))
    .where(eq(facilityFarmerAllocations.facilityId, fac.id))
    .orderBy(asc(farmers.code));
  const orgs = await orgsById(tx, [ownerOrgId, fac.lenderOrgId, ...(fac.borrowerOrgId ? [fac.borrowerOrgId] : [])]);
  const borrowerIsFarmers = fac.borrowerType !== 'operator';
  const borrowerOrg = fac.borrowerOrgId ? orgs.get(fac.borrowerOrgId) : orgs.get(ownerOrgId);
  const parties: PartySpec[] = [{ partyType: 'org', orgId: ownerOrgId, roleLabel: roleLabel(borrowerIsFarmers ? 'operator' : 'borrower', locale), signOrder: 1 }];
  if (fac.borrowerOrgId && fac.borrowerOrgId !== ownerOrgId) parties.push({ partyType: 'org', orgId: fac.borrowerOrgId, roleLabel: roleLabel('borrower', locale), signOrder: 1 });
  parties.push({ partyType: 'org', orgId: fac.lenderOrgId, roleLabel: roleLabel('lender', locale), signOrder: 2 });
  return {
    blockId: b.id,
    seasonId: fac.seasonId,
    ownerOrgId,
    parties,
    data: {
      date: today,
      block: blockView(b),
      operator: orgView(orgs.get(ownerOrgId)),
      lender: orgView(orgs.get(fac.lenderOrgId)),
      borrower: { name: borrowerIsFarmers && !fac.borrowerOrgId ? (locale === 'en' ? `the farmers of block ${b.ref}` : `les producteurs du bloc ${b.ref}`) : (borrowerOrg?.legalName ?? '—') },
      borrowerIsFarmers,
      facility: {
        ref: fac.ref,
        principalXof: fac.principalXof,
        purpose: tr?.purpose ?? '—',
        rateBps: fac.rateBps,
        rateMethod: fac.rateMethod,
        upfrontFeeBps: fac.upfrontFeeBps,
        upfrontFeeXof: upfrontFeeXof(fac.principalXof, fac.upfrontFeeBps),
        tenorMonths: fac.tenorMonths,
        graceMonths: fac.graceMonths,
        graceType: fac.graceType,
        repaymentProfile: fac.repaymentProfile,
        startDate: fac.startDate,
        maturityDate: fac.maturityDate,
      },
      conditionsPrecedent: bid?.conditionsPrecedent ?? [],
      schedule: lines.map((l) => ({ seq: l.seq, dueDate: l.dueDate, principalXof: l.principalXof, interestXof: l.interestXof, totalXof: l.totalXof })),
      farmerAllocations: fa,
      clauses: { specialConditions: '' },
    },
  };
}

async function facilityAllocationOf(tx: DbOrTx, seasonId: string, farmerId: string) {
  const [r] = await tx
    .select({ principalXof: sql<number>`sum(${facilityFarmerAllocations.principalXof})::bigint` })
    .from(facilityFarmerAllocations)
    .innerJoin(facilities, eq(facilities.id, facilityFarmerAllocations.facilityId))
    .where(and(eq(facilities.seasonId, seasonId), eq(facilityFarmerAllocations.farmerId, farmerId)));
  return r?.principalXof ? { principalXof: Number(r.principalXof) } : null;
}

// ---------------------------------------------------------------- visibility & DTO

/** Contract visible to its owner (operator), its party organisations (via grant) and platform staff. */
export async function loadContract(db: DbOrTx, actor: ActorContext, id: string): Promise<ContractRow> {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c) throw notFound('Contract');
  if (c.ownerOrgId === actor.orgId || isPlatformStaff(actor)) return c;
  if (actor.orgId) {
    const [p] = await db.select({ id: contractParties.id }).from(contractParties).where(and(eq(contractParties.contractId, id), eq(contractParties.orgId, actor.orgId))).limit(1);
    if (p && c.status !== 'draft') return c;
  }
  throw notFound('Contract');
}

async function partiesView(db: DbOrTx, contractId: string) {
  const ps = await db.select().from(contractParties).where(eq(contractParties.contractId, contractId)).orderBy(asc(contractParties.signOrder), asc(contractParties.createdAt));
  const orgIds = ps.filter((p) => p.orgId).map((p) => p.orgId!);
  const farmerIds = ps.filter((p) => p.farmerId).map((p) => p.farmerId!);
  const orgs = await orgsById(db, orgIds);
  const fs = farmerIds.length ? await db.select({ id: farmers.id, firstName: farmers.firstName, lastName: farmers.lastName, code: farmers.code }).from(farmers).where(inArray(farmers.id, farmerIds)) : [];
  const sigs = await db.select().from(signatures).where(eq(signatures.contractId, contractId));
  return ps.map((p) => {
    const s = sigs.find((x) => x.partyId === p.id);
    const f = fs.find((x) => x.id === p.farmerId);
    return { row: p, name: p.orgId ? (orgs.get(p.orgId)?.legalName ?? '—') : f ? `${f.firstName} ${f.lastName} (${f.code})` : '—', signature: s ?? null };
  });
}

function canSignParty(actor: ActorContext, c: ContractRow, p: PartyRow, all: PartyRow[]): boolean {
  if (!['out_for_signature', 'partially_signed'].includes(c.status) || p.signedAt) return false;
  if (all.some((o) => o.signOrder < p.signOrder && !o.signedAt)) return false;
  if (p.partyType === 'org') return p.orgId === actor.orgId && hasPermission(actor.permissions, 'contract:sign') && (!p.signerUserId || p.signerUserId === actorUserId(actor));
  return c.ownerOrgId === actor.orgId && (hasPermission(actor.permissions, 'contract:witness_sign') || hasPermission(actor.permissions, 'contract:manage'));
}

export async function contractDto(db: DbOrTx, actor: ActorContext, c: ContractRow) {
  const [t] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, c.templateId));
  const [b] = await db.select({ ref: blocks.ref, name: blocks.name }).from(blocks).where(eq(blocks.id, c.blockId));
  const parties = await partiesView(db, c.id);
  const own = c.ownerOrgId === actor.orgId;
  const actions: string[] = [];
  if (own && hasPermission(actor.permissions, 'contract:manage')) {
    if (c.status === 'draft') actions.push('edit', 'send');
    if (['draft', 'out_for_signature', 'partially_signed'].includes(c.status)) actions.push('void');
  }
  const rows = parties.map((p) => p.row);
  if (rows.some((p) => canSignParty(actor, c, p, rows))) actions.push('sign');
  const data = c.data as { clauses?: Record<string, string> };
  return {
    id: c.id,
    ref: c.ref,
    type: c.type as ContractType,
    title: t?.title ?? c.type,
    templateVersion: t?.templateVersion ?? 1,
    locale: c.locale,
    blockId: c.blockId,
    blockRef: b?.ref ?? '',
    blockName: b?.name ?? '',
    seasonId: c.seasonId,
    relatedType: c.relatedType,
    relatedId: c.relatedId,
    status: c.status,
    clauses: data.clauses ?? {},
    editableClauses: (t?.variablesSchema ?? []).filter((v) => v.editable).map((v) => ({ name: v.name, description: v.description ?? null })),
    contentSha256: c.contentSha256,
    hasPdf: Boolean(c.pdfFileId),
    hasSignedPdf: Boolean(c.signedPdfFileId),
    sentAt: iso(c.sentAt),
    signedAt: iso(c.signedAt),
    voidedAt: iso(c.voidedAt),
    voidReason: c.voidReason,
    parties: parties.map((p) => ({
      id: p.row.id,
      partyType: p.row.partyType,
      orgId: p.row.orgId,
      farmerId: own || isPlatformStaff(actor) ? p.row.farmerId : null,
      name: p.row.partyType === 'farmer' && !own && !isPlatformStaff(actor) ? p.row.roleLabel : p.name,
      roleLabel: p.row.roleLabel,
      signOrder: p.row.signOrder,
      signedAt: iso(p.row.signedAt),
      signatureMethod: p.signature?.method ?? null,
      signerName: p.signature?.signerName ?? null,
      canSign: canSignParty(actor, c, p.row, rows),
    })),
    createdAt: c.createdAt.toISOString(),
    version: c.version,
    allowedActions: actions,
  };
}

export async function listContracts(db: DbOrTx, actor: ActorContext, f: { blockId?: string; seasonId?: string; type?: string; status?: string; relatedId?: string }) {
  const orgId = requireOrg(actor);
  const conds = [];
  if (f.blockId) conds.push(eq(contracts.blockId, f.blockId));
  if (f.seasonId) conds.push(eq(contracts.seasonId, f.seasonId));
  if (f.type) conds.push(eq(contracts.type, f.type));
  if (f.status) conds.push(eq(contracts.status, f.status as ContractRow['status']));
  if (f.relatedId) conds.push(eq(contracts.relatedId, f.relatedId));
  if (!isPlatformStaff(actor)) {
    conds.push(
      sql`(${contracts.ownerOrgId} = ${orgId} or (${contracts.status} <> 'draft' and exists (select 1 from contract_parties cp where cp.contract_id = ${contracts.id} and cp.org_id = ${orgId})))`,
    );
  }
  const rows = await db.select().from(contracts).where(and(...conds)).orderBy(desc(contracts.createdAt)).limit(500);
  return Promise.all(rows.map((c) => contractDto(db, actor, c)));
}

// ---------------------------------------------------------------- lifecycle

async function insertContract(tx: DbOrTx, actor: ActorContext, type: ContractType, relatedId: string, a: Assembled, locale: string, clauses?: Record<string, string>) {
  const t = await activeTemplate(tx, type, locale);
  const editable = new Set(t.variablesSchema.filter((v) => v.editable).map((v) => v.name));
  const data = { ...a.data, clauses: { ...(a.data.clauses as Record<string, string>), ...pickEditable(clauses, editable) } };
  const [c] = await tx
    .insert(contracts)
    .values({ ref: await nextRef(tx, 'CTR'), templateId: t.id, type, blockId: a.blockId, seasonId: a.seasonId, ownerOrgId: a.ownerOrgId, relatedType: RELATED_TYPE[type], relatedId, locale: t.locale, data, createdBy: actorUserId(actor) })
    .returning();
  for (const p of a.parties) {
    await tx.insert(contractParties).values({ contractId: c!.id, partyType: p.partyType, orgId: p.orgId ?? null, farmerId: p.farmerId ?? null, roleLabel: p.roleLabel, signOrder: p.signOrder });
    if (p.orgId && p.orgId !== a.ownerOrgId) await grant(tx, { resourceType: 'contract', resourceId: c!.id, granteeOrgId: p.orgId, scope: 'read', grantedByEvent: 'contract.created', expiresAt: null });
  }
  await audit(tx, actor, { action: 'contract.created', resourceType: 'contract', resourceId: c!.id, after: { type, relatedId, ref: c!.ref } });
  return c!;
}

function pickEditable(clauses: Record<string, string> | undefined, editable: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(clauses ?? {})) {
    if (!editable.has(k)) throw badRequest('CLAUSE_NOT_EDITABLE', `Clause ${k} is not editable in this template`, [{ path: `body.clauses.${k}`, message: 'not editable' }]);
    out[k] = v;
  }
  return out;
}

async function existingContract(tx: DbOrTx, type: string, relatedId: string, seasonId: string | null) {
  const conds = [eq(contracts.type, type), eq(contracts.relatedId, relatedId), ne(contracts.status, 'voided')];
  if (seasonId) conds.push(eq(contracts.seasonId, seasonId));
  const [c] = await tx.select().from(contracts).where(and(...conds)).limit(1);
  return c ?? null;
}

async function ownerLocale(tx: DbOrTx, orgId: string) {
  const [o] = await tx.select({ locale: organizations.locale }).from(organizations).where(eq(organizations.id, orgId));
  return o?.locale === 'en' ? 'en' : 'fr';
}

export async function createContract(db: Db, actor: ActorContext, body: { type: ContractType; relatedId: string; seasonId?: string | null; locale?: 'fr' | 'en'; clauses?: Record<string, string> }) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const locale = body.locale ?? (await ownerLocale(tx, orgId));
    const a = await assemble(tx, body.type, body.relatedId, orgId, locale, body.seasonId);
    if (await existingContract(tx, body.type, body.relatedId, a.seasonId)) throw conflict('CONTRACT_EXISTS', 'A non-voided contract already exists for this entity');
    return insertContract(tx, actor, body.type, body.relatedId, a, locale, body.clauses);
  });
}

async function loadOwn(tx: DbOrTx, actor: ActorContext, id: string, lock = true) {
  const q = tx.select().from(contracts).where(eq(contracts.id, id));
  const [c] = lock ? await q.for('update') : await q;
  if (!c || c.ownerOrgId !== actor.orgId) throw notFound('Contract');
  return c;
}

/** Only editable clauses, only in draft (SPEC §8.5). Data is re-assembled from the source entities. */
export async function updateContract(db: Db, actor: ActorContext, id: string, expected: number, body: { clauses?: Record<string, string>; refresh?: boolean }) {
  return db.transaction(async (tx) => {
    const c = await loadOwn(tx, actor, id);
    assertVersion(c.version, expected);
    if (c.status !== 'draft') throw conflict('CONTRACT_NOT_DRAFT', 'Only draft contracts can be edited');
    const [t] = await tx.select().from(contractTemplates).where(eq(contractTemplates.id, c.templateId));
    const editable = new Set((t?.variablesSchema ?? []).filter((v) => v.editable).map((v) => v.name));
    const prev = c.data as Record<string, unknown> & { clauses?: Record<string, string> };
    let data: Record<string, unknown> = prev;
    if (body.refresh) data = (await assemble(tx, c.type as ContractType, c.relatedId, c.ownerOrgId, c.locale, c.seasonId)).data;
    data = { ...data, clauses: { ...(prev.clauses ?? {}), ...pickEditable(body.clauses, editable) } };
    await tx.update(contracts).set({ data, version: c.version + 1 }).where(eq(contracts.id, id));
    await audit(tx, actor, { action: 'contract.updated', resourceType: 'contract', resourceId: id, before: { clauses: prev.clauses }, after: { clauses: (data as { clauses: unknown }).clauses } });
  });
}

const contentHash = (c: { ref: string; templateId: string }, body: string, data: unknown) => sha256Hex(canonicalJson({ ref: c.ref, templateId: c.templateId, body, data }));

async function signatureViews(db: DbOrTx, contractId: string, locale: string) {
  return (await partiesView(db, contractId)).map((p) => ({
    roleLabel: p.row.roleLabel,
    partyName: p.name,
    signerName: p.signature?.signerName ?? null,
    method: p.signature ? methodLabel(p.signature.method, locale) : null,
    signedAt: p.signature ? p.signature.signedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null,
    contentSha256: p.signature?.contentSha256 ?? null,
  }));
}
const methodLabel = (m: string, locale: string) =>
  ({ otp_sms: locale === 'en' ? 'SMS code' : 'Code SMS', otp_email: locale === 'en' ? 'Email code' : 'Code e-mail', in_person_witnessed: locale === 'en' ? 'In person, witnessed' : 'En personne, avec témoin' })[m] ?? m;

async function renderPdf(ctx: ModuleContext, tx: DbOrTx, actor: ActorContext, c: ContractRow, signed: boolean): Promise<string> {
  const [t] = await tx.select().from(contractTemplates).where(eq(contractTemplates.id, c.templateId));
  const html = renderContractHtml({ ref: c.ref, title: t?.title ?? c.type, bodyHtml: c.bodyRendered ?? '', contentSha256: c.contentSha256, status: signed ? 'signed' : c.status, signatures: await signatureViews(tx, c.id, c.locale) }, c.locale);
  const pdf = await pdfRenderer().render(html);
  const f = await storeFile(ctx, tx, { ...actor, orgId: c.ownerOrgId }, { filename: `${c.ref}${signed ? '-signed' : ''}.pdf`, declaredMime: 'application/pdf', buffer: pdf }, { linkedType: 'contract', linkedId: c.id, ownerOrgId: c.ownerOrgId });
  return f.id;
}

/** draft → out_for_signature: render, fix the content hash, store the PDF, notify signatories. */
export async function sendContract(ctx: ModuleContext, actor: ActorContext, id: string, expected: number) {
  await ctx.db.transaction(async (tx) => {
    const c = await loadOwn(tx, actor, id);
    assertVersion(c.version, expected);
    const to = transition(contractMachine, c.status, 'send');
    const [t] = await tx.select().from(contractTemplates).where(eq(contractTemplates.id, c.templateId));
    const body = renderContractBody(t!.bodyHbs, { ...(c.data as Record<string, unknown>), ref: c.ref }, c.locale);
    const hash = contentHash(c, body, c.data);
    const sent = { ...c, status: to, bodyRendered: body, contentSha256: hash };
    const pdfFileId = await renderPdf(ctx, tx, actor, sent, false);
    await tx.update(contracts).set({ status: to, bodyRendered: body, contentSha256: hash, pdfFileId, sentAt: new Date(), version: c.version + 1 }).where(eq(contracts.id, id));
    await notifySigners(tx, { ...sent, pdfFileId }, t?.title ?? c.type);
    await audit(tx, actor, { action: 'contract.sent', resourceType: 'contract', resourceId: id, after: { contentSha256: hash } });
    await emit(tx, actor, 'contract.sent', { type: 'contract', id }, { ref: c.ref, type: c.type, blockId: c.blockId, contentSha256: hash }, c.ownerOrgId);
  });
}

async function notifySigners(tx: DbOrTx, c: ContractRow, title: string) {
  const ps = await tx.select().from(contractParties).where(and(eq(contractParties.contractId, c.id), eq(contractParties.partyType, 'org')));
  const [b] = await tx.select({ ref: blocks.ref }).from(blocks).where(eq(blocks.id, c.blockId));
  for (const p of ps) {
    const signers = await orgSigners(tx, p.orgId!);
    for (const u of signers) {
      await notify(tx, { recipientType: 'user', recipientId: u.id, orgId: p.orgId, channels: ['in_app', 'email'], templateCode: 'contract.to_sign', locale: u.locale, email: u.email, data: { ref: c.ref, title, blockRef: b?.ref ?? '', link: link(`/app/contracts/${c.id}`) }, link: `/app/contracts/${c.id}` });
    }
  }
}

/** Users of an org holding a role that grants `contract:sign`. */
async function orgSigners(tx: DbOrTx, orgId: string) {
  const SIGN_ROLES = ['org_admin', 'operator_manager', 'finance_officer', 'credit_officer', 'credit_committee', 'buyer_rep'];
  return tx
    .select({ id: users.id, email: users.email, locale: users.locale })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, 'active'), sql`${memberships.roles} && ${sql.raw(`ARRAY[${SIGN_ROLES.map((r) => `'${r}'`).join(',')}]::text[]`)}`));
}

export async function voidContract(db: Db, actor: ActorContext, id: string, expected: number, reason: string) {
  await db.transaction(async (tx) => {
    const c = await loadOwn(tx, actor, id);
    assertVersion(c.version, expected);
    const to = transition(contractMachine, c.status, 'void');
    await tx.update(contracts).set({ status: to, voidedAt: new Date(), voidReason: reason, version: c.version + 1 }).where(eq(contracts.id, id));
    await audit(tx, actor, { action: 'contract.voided', resourceType: 'contract', resourceId: id, after: { reason } });
    await emit(tx, actor, 'contract.voided', { type: 'contract', id }, { ref: c.ref, type: c.type, reason }, c.ownerOrgId);
  });
}

// ---------------------------------------------------------------- signatures

async function pickParty(tx: DbOrTx, actor: ActorContext, c: ContractRow, partyId: string | undefined) {
  const all = await tx.select().from(contractParties).where(eq(contractParties.contractId, c.id));
  const candidates = all.filter((p) => (partyId ? p.id === partyId : true) && canSignParty(actor, c, p, all));
  if (!partyId) {
    const own = candidates.filter((p) => p.partyType === 'org');
    if (own.length) return { party: own[0]!, all };
  } else if (candidates[0]) return { party: candidates[0], all };
  if (!['out_for_signature', 'partially_signed'].includes(c.status)) throw conflict('CONTRACT_NOT_OUT_FOR_SIGNATURE', `Contract is ${c.status}`);
  const target = all.find((p) => p.id === partyId) ?? all.find((p) => p.orgId === actor.orgId);
  if (target?.signedAt) throw conflict('ALREADY_SIGNED', 'This party has already signed');
  if (target && all.some((o) => o.signOrder < target.signOrder && !o.signedAt)) throw conflict('SIGN_ORDER', 'Earlier signatories must sign first');
  throw notFound('Signature party');
}

async function signerIdentity(tx: DbOrTx, actor: ActorContext, party: PartyRow, viaEmail: boolean) {
  if (party.partyType === 'farmer') {
    const [f] = await tx.select().from(farmers).where(eq(farmers.id, party.farmerId!));
    if (!f?.phone) throw unprocessable('FARMER_PHONE_MISSING', 'The farmer has no phone number: sign in person with a witness');
    return { channel: 'sms' as const, identifier: f.phone, name: `${f.firstName} ${f.lastName}`, locale: f.locale, recipient: { type: 'farmer' as const, id: f.id, orgId: f.ownerOrgId } };
  }
  const uid = actorUserId(actor);
  if (!uid) throw unprocessable('USER_REQUIRED', 'Only a signed-in user can sign');
  const [u] = await tx.select().from(users).where(eq(users.id, uid));
  if (!u) throw notFound('User');
  if (u.phone && !viaEmail) return { channel: 'sms' as const, identifier: u.phone, name: u.fullName, locale: u.locale, recipient: { type: 'user' as const, id: u.id, orgId: party.orgId } };
  if (!u.email) throw unprocessable('NO_OTP_CHANNEL', 'Your account has no phone or email');
  return { channel: 'email' as const, identifier: u.email.toLowerCase(), name: u.fullName, locale: u.locale, recipient: { type: 'user' as const, id: u.id, orgId: party.orgId } };
}

/** Send a 6-digit signature code to the signatory (user: SMS if a phone is known, else email; farmer: SMS). */
export async function requestSignatureOtp(db: Db, actor: ActorContext, id: string, body: { partyId?: string; channel?: 'sms' | 'email' }) {
  return db.transaction(async (tx) => {
    const c = await loadContract(tx, actor, id);
    const { party } = await pickParty(tx, actor, c, body.partyId);
    const who = await signerIdentity(tx, actor, party, body.channel === 'email');
    // Per signatory party: 5 codes / 10 min; per identifier (a signer may sign a whole pack): 30 codes / 10 min.
    const since = new Date(Date.now() - OTP_WINDOW_MS);
    const [{ party: perParty, all: perId } = { party: 0, all: 0 }] = await tx
      .select({ party: sql<number>`count(*) filter (where ${otpCodes.subjectId} = ${party.id})::int`, all: sql<number>`count(*)::int` })
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, who.identifier), eq(otpCodes.purpose, 'signature'), gt(otpCodes.createdAt, since)));
    if (perParty >= OTP_MAX_PER_WINDOW || perId >= OTP_MAX_PER_IDENTIFIER) throw tooMany('OTP_RATE_LIMITED', 'Too many codes requested. Try again in 10 minutes.');
    const code = randomDigits(6);
    await tx.insert(otpCodes).values({ phone: who.identifier, purpose: 'signature', subjectId: party.id, codeHash: sha256(`${who.identifier}:signature:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
    await notify(tx, {
      recipientType: who.recipient.type,
      recipientId: who.recipient.id,
      orgId: who.recipient.orgId,
      channels: [who.channel],
      templateCode: 'contract.otp',
      locale: who.locale,
      phone: who.channel === 'sms' ? who.identifier : null,
      email: who.channel === 'email' ? who.identifier : null,
      data: { code, ref: c.ref },
    });
    await audit(tx, actor, { action: 'contract.otp_requested', resourceType: 'contract', resourceId: id, after: { partyId: party.id, channel: who.channel } });
    return { partyId: party.id, channel: who.channel, destination: who.channel === 'sms' ? `**** ${who.identifier.slice(-4)}` : who.identifier.replace(/^(.).*(@.*)$/, '$1***$2') };
  });
}

export interface SignBody {
  partyId?: string;
  method: 'otp' | 'in_person_witnessed';
  code?: string;
  channel?: 'sms' | 'email';
  evidenceFileId?: string;
  geo?: { type: 'Point'; coordinates: number[] } | null;
}

export async function signContract(ctx: ModuleContext, actor: ActorContext, id: string, body: SignBody) {
  const db = ctx.db;
  // OTP verification first, in its own transaction (failed attempts must be counted even if signing fails).
  let otpIdentity: Awaited<ReturnType<typeof signerIdentity>> | null = null;
  let otpPartyId: string | null = null;
  if (body.method === 'otp') {
    if (!body.code) throw badRequest('VALIDATION_FAILED', 'code is required', [{ path: 'body.code', message: 'required' }]);
    const pre = await db.transaction(async (tx) => {
      const c = await loadContract(tx, actor, id);
      const { party } = await pickParty(tx, actor, c, body.partyId);
      return { party, who: await signerIdentity(tx, actor, party, body.channel === 'email') };
    });
    await consumeOtp(db, pre.who.identifier, 'signature', body.code, pre.party.id);
    otpIdentity = pre.who;
    otpPartyId = pre.party.id;
  }
  return db.transaction(async (tx) => {
    const c0 = await loadContract(tx, actor, id);
    const [c] = await tx.select().from(contracts).where(eq(contracts.id, c0.id)).for('update');
    const { party, all } = await pickParty(tx, actor, c!, otpPartyId ?? body.partyId);
    if (otpPartyId && party.id !== otpPartyId) throw conflict('PARTY_MISMATCH', 'The code was issued for another party');
    let method: 'otp_sms' | 'otp_email' | 'in_person_witnessed';
    let signerName: string;
    let signerIdentifier: string;
    let witnessUserId: string | null = null;
    if (body.method === 'in_person_witnessed') {
      if (party.partyType !== 'farmer') throw unprocessable('IN_PERSON_FARMERS_ONLY', 'In-person witnessed signature is only for farmer parties');
      if (!body.evidenceFileId) throw badRequest('VALIDATION_FAILED', 'A photo of the signing is required', [{ path: 'body.evidenceFileId', message: 'required' }]);
      const f = await getVisibleFile(tx, actor, body.evidenceFileId);
      if (!f.mime.startsWith('image/')) throw unprocessable('EVIDENCE_NOT_IMAGE', 'Evidence must be a photo');
      const [fr] = await tx.select().from(farmers).where(eq(farmers.id, party.farmerId!));
      method = 'in_person_witnessed';
      signerName = `${fr!.firstName} ${fr!.lastName}`;
      signerIdentifier = fr!.code;
      witnessUserId = actorUserId(actor);
      if (!witnessUserId) throw unprocessable('USER_REQUIRED', 'A field agent must witness the signature');
    } else {
      method = otpIdentity!.channel === 'sms' ? 'otp_sms' : 'otp_email';
      signerName = otpIdentity!.name;
      signerIdentifier = otpIdentity!.identifier;
    }
    const [sig] = await tx
      .insert(signatures)
      .values({
        contractId: c!.id,
        partyId: party.id,
        method,
        signerName,
        signerIdentifier: method === 'otp_sms' ? `**** ${signerIdentifier.slice(-4)}` : signerIdentifier,
        ip: actor.ip,
        userAgent: actor.userAgent,
        geo: body.geo ? (geomFromGeoJson(body.geo) as unknown as string) : null,
        contentSha256: c!.contentSha256!,
        witnessUserId,
        evidenceFileId: body.evidenceFileId ?? null,
        createdBy: actorUserId(actor),
      })
      .returning();
    const now = new Date();
    await tx.update(contractParties).set({ signedAt: now, signatureId: sig!.id, signerUserId: party.partyType === 'org' ? actorUserId(actor) : null }).where(eq(contractParties.id, party.id));
    const remaining = all.filter((p) => p.id !== party.id && !p.signedAt).length;
    const to = transition(contractMachine, c!.status, remaining ? 'sign_partial' : 'sign_complete');
    const patch: Partial<ContractRow> = { status: to, version: c!.version + 1 };
    if (!remaining) {
      patch.signedAt = now;
      patch.signedPdfFileId = await renderPdf(ctx, tx, actor, { ...c!, status: to }, true);
    }
    await tx.update(contracts).set(patch).where(eq(contracts.id, c!.id));
    await audit(tx, actor, { action: 'contract.signed_by_party', resourceType: 'contract', resourceId: c!.id, after: { partyId: party.id, method, contentSha256: c!.contentSha256 } });
    if (!remaining) await onFullySigned(tx, actor, { ...c!, ...patch } as ContractRow);
  });
}

async function onFullySigned(tx: DbOrTx, actor: ActorContext, c: ContractRow) {
  if (c.type === 'plot_production') {
    await tx.update(plotAllocations).set({ contractId: c.id }).where(and(eq(plotAllocations.farmerId, c.relatedId), eq(plotAllocations.blockId, c.blockId), eq(plotAllocations.status, 'active'), isNull(plotAllocations.contractId)));
  }
  if (c.type === 'offtake') {
    await tx.update(offtakeContracts).set({ status: 'signed', signedAt: c.signedAt ?? new Date(), fileId: c.signedPdfFileId }).where(and(eq(offtakeContracts.id, c.relatedId), inArray(offtakeContracts.status, ['draft', 'loi'])));
  }
  const [t] = await tx.select({ title: contractTemplates.title }).from(contractTemplates).where(eq(contractTemplates.id, c.templateId));
  const ps = await tx.select().from(contractParties).where(and(eq(contractParties.contractId, c.id), eq(contractParties.partyType, 'org')));
  for (const p of ps) {
    for (const u of await orgSigners(tx, p.orgId!)) {
      await notify(tx, { recipientType: 'user', recipientId: u.id, orgId: p.orgId, channels: ['in_app'], templateCode: 'contract.signed', locale: u.locale, data: { ref: c.ref, title: t?.title ?? c.type, link: link(`/app/contracts/${c.id}`) }, link: `/app/contracts/${c.id}` });
    }
  }
  await emit(tx, actor, 'contract.signed', { type: 'contract', id: c.id }, { ref: c.ref, type: c.type, blockId: c.blockId, seasonId: c.seasonId, relatedType: c.relatedType, relatedId: c.relatedId, contentSha256: c.contentSha256 }, c.ownerOrgId);
}

// ---------------------------------------------------------------- generate pack (SPEC §10.10)

export async function generatePack(ctx: ModuleContext, actor: ActorContext, blockId: string, body: { seasonId: string; send?: boolean; locale?: 'fr' | 'en' }) {
  const orgId = requireOrg(actor);
  const created = await ctx.db.transaction(async (tx) => {
    const [b] = await tx.select().from(blocks).where(eq(blocks.id, blockId));
    if (!b || b.ownerOrgId !== orgId) throw notFound('Block');
    const [s] = await tx.select().from(seasons).where(eq(seasons.id, body.seasonId));
    if (!s || s.blockId !== b.id) throw notFound('Season');
    const locale = body.locale ?? (await ownerLocale(tx, orgId));
    const facs = await tx.select().from(facilities).where(and(eq(facilities.seasonId, s.id), notInArray(facilities.status, ['repaid', 'defaulted'])));
    if (!facs.length) throw unprocessable('NO_FACILITY', 'Accept at least one award before generating the contract pack');
    const out: string[] = [];
    const make = async (type: ContractType, relatedId: string, seasonId: string | null) => {
      if (await existingContract(tx, type, relatedId, seasonId)) return;
      const a = await assemble(tx, type, relatedId, orgId, locale, seasonId);
      out.push((await insertContract(tx, actor, type, relatedId, a, locale)).id);
    };
    await make('block_framework', s.id, s.id);
    const farmerIds = await tx.selectDistinct({ id: plotAllocations.farmerId }).from(plotAllocations).where(and(eq(plotAllocations.blockId, b.id), eq(plotAllocations.status, 'active')));
    for (const f of farmerIds) await make('plot_production', f.id, s.id);
    const ocs = await tx.select({ id: offtakeContracts.id, seasonId: offtakeContracts.seasonId }).from(offtakeContracts).where(and(eq(offtakeContracts.blockId, b.id), inArray(offtakeContracts.status, ['draft', 'loi'])));
    for (const oc of ocs) if (!oc.seasonId || oc.seasonId === s.id) await make('offtake', oc.id, oc.seasonId);
    for (const f of facs) await make(f.trancheType === 'seasonal' ? 'loan_seasonal' : 'loan_investment', f.id, f.seasonId);
    await make('escrow_mandate', s.id, s.id);
    await audit(tx, actor, { action: 'contract.pack_generated', resourceType: 'block', resourceId: b.id, after: { seasonId: s.id, created: out.length } });
    return out;
  });
  if (body.send) {
    for (const id of created) {
      const [c] = await ctx.db.select({ version: contracts.version }).from(contracts).where(eq(contracts.id, id));
      await sendContract(ctx, actor, id, c!.version);
    }
  }
  return created;
}

/** CP helper for facilities: signed framework, escrow mandate and loan contract for a facility. */
export async function signedContractTypes(db: DbOrTx, seasonId: string, facilityId: string) {
  const rows = await db
    .select({ type: contracts.type, relatedId: contracts.relatedId })
    .from(contracts)
    .where(and(eq(contracts.status, 'signed'), sql`(${contracts.seasonId} = ${seasonId} or ${contracts.relatedId} = ${facilityId})`));
  return {
    framework: rows.some((r) => r.type === 'block_framework'),
    escrowMandate: rows.some((r) => r.type === 'escrow_mandate'),
    loan: rows.some((r) => r.relatedId === facilityId && (r.type === 'loan_seasonal' || r.type === 'loan_investment')),
  };
}

