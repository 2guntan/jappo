import { dec, roundXof, splitProRata } from './money';

export const SETTLEMENT_ENGINE_VERSION = '1.0.0';

export interface SettlementFarmerInput {
  farmerId: string;
  /** Tie-breaker for every split (SPEC §9.6.4 rounding rule). */
  farmerCode: string;
  /** Accepted net kg by price and grade adjustment → gross credit G_i (rounded half-even per farmer). */
  deliveries: { netKg: number; priceXofPerKg: number; adjustmentPct: number }[];
  /** Seasonal debt due this season per facility (principal + interest + farmer-borne fees, incl. carried-over arrears). */
  seasonalDue: { facilityId: string; amountXof: number }[];
  investmentFeeXof: number;
  landFeeXof: number;
  operatorServiceFeeXof: number;
  /** Other agreed deductions, designated to the operator. */
  otherDeductionsXof: number;
}

export interface SettlementInput {
  /** Σ lender-confirmed escrow receipts for the block-season (R). */
  receiptsTotalXof: number;
  farmers: SettlementFarmerInput[];
  /** Seasonal facilities with their total due amount (for the lender split). */
  seasonalFacilities: { facilityId: string; dueXof: number }[];
  /** Operator investment instalments due this season (when the operator is the investment borrower). */
  operatorInvestmentDueXof: number;
  /** `applies` = group mode and the seasonal borrower is the farmer group or farmers with group guarantee. */
  solidarity: { mode: 'none' | 'group'; capPct: number; applies?: boolean };
}

export interface SettlementLine {
  farmerId: string;
  farmerCode: string;
  grossCreditXof: number;
  seasonalPaidXof: number;
  /** Seasonal paid per facility (before solidarity), for repayment posting. */
  seasonalPaidByFacility: { facilityId: string; amountXof: number }[];
  investmentFeePaidXof: number;
  operatorFeesPaidXof: number;
  otherDeductionsXof: number;
  solidarityContributionXof: number;
  solidarityReceivedXof: number;
  payoutXof: number;
  arrears: { seasonalDebtXof: number; investmentFeeXof: number; operatorFeesXof: number };
}

export interface SettlementOutput {
  engineVersion: string;
  receiptsTotalXof: number;
  grossCreditTotalXof: number;
  lines: SettlementLine[];
  distribution: {
    seasonalByFacility: { facilityId: string; amountXof: number }[];
    investmentToLenderXof: number;
    investmentExcessToOperatorXof: number;
    operatorXof: number;
    farmersTotalXof: number;
    roundingToOperatorXof: number;
  };
  invariants: { sumEqualsReceipts: boolean };
}

const byCode = <T extends { farmerCode: string }>(a: T, b: T) => (a.farmerCode < b.farmerCode ? -1 : a.farmerCode > b.farmerCode ? 1 : 0);

/** Step 1: scale gross credits to receipts — floor, residual to the largest G_i (tie: farmer code). */
function scaleToReceipts(gross: { farmerCode: string; g: number }[], R: number): number[] {
  const G = gross.reduce((s, x) => s + x.g, 0);
  if (G === R) return gross.map((x) => x.g);
  if (G <= 0) return gross.map(() => 0);
  const scaled = gross.map((x) => dec(x.g).times(R).div(G).floor().toNumber());
  const residual = R - scaled.reduce((s, x) => s + x, 0);
  if (residual !== 0) {
    let best = 0;
    gross.forEach((x, i) => {
      const b = gross[best]!;
      if (x.g > b.g || (x.g === b.g && x.farmerCode < b.farmerCode)) best = i;
    });
    scaled[best]! += residual;
  }
  return scaled;
}

/** Settlement waterfall (SPEC §9.6). Pure and deterministic; all amounts integer XOF. */
export function computeSettlement(input: SettlementInput): SettlementOutput {
  const R = input.receiptsTotalXof;
  const farmers = [...input.farmers].sort(byCode);
  const grossRaw = farmers.map((f) => ({ farmerCode: f.farmerCode, g: roundXof(f.deliveries.reduce((s, d) => s.plus(dec(d.netKg).times(d.priceXofPerKg).times(dec(100).plus(d.adjustmentPct)).div(100)), dec(0))) }));
  const G = grossRaw.reduce((s, x) => s + x.g, 0);
  const scaled = scaleToReceipts(grossRaw, R);

  // Step 2: per-farmer waterfall.
  const lines: SettlementLine[] = farmers.map((f, i) => {
    let avail = scaled[i]!;
    const take = (due: number) => {
      const paid = Math.min(Math.max(due, 0), avail);
      avail -= paid;
      return paid;
    };
    const seasonalDue = f.seasonalDue.reduce((s, x) => s + x.amountXof, 0);
    const seasonalPaid = take(seasonalDue);
    const invest = take(f.investmentFeeXof);
    const opFeesDue = f.landFeeXof + f.operatorServiceFeeXof;
    const opFees = take(opFeesDue);
    const other = take(f.otherDeductionsXof);
    // Seasonal paid split across this farmer's facilities pro rata to due (floor + largest remainder, ties by facility id).
    const byFac = splitProRata(seasonalPaid, f.seasonalDue.map((x) => ({ key: x.facilityId, weight: x.amountXof, cap: x.amountXof })));
    return {
      farmerId: f.farmerId,
      farmerCode: f.farmerCode,
      grossCreditXof: scaled[i]!,
      seasonalPaidXof: seasonalPaid,
      seasonalPaidByFacility: f.seasonalDue.map((x) => ({ facilityId: x.facilityId, amountXof: byFac.get(x.facilityId) ?? 0 })),
      investmentFeePaidXof: invest,
      operatorFeesPaidXof: opFees,
      otherDeductionsXof: other,
      solidarityContributionXof: 0,
      solidarityReceivedXof: 0,
      payoutXof: avail,
      arrears: { seasonalDebtXof: seasonalDue - seasonalPaid, investmentFeeXof: f.investmentFeeXof - invest, operatorFeesXof: opFeesDue - opFees + (f.otherDeductionsXof - other) },
    };
  });

  // Step 3: solidarity — only for the seasonal bucket.
  const solidarityApplies = input.solidarity.mode === 'group' && input.solidarity.applies !== false;
  let solidarityTotal = 0;
  if (solidarityApplies) {
    const S = lines.reduce((s, l) => s + l.arrears.seasonalDebtXof, 0);
    const contributors = lines.filter((l) => l.payoutXof > 0);
    if (S > 0 && contributors.length) {
      const caps = new Map(contributors.map((l) => [l.farmerCode, dec(l.payoutXof).times(input.solidarity.capPct).div(100).floor().toNumber()]));
      const capTotal = [...caps.values()].reduce((s, x) => s + x, 0);
      solidarityTotal = Math.min(S, capTotal);
      const contrib = splitProRata(solidarityTotal, contributors.map((l) => ({ key: l.farmerCode, weight: l.payoutXof, cap: caps.get(l.farmerCode)! })));
      for (const l of contributors) {
        const c = contrib.get(l.farmerCode) ?? 0;
        l.solidarityContributionXof = c;
        l.payoutXof -= c;
      }
      const short = lines.filter((l) => l.arrears.seasonalDebtXof > 0);
      const received = splitProRata(solidarityTotal, short.map((l) => ({ key: l.farmerCode, weight: l.arrears.seasonalDebtXof, cap: l.arrears.seasonalDebtXof })));
      for (const l of short) {
        const r = received.get(l.farmerCode) ?? 0;
        l.solidarityReceivedXof = r;
        l.arrears.seasonalDebtXof -= r;
      }
    }
  }

  // Step 4: block-level distribution.
  const seasonalTotal = lines.reduce((s, l) => s + l.seasonalPaidXof + l.solidarityReceivedXof, 0);
  const seasonalSplit = splitProRata(seasonalTotal, input.seasonalFacilities.map((f) => ({ key: f.facilityId, weight: f.dueXof })));
  const seasonalByFacility = input.seasonalFacilities.map((f) => ({ facilityId: f.facilityId, amountXof: seasonalSplit.get(f.facilityId) ?? 0 }));
  const seasonalDistributed = seasonalByFacility.reduce((s, x) => s + x.amountXof, 0);
  const investTotal = lines.reduce((s, l) => s + l.investmentFeePaidXof, 0);
  const investmentToLenderXof = Math.min(investTotal, Math.max(input.operatorInvestmentDueXof, 0));
  const investmentExcessToOperatorXof = investTotal - investmentToLenderXof;
  const operatorBase = lines.reduce((s, l) => s + l.operatorFeesPaidXof + l.otherDeductionsXof, 0) + investmentExcessToOperatorXof;
  const farmersTotalXof = lines.reduce((s, l) => s + l.payoutXof, 0);
  // Receipts not explained by deliveries (G = 0) and any rounding residual go to the operator (SPEC §9.6.2 step 4).
  const roundingToOperatorXof = R - (seasonalDistributed + investmentToLenderXof + operatorBase + farmersTotalXof);
  const operatorXof = operatorBase + roundingToOperatorXof;
  return {
    engineVersion: SETTLEMENT_ENGINE_VERSION,
    receiptsTotalXof: R,
    grossCreditTotalXof: G,
    lines,
    distribution: { seasonalByFacility, investmentToLenderXof, investmentExcessToOperatorXof, operatorXof, farmersTotalXof, roundingToOperatorXof },
    invariants: { sumEqualsReceipts: seasonalDistributed + investmentToLenderXof + operatorXof + farmersTotalXof === R },
  };
}
