import { dec, roundXof, type Dec } from './money';

export type BudgetScope = 'block' | 'plot' | 'per_ha_all' | 'per_ha_crop';
export type BudgetPayer = 'farmer_credit' | 'farmer_cash' | 'operator' | 'grant';

export interface BudgetInput {
  plots: { plotId: string; code: string; areaHa: number }[];
  allocations: { plotId: string; farmerId: string; farmerCode: string; sharePct: number }[];
  plantings: { plantingId: string; plotId: string; cropId: string; areaHa: number }[];
  lines: { lineId: string; scope: BudgetScope; plotId?: string | null; cropId?: string | null; qty: number; unitPriceXof: number; payer: BudgetPayer }[];
}

export interface FarmerBudget {
  farmerId: string;
  farmerCode: string;
  /** Farmer's hectares: Σ planted area × share. */
  ha: number;
  farmerCreditXof: number;
  farmerCashXof: number;
  byLine: Record<string, number>;
}

export interface BudgetOutput {
  lines: { lineId: string; totalXof: number; byPlot: Record<string, number> }[];
  farmers: FarmerBudget[];
  totals: Record<BudgetPayer, number>;
  unallocated: { farmerCreditXof: number; farmerCashXof: number };
  warnings: { code: string; plotId?: string; message: string }[];
}

/** Exact (unrounded) cost of a line per plot (SPEC §9.1.3 scopes). */
function lineCostByPlot(line: BudgetInput['lines'][number], plantings: BudgetInput['plantings']): Map<string, Dec> {
  const out = new Map<string, Dec>();
  const add = (plotId: string, v: Dec) => out.set(plotId, (out.get(plotId) ?? dec(0)).plus(v));
  const unit = dec(line.qty).times(line.unitPriceXof);
  switch (line.scope) {
    case 'plot':
      if (line.plotId) add(line.plotId, unit);
      break;
    case 'per_ha_all':
      for (const p of plantings) add(p.plotId, unit.times(p.areaHa));
      break;
    case 'per_ha_crop':
      for (const p of plantings) if (p.cropId === line.cropId) add(p.plotId, unit.times(p.areaHa));
      break;
    case 'block': {
      const totalArea = plantings.reduce((s, p) => s.plus(p.areaHa), dec(0));
      if (totalArea.gt(0)) for (const p of plantings) add(p.plotId, unit.times(p.areaHa).div(totalArea));
      break;
    }
  }
  return out;
}

/**
 * Allocate budget lines to plots and farmers (SPEC §9.1.3). Pure and deterministic.
 * Per line: plot cost → farmers pro rata to active share_pct; each farmer amount rounded half-even;
 * the difference to the rounded line total goes to the farmer with the largest allocation
 * (tie-break: farmer code). Plots without allocation keep their cost as unallocated (warning).
 */
export function allocateBudget(input: BudgetInput): BudgetOutput {
  const allocsByPlot = new Map<string, BudgetInput['allocations']>();
  for (const a of input.allocations) allocsByPlot.set(a.plotId, [...(allocsByPlot.get(a.plotId) ?? []), a]);
  const farmers = new Map<string, FarmerBudget>();
  const ensure = (id: string, code: string) => {
    let f = farmers.get(id);
    if (!f) {
      f = { farmerId: id, farmerCode: code, ha: 0, farmerCreditXof: 0, farmerCashXof: 0, byLine: {} };
      farmers.set(id, f);
    }
    return f;
  };
  // Hectares per farmer (planted area × normalised share).
  const haExact = new Map<string, Dec>();
  for (const p of input.plantings) {
    const as = allocsByPlot.get(p.plotId) ?? [];
    const sum = as.reduce((s, a) => s.plus(a.sharePct), dec(0));
    for (const a of as) {
      ensure(a.farmerId, a.farmerCode);
      haExact.set(a.farmerId, (haExact.get(a.farmerId) ?? dec(0)).plus(dec(p.areaHa).times(a.sharePct).div(sum)));
    }
  }
  for (const a of input.allocations) ensure(a.farmerId, a.farmerCode);

  const totals: Record<BudgetPayer, number> = { farmer_credit: 0, farmer_cash: 0, operator: 0, grant: 0 };
  const unallocated = { farmerCreditXof: 0, farmerCashXof: 0 };
  const warnings = new Map<string, { code: string; plotId?: string; message: string }>();
  const plotCode = new Map(input.plots.map((p) => [p.plotId, p.code]));
  const linesOut: BudgetOutput['lines'] = [];

  for (const line of input.lines) {
    const byPlot = lineCostByPlot(line, input.plantings);
    const exactTotal = [...byPlot.values()].reduce((s, v) => s.plus(v), dec(0));
    const totalXof = roundXof(exactTotal);
    totals[line.payer] += totalXof;
    linesOut.push({ lineId: line.lineId, totalXof, byPlot: Object.fromEntries([...byPlot].map(([k, v]) => [k, roundXof(v)])) });
    if (line.payer !== 'farmer_credit' && line.payer !== 'farmer_cash') continue;

    // Exact amount per farmer for this line.
    const exactFarmer = new Map<string, Dec>();
    let exactUnallocated = dec(0);
    for (const [plotId, cost] of byPlot) {
      const as = allocsByPlot.get(plotId) ?? [];
      const sum = as.reduce((s, a) => s.plus(a.sharePct), dec(0));
      if (as.length === 0 || sum.lte(0)) {
        exactUnallocated = exactUnallocated.plus(cost);
        warnings.set(plotId, { code: 'PLOT_WITHOUT_ALLOCATION', plotId, message: `Plot ${plotCode.get(plotId) ?? plotId} has a planting but no active allocation` });
        continue;
      }
      for (const a of as) exactFarmer.set(a.farmerId, (exactFarmer.get(a.farmerId) ?? dec(0)).plus(cost.times(a.sharePct).div(sum)));
    }
    const unallocXof = roundXof(exactUnallocated);
    const rounded = new Map([...exactFarmer].map(([k, v]) => [k, roundXof(v)]));
    const allocatedTarget = totalXof - unallocXof;
    const residual = allocatedTarget - [...rounded.values()].reduce((s, v) => s + v, 0);
    if (residual !== 0 && rounded.size > 0) {
      const largest = [...exactFarmer.entries()].sort((x, y) => {
        const c = y[1].comparedTo(x[1]);
        if (c !== 0) return c;
        const cx = farmers.get(x[0])!.farmerCode;
        const cy = farmers.get(y[0])!.farmerCode;
        return cx < cy ? -1 : cx > cy ? 1 : 0;
      })[0]![0];
      rounded.set(largest, rounded.get(largest)! + residual);
    }
    for (const [fid, amt] of rounded) {
      const fb = farmers.get(fid)!;
      fb.byLine[line.lineId] = amt;
      if (line.payer === 'farmer_credit') fb.farmerCreditXof += amt;
      else fb.farmerCashXof += amt;
    }
    if (line.payer === 'farmer_credit') unallocated.farmerCreditXof += unallocXof;
    else unallocated.farmerCashXof += unallocXof;
  }

  const farmersOut = [...farmers.values()]
    .map((f) => ({ ...f, ha: (haExact.get(f.farmerId) ?? dec(0)).toDecimalPlaces(4).toNumber() }))
    .sort((a, b) => (a.farmerCode < b.farmerCode ? -1 : a.farmerCode > b.farmerCode ? 1 : 0));
  return { lines: linesOut, farmers: farmersOut, totals, unallocated, warnings: [...warnings.values()] };
}
