import { dec, roundRatio, roundXof, type Dec } from './money';
import { allocateBudget, type BudgetInput } from './budget';
import { buildSchedule, type GraceType, type RateMethod, type RepaymentProfile } from './schedule';
import { annualise, irrMonthly, npv } from './irr';
import { canonicalJson } from './hash';
import { sha256Hex } from './sha256';

export const MODEL_ENGINE_VERSION = 'model-1.0.0';
export const SCENARIOS = ['base', 'yield_minus_20', 'price_minus_15', 'combined', 'delay_2m'] as const;
export type ScenarioCode = (typeof SCENARIOS)[number];

export interface ModelPlanting {
  plantingId: string;
  plotId: string;
  cropId: string;
  areaHa: number;
  yieldBaseTHa: number | null;
  yieldStressTHa: number | null;
  postHarvestLossPct: number | null;
  deliveryRatePct: number | null;
  priceXofPerKgBase: number | null;
  priceXofPerKgStress: number | null;
  /** Planned harvest month, offset from the season start (model month 0). */
  harvestMonth: number;
}

export interface SeasonalTrancheTerms {
  amountXof?: number;
  rateBps: number;
  rateMethod: RateMethod;
  upfrontFeeBps: number;
  tenorMonths: number;
  repaymentProfile: RepaymentProfile;
  feesChargedTo: 'operator' | 'farmers';
}

export interface InvestmentTrancheTerms {
  amountXof?: number;
  rateBps: number;
  rateMethod: RateMethod;
  upfrontFeeBps: number;
  tenorMonths: number;
  graceMonths: number;
  graceType: GraceType;
  repaymentProfile: RepaymentProfile;
}

export interface ModelInput {
  plots: BudgetInput['plots'];
  allocations: BudgetInput['allocations'];
  farmers: { farmerId: string; farmerCode: string; baselineIncomeXof: number | null }[];
  plantings: ModelPlanting[];
  budgetLines: BudgetInput['lines'];
  feePolicy: { operatorServiceFeeXofPerFarmerSeason: number; landFeeXofPerHaSeason: number; investmentRecoveryFeeXofPerHaSeason: number } | null;
  capexItems: { amountXof: number; tranche: 'investment' | 'equity' | 'grant'; month: number }[];
  opex: { amountXofPerMonth: number; startMonth: number; endMonth: number | null }[];
  tranches: { seasonal?: SeasonalTrancheTerms | null; investment?: InvestmentTrancheTerms | null };
  seasonsPerYear: number;
  discountRateBps: number;
  horizonMonths?: number;
}

export interface FarmerResult {
  farmerId: string;
  ha: number;
  grossRevenueXof: number;
  seasonalDebtDueXof: number;
  investmentFeeXof: number;
  landFeeXof: number;
  operatorServiceFeeXof: number;
  farmerCashCostsXof: number;
  netIncomeXof: number;
  valueCreatedXof: number | null;
  hcr: number | null;
}

export interface BlockResult {
  grossRevenueXof: number;
  seasonalDebtDueXof: number;
  hcr: number | null;
  breakevenYieldMultiplier: number | null;
  breakevenPriceMultiplier: number | null;
  minDscr: number | null;
  avgDscr: number | null;
  operatorNpvXof: number;
  operatorIrr: number | null;
  paybackMonth: number | null;
}

export interface ScenarioResult {
  farmers: FarmerResult[];
  block: BlockResult;
  monthlyCashflow: { month: number; inflowXof: number; outflowXof: number; netXof: number; cumulativeXof: number }[];
}

export interface ScenarioDetails {
  plantings: { plantingId: string; cropId: string; productionT: number; deliverableKg: number; revenueXof: number }[];
  farmers: { farmerId: string; seasonalPrincipalXof: number; seasonalInterestXof: number; seasonalFeesXof: number }[];
  dscrByYear: { year: number; cfadsXof: number; debtServiceXof: number; dscr: number | null }[];
}

export interface ModelOutput {
  engineVersion: string;
  inputsHash: string;
  scenarios: Record<ScenarioCode, ScenarioResult>;
  details: Record<ScenarioCode, ScenarioDetails>;
  breakevenYieldByCrop: { cropId: string; yieldTHa: number }[];
  tranches: { seasonalAmountXof: number; investmentAmountXof: number };
  warnings: { code: string; message: string }[];
}

interface ScenarioDef {
  stressYield: boolean;
  stressPrice: boolean;
  delayMonths: number;
}
const DEFS: Record<ScenarioCode, ScenarioDef> = {
  base: { stressYield: false, stressPrice: false, delayMonths: 0 },
  yield_minus_20: { stressYield: true, stressPrice: false, delayMonths: 0 },
  price_minus_15: { stressYield: false, stressPrice: true, delayMonths: 0 },
  combined: { stressYield: true, stressPrice: true, delayMonths: 0 },
  delay_2m: { stressYield: false, stressPrice: false, delayMonths: 2 },
};

const ratio = (a: Dec, b: Dec): number | null => (b.isZero() ? null : roundRatio(a.div(b)));

/** Seasonal interest per §9.1.3: flat or declining-single-repayment = P × r × months/12; instalments from schedule. */
function seasonalInterest(principal: number, t: SeasonalTrancheTerms, extraMonths: number): number {
  if (principal <= 0) return 0;
  const months = t.tenorMonths + extraMonths;
  if (t.rateMethod === 'flat' || t.repaymentProfile === 'bullet' || t.repaymentProfile === 'seasonal') {
    return roundXof(dec(principal).times(t.rateBps).div(10000).times(months).div(12));
  }
  return buildSchedule({ principalXof: principal, rateBps: t.rateBps, rateMethod: t.rateMethod, tenorMonths: months, repaymentProfile: t.repaymentProfile }).reduce((s, l) => s + l.interestXof, 0);
}

/**
 * Deterministic block financial model (SPEC §9.1). Pure: same input → same output.
 * Money outputs are integers (half-even), ratios 2 decimals (half-even).
 */
export function computeBlockModel(input: ModelInput): ModelOutput {
  const inputsHash = sha256Hex(canonicalJson(input));
  const warnings: { code: string; message: string }[] = [];
  const budget = allocateBudget({ plots: input.plots, allocations: input.allocations, plantings: input.plantings.map((p) => ({ plantingId: p.plantingId, plotId: p.plotId, cropId: p.cropId, areaHa: p.areaHa })), lines: input.budgetLines });
  for (const w of budget.warnings) warnings.push({ code: w.code, message: w.message });
  for (const p of input.plantings) {
    if (p.yieldBaseTHa === null || p.yieldStressTHa === null) warnings.push({ code: 'MISSING_YIELD', message: `Planting ${p.plantingId} has no yield` });
    if (p.priceXofPerKgBase === null) warnings.push({ code: 'MISSING_PRICE', message: `Planting ${p.plantingId} has no price` });
  }

  const allocsByPlot = new Map<string, BudgetInput['allocations']>();
  for (const a of input.allocations) allocsByPlot.set(a.plotId, [...(allocsByPlot.get(a.plotId) ?? []), a]);
  const farmerIds = [...new Set([...input.farmers.map((f) => f.farmerId), ...input.allocations.map((a) => a.farmerId)])];
  const farmerCode = new Map([...input.farmers.map((f) => [f.farmerId, f.farmerCode] as const), ...input.allocations.map((a) => [a.farmerId, a.farmerCode] as const)]);
  const baseline = new Map(input.farmers.map((f) => [f.farmerId, f.baselineIncomeXof]));
  const budgetByFarmer = new Map(budget.farmers.map((f) => [f.farmerId, f]));
  const fee = input.feePolicy ?? { operatorServiceFeeXofPerFarmerSeason: 0, landFeeXofPerHaSeason: 0, investmentRecoveryFeeXofPerHaSeason: 0 };

  const seasonalAmount = input.tranches.seasonal ? (input.tranches.seasonal.amountXof ?? budget.totals.farmer_credit - budget.unallocated.farmerCreditXof) : 0;
  const investmentAmount = input.tranches.investment ? (input.tranches.investment.amountXof ?? input.capexItems.filter((c) => c.tranche === 'investment').reduce((s, c) => s + c.amountXof, 0)) : 0;
  const invT = input.tranches.investment;
  const horizon = input.horizonMonths ?? Math.max(invT?.tenorMonths ?? 0, 60);
  const invSchedule =
    invT && investmentAmount > 0
      ? buildSchedule({ principalXof: investmentAmount, rateBps: invT.rateBps, rateMethod: invT.rateMethod, tenorMonths: invT.tenorMonths, graceMonths: invT.graceMonths, graceType: invT.graceType, repaymentProfile: invT.repaymentProfile, harvestMonths: harvestMonthsWithin(input, invT.tenorMonths) })
      : [];
  const harvestMonth = input.plantings.length ? Math.max(...input.plantings.map((p) => p.harvestMonth)) : 0;

  const scenarios = {} as Record<ScenarioCode, ScenarioResult>;
  const details = {} as Record<ScenarioCode, ScenarioDetails>;

  for (const code of SCENARIOS) {
    const def = DEFS[code];
    // --- §9.1.2 production and revenue per planting
    const plantingRev = input.plantings.map((p) => {
      const y = dec((def.stressYield ? p.yieldStressTHa : p.yieldBaseTHa) ?? 0);
      const price = dec((def.stressPrice ? p.priceXofPerKgStress : p.priceXofPerKgBase) ?? 0);
      const productionT = dec(p.areaHa).times(y);
      const deliverableKg = productionT.times(1000).times(dec(1).minus(dec(p.postHarvestLossPct ?? 0).div(100))).times(dec(p.deliveryRatePct ?? 0).div(100));
      return { p, productionT, deliverableKg, revenue: deliverableKg.times(price) };
    });
    // --- farmer revenue = Σ share of planting revenue (normalised by the plot's active shares)
    const revExact = new Map<string, Dec>();
    const haExact = new Map<string, Dec>();
    for (const r of plantingRev) {
      const as = allocsByPlot.get(r.p.plotId) ?? [];
      const sum = as.reduce((s, a) => s.plus(a.sharePct), dec(0));
      for (const a of as) {
        revExact.set(a.farmerId, (revExact.get(a.farmerId) ?? dec(0)).plus(r.revenue.times(a.sharePct).div(sum)));
        haExact.set(a.farmerId, (haExact.get(a.farmerId) ?? dec(0)).plus(dec(r.p.areaHa).times(a.sharePct).div(sum)));
      }
    }
    const st = input.tranches.seasonal;
    const farmerDetails: ScenarioDetails['farmers'] = [];
    const farmers: FarmerResult[] = [];
    let feesCollected = dec(0);
    for (const fid of [...farmerIds].sort((a, b) => (farmerCode.get(a)! < farmerCode.get(b)! ? -1 : 1))) {
      const b = budgetByFarmer.get(fid);
      const principal = st ? (b?.farmerCreditXof ?? 0) : 0;
      const interest = st ? seasonalInterest(principal, st, def.delayMonths) : 0;
      const feesToFarmer = st && st.feesChargedTo === 'farmers' ? roundXof(dec(principal).times(st.upfrontFeeBps).div(10000)) : 0;
      const ha = haExact.get(fid) ?? dec(0);
      const gross = roundXof(revExact.get(fid) ?? 0);
      const debt = principal + interest + feesToFarmer;
      const invFee = roundXof(ha.times(fee.investmentRecoveryFeeXofPerHaSeason));
      const landFee = roundXof(ha.times(fee.landFeeXofPerHaSeason));
      const opFee = ha.gt(0) ? fee.operatorServiceFeeXofPerFarmerSeason : 0;
      const cash = b?.farmerCashXof ?? 0;
      const net = gross - debt - invFee - landFee - opFee - cash;
      const bl = baseline.get(fid);
      farmers.push({ farmerId: fid, ha: ha.toDecimalPlaces(4).toNumber(), grossRevenueXof: gross, seasonalDebtDueXof: debt, investmentFeeXof: invFee, landFeeXof: landFee, operatorServiceFeeXof: opFee, farmerCashCostsXof: cash, netIncomeXof: net, valueCreatedXof: bl === null || bl === undefined ? null : net - bl, hcr: debt > 0 ? roundRatio(dec(gross).div(debt)) : null });
      farmerDetails.push({ farmerId: fid, seasonalPrincipalXof: principal, seasonalInterestXof: interest, seasonalFeesXof: feesToFarmer });
      // Fees actually collectable follow the waterfall order (seasonal debt first) — D-037.
      let avail = Math.max(0, gross - debt);
      const paidInv = Math.min(avail, invFee);
      avail -= paidInv;
      const paidOp = Math.min(avail, landFee + opFee);
      feesCollected = feesCollected.plus(paidInv + paidOp);
    }
    const grossTotal = farmers.reduce((s, f) => s + f.grossRevenueXof, 0);
    const debtTotal = farmers.reduce((s, f) => s + f.seasonalDebtDueXof, 0);

    // --- §9.1.5 operator monthly cash flow over the horizon
    const inflow = Array.from({ length: horizon }, () => dec(0));
    const outflow = Array.from({ length: horizon }, () => dec(0));
    const at = (arr: Dec[], m: number, v: Dec | number) => {
      if (m >= 0 && m < horizon) arr[m] = arr[m]!.plus(v);
    };
    if (investmentAmount > 0) at(inflow, 0, investmentAmount);
    for (const c of input.capexItems) {
      at(outflow, c.month, c.amountXof);
      if (c.tranche === 'equity' || c.tranche === 'grant') at(inflow, c.month, c.amountXof);
    }
    for (const o of input.opex) for (let m = Math.max(0, o.startMonth); m <= Math.min(horizon - 1, o.endMonth ?? horizon - 1); m++) at(outflow, m, o.amountXofPerMonth);
    const spy = Math.max(1, Math.min(4, input.seasonsPerYear || 1));
    const collectionMonths: number[] = [];
    for (let y = 0; y * 12 < horizon; y++) for (let s = 0; s < spy; s++) collectionMonths.push(harvestMonth + def.delayMonths + 12 * y + Math.round((s * 12) / spy));
    for (const m of collectionMonths) at(inflow, m, feesCollected);
    for (const l of invSchedule) at(outflow, l.month, l.totalXof);
    const monthly: ScenarioResult['monthlyCashflow'] = [];
    let cum = 0;
    const nets: number[] = [];
    for (let m = 0; m < horizon; m++) {
      const i = roundXof(inflow[m]!);
      const o = roundXof(outflow[m]!);
      cum += i - o;
      nets.push(i - o);
      monthly.push({ month: m, inflowXof: i, outflowXof: o, netXof: i - o, cumulativeXof: cum });
    }
    // DSCR per year (years with debt service > 0)
    const dscrByYear: ScenarioDetails['dscrByYear'] = [];
    for (let y = 0; y * 12 < horizon; y++) {
      const months = (m: number) => m >= 12 * y && m < 12 * (y + 1);
      const fees = collectionMonths.filter(months).length * roundXof(feesCollected);
      const opexYear = input.opex.reduce((s, o) => {
        let n = 0;
        for (let m = Math.max(12 * y, o.startMonth); m < Math.min(12 * (y + 1), (o.endMonth ?? horizon - 1) + 1, horizon); m++) n++;
        return s + n * o.amountXofPerMonth;
      }, 0);
      const ds = invSchedule.filter((l) => months(l.month)).reduce((s, l) => s + l.totalXof, 0);
      const cfads = fees - opexYear;
      dscrByYear.push({ year: y + 1, cfadsXof: cfads, debtServiceXof: ds, dscr: ds > 0 ? roundRatio(dec(cfads).div(ds)) : null });
    }
    const withDs = dscrByYear.filter((d) => d.debtServiceXof > 0);
    const exactDscr = withDs.map((d) => dec(d.cfadsXof).div(d.debtServiceXof));
    const rDisc = dec(1).plus(dec(input.discountRateBps).div(10000)).pow(dec(1).div(12)).minus(1);
    const irr = irrMonthly(nets);
    let payback: number | null = null;
    let wasNeg = false;
    for (const c of monthly) {
      if (c.cumulativeXof < 0) wasNeg = true;
      else if (wasNeg) {
        payback = c.month;
        break;
      }
    }
    if (!wasNeg) payback = 0;
    // §9.1.5 breakeven multipliers: Σdebt / Σrevenue (uniform yield or price multiplier at HCR = 1)
    const be = grossTotal > 0 ? roundRatio(dec(debtTotal).div(grossTotal)) : null;
    scenarios[code] = {
      farmers,
      block: {
        grossRevenueXof: grossTotal,
        seasonalDebtDueXof: debtTotal,
        hcr: ratio(dec(grossTotal), dec(debtTotal)),
        breakevenYieldMultiplier: be,
        breakevenPriceMultiplier: be,
        minDscr: exactDscr.length ? roundRatio(exactDscr.reduce((a, b) => (b.lt(a) ? b : a))) : null,
        avgDscr: exactDscr.length ? roundRatio(exactDscr.reduce((a, b) => a.plus(b), dec(0)).div(exactDscr.length)) : null,
        operatorNpvXof: roundXof(npv(rDisc, nets)),
        operatorIrr: irr === null ? null : annualise(irr).toDecimalPlaces(4).toNumber(),
        paybackMonth: payback,
      },
      monthlyCashflow: monthly,
    };
    details[code] = {
      plantings: plantingRev.map((r) => ({ plantingId: r.p.plantingId, cropId: r.p.cropId, productionT: r.productionT.toDecimalPlaces(3).toNumber(), deliverableKg: r.deliverableKg.toDecimalPlaces(3).toNumber(), revenueXof: roundXof(r.revenue) })),
      farmers: farmerDetails,
      dscrByYear,
    };
  }

  // Breakeven yield per crop = area-weighted base yield × m_breakeven (full precision, then 2 decimals).
  const baseRev = scenarios.base.block.grossRevenueXof;
  const baseDebt = scenarios.base.block.seasonalDebtDueXof;
  const crops = [...new Set(input.plantings.map((p) => p.cropId))].sort();
  const breakevenYieldByCrop =
    baseRev > 0
      ? crops.map((cropId) => {
          const ps = input.plantings.filter((p) => p.cropId === cropId);
          const area = ps.reduce((s, p) => s.plus(p.areaHa), dec(0));
          const y = area.gt(0) ? ps.reduce((s, p) => s.plus(dec(p.yieldBaseTHa ?? 0).times(p.areaHa)), dec(0)).div(area) : dec(0);
          return { cropId, yieldTHa: roundRatio(y.times(baseDebt).div(baseRev)) };
        })
      : [];

  const combinedHcr = scenarios.combined.block.hcr;
  if (combinedHcr !== null && combinedHcr < 1) warnings.push({ code: 'HCR_STRESS_BELOW_1', message: `Combined-stress HCR is ${combinedHcr}` });
  const negatives = scenarios.base.farmers.filter((f) => f.netIncomeXof < 0);
  if (negatives.length) warnings.push({ code: 'NEGATIVE_FARMER_NET_INCOME', message: `${negatives.length} farmer(s) with negative net income in the base scenario` });

  return { engineVersion: MODEL_ENGINE_VERSION, inputsHash, scenarios, details, breakevenYieldByCrop, tranches: { seasonalAmountXof: seasonalAmount, investmentAmountXof: investmentAmount }, warnings };
}

function harvestMonthsWithin(input: ModelInput, tenor: number): number[] {
  const h = input.plantings.length ? Math.max(...input.plantings.map((p) => p.harvestMonth)) : 6;
  const out: number[] = [];
  for (let m = h; m <= tenor; m += 12) out.push(m);
  return out;
}
