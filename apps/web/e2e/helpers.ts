import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { Secret, TOTP } from 'otpauth';

const PG = process.env.E2E_PG_URL ?? 'postgres://jappo:jappo@localhost:5432';
export const ADMIN = { email: 'admin@jappo.local', password: 'Jappo-Admin-2026!', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
export const PASSWORD = 'Kawral-Secure-Pass-2026';

export const totp = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();

/** Query the e2e database (to read links that would arrive by email/SMS). */
export async function dbQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: `${PG}/jappo_e2e` });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export async function latestLinkToken(destination: string, template: string): Promise<string> {
  const rows = await dbQuery<{ body: string }>(
    'select body from notifications where destination = $1 and template_code = $2 order by id desc limit 1',
    [destination, template],
  );
  const m = /token=([A-Za-z0-9_-]+)/.exec(rows[0]?.body ?? '');
  if (!m) throw new Error(`no ${template} link for ${destination}`);
  return m[1]!;
}

export async function login(page: Page, email: string, password: string, totpSecret?: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('form button[type=submit]').click();
  if (totpSecret) {
    await expect(page.locator('#totp')).toBeVisible();
    await page.locator('#totp').fill(totp(totpSecret));
    await page.locator('form button[type=submit]').click();
  }
  await page.waitForURL(/\/app/);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /déconnecter|log out/i }).click();
  await page.waitForURL(/\/login/);
}

export const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });

export async function signupOperator(page: Page, email: string, legalName = 'Ferme Commune Kawral SARL') {
  await page.goto('/signup?type=operator');
  await page.locator('#legalName').fill(legalName);
  await page.locator('#fullName').fill('Awa Diallo');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL('**/app');
}

/** ~10 ha rectangle near Ziguinchor (500 m × 200 m) as a GeoJSON FeatureCollection file. */
export function boundaryFile(lon = -16.27, lat = 12.58, widthM = 500, heightM = 200) {
  const dLon = widthM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dLat = heightM / 110_600;
  const geometry = { type: 'Polygon', coordinates: [[[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat], [lon, lat]]] };
  return { name: 'bloc.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] })) };
}

export function farmersCsv(n: number, phonePrefix = '+22177100') {
  const header = 'first_name,last_name,sex,birth_year,phone,village,national_id_number,mobile_wallet_provider,mobile_wallet_number,consent_data,consent_credit_bureau';
  const first = ['Awa', 'Fatou', 'Mariama', 'Aminata', 'Khady', 'Ndeye', 'Aïssatou', 'Seynabou', 'Coumba', 'Binta'];
  const last = ['Diatta', 'Sané', 'Badji', 'Coly', 'Sagna', 'Manga', 'Bassène', 'Diédhiou', 'Goudiaby', 'Tendeng'];
  const rows = Array.from({ length: n }, (_, i) => {
    const phone = `${phonePrefix}${String(i + 1).padStart(4, '0')}`;
    return `${first[i % 10]},${last[Math.floor(i / 2) % 10]},F,${1975 + i},${phone},Niaguis,17511990${String(i + 1).padStart(5, '0')},wave,${phone},oui,oui`;
  });
  return { name: 'farmers.csv', mimeType: 'text/csv', buffer: Buffer.from([header, ...rows].join('\n')) };
}

export const API = 'http://localhost:4100';
import type { APIRequestContext } from '@playwright/test';

/** Thin API client for e2e setup steps (the UI under test is exercised separately). */
export class E2eApi {
  constructor(
    private request: APIRequestContext,
    public token = '',
    public orgId = '',
  ) {}
  headers(extra: Record<string, string> = {}) {
    return { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(this.orgId ? { 'x-org-id': this.orgId } : {}), ...extra };
  }
  async call<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const r = await this.request.fetch(`${API}${path}`, { method, data: data as never, headers: this.headers(extra) });
    if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  }
  async upload(path: string, fields: Record<string, string>, file: { name: string; mimeType: string; buffer: Buffer }) {
    const r = await this.request.fetch(`${API}${path}`, { method: 'POST', headers: this.headers(), multipart: { ...fields, file } });
    if (!r.ok()) throw new Error(`upload ${path} → ${r.status()} ${await r.text()}`);
    return (await r.json()) as { id: string };
  }
  async me() {
    const m = await this.call<{ activeOrgId: string }>('GET', '/v1/me');
    this.orgId = m.activeOrgId;
    return m;
  }
  static async signup(request: APIRequestContext, body: Record<string, unknown>) {
    const a = new E2eApi(request);
    const r = await a.call<{ accessToken: string }>('POST', '/v1/auth/signup', { legalForm: 'SARL', fullName: 'Demo User', password: PASSWORD, locale: 'fr', ...body });
    a.token = r.accessToken;
    await a.me();
    return a;
  }
  static async login(request: APIRequestContext, email: string, password: string, totpSecret?: string) {
    const a = new E2eApi(request);
    const r = await a.call<{ accessToken: string }>('POST', '/v1/auth/login', { email, password, ...(totpSecret ? { totp: totp(totpSecret) } : {}) });
    a.token = r.accessToken;
    await a.me();
    return a;
  }
}

/** Sign up an org through the API and get it KYC-verified by the platform admin. */
export async function verifiedOrgViaApi(request: APIRequestContext, body: Record<string, unknown>) {
  const a = await E2eApi.signup(request, body);
  const docs = body.orgType === 'lender' ? ['ninea', 'rccm', 'approval_bceao'] : ['ninea', 'rccm'];
  for (const d of docs) await a.upload('/v1/orgs/current/kyc-documents', { docType: d }, pdf(`${d}.pdf`));
  await a.call('POST', '/v1/orgs/current/actions/submit-kyc');
  const admin = await E2eApi.login(request, ADMIN.email, ADMIN.password, ADMIN.totp);
  await admin.call('POST', `/v1/admin/orgs/${a.orgId}/kyc/actions/verify`, {});
  return a;
}

/**
 * API-built block whose season passes all readiness gates (mirrors apps/api/test/helpers.readyScenario).
 * Returns the operator email so the UI can log in.
 */
export async function readyScenarioViaApi(request: APIRequestContext, stamp = Date.now()) {
  const opEmail = `ready.op.${stamp}@kawral.test`;
  const op = await verifiedOrgViaApi(request, { orgType: 'operator', legalName: `Ferme Commune Kawral ${stamp % 10000} SARL`, email: opEmail });
  const buyer = await verifiedOrgViaApi(request, { orgType: 'buyer', legalName: 'Agro-Négoce Zeta SA', legalForm: 'SA', email: `ready.buyer.${stamp}@zeta.test` });
  const admin = await E2eApi.login(request, ADMIN.email, ADMIN.password, ADMIN.totp);
  const block = await op.call<{ id: string; version: number }>('POST', '/v1/blocks', { name: 'Bloc de Niaguis', region: 'Ziguinchor', commune: 'Niaguis', tenureType: 'deliberation', irrigationType: 'drip', waterSource: 'borehole' });
  const geometry = JSON.parse(boundaryFile(-16.27, 12.58, 300, 100).buffer.toString()).features[0].geometry;
  await op.call('PUT', `/v1/blocks/${block.id}/boundary`, { geometry }, { 'if-match': `"${block.version}"` });
  for (const docType of ['deliberation', 'approval_prefect', 'community_agreement']) {
    const f = await op.upload('/v1/files', {}, pdf(`${docType}.pdf`));
    const d = await op.call<{ id: string }>('POST', `/v1/blocks/${block.id}/land-documents`, { docType, fileId: f.id, number: `${docType.toUpperCase()}-2026` });
    await admin.call('POST', `/v1/admin/land-documents/${d.id}/actions/verify`, {});
  }
  const plots = (await op.call<{ data: { id: string; code: string }[] }>('POST', `/v1/blocks/${block.id}/plots/actions/auto-grid`, { count: 3, soilType: 'sablo-argileux' })).data;
  const farmers: { id: string; code: string }[] = [];
  for (const [i, [fn, ln]] of [['Awa', 'Diatta'], ['Fatou', 'Sané'], ['Mariama', 'Badji']].entries()) {
    const phone = `+2217${String(stamp).slice(-6)}${i}0`.slice(0, 13);
    const f = await op.call<{ id: string; code: string; version: number }>('POST', '/v1/farmers', { firstName: fn, lastName: ln, sex: 'F', consentData: true, consentCreditBureau: true, phone, nationalIdType: 'cni', nationalIdNumber: `1751${String(stamp).slice(-6)}${i}00`, mobileWalletProvider: 'wave', mobileWalletNumber: phone });
    await op.call('POST', `/v1/farmers/${f.id}/actions/verify-kyc`, undefined, { 'if-match': `"${f.version}"` });
    await op.call('POST', `/v1/plots/${plots[i]!.id}/allocations`, { farmerId: f.id });
    farmers.push(f);
  }
  const season = await op.call<{ id: string }>('POST', `/v1/blocks/${block.id}/seasons`, { name: 'Contre-saison 2026-27', kind: 'cold_dry', startDate: '2026-11-15', endDate: '2027-04-30' });
  const maize = (await op.call<{ data: { id: string; code: string }[] }>('GET', '/v1/crops')).data.find((c) => c.code === 'maize')!;
  const plantings = (await op.call<{ data: { id: string; version: number }[] }>('POST', `/v1/seasons/${season.id}/plantings/actions/bulk-assign`, { cropId: maize.id, plotIds: plots.map((p) => p.id), plannedHarvestDate: '2027-03-15' })).data;
  for (const p of plantings) await op.call('PATCH', `/v1/plantings/${p.id}`, { yieldBaseTHa: 7, yieldStressTHa: 6 }, { 'if-match': `"${p.version}"` });
  const npk = (await op.call<{ data: { id: string; code: string }[] }>('GET', '/v1/services')).data.find((s) => s.code === 'npk_15_15_15')!;
  for (const [i, amount] of [1_200_000, 1_000_000, 800_000].entries()) await op.call('POST', `/v1/seasons/${season.id}/budget-lines`, { scope: 'plot', plotId: plots[i]!.id, serviceId: npk.id, qty: 1, unitPriceXof: amount, payer: 'farmer_credit' });
  await op.call('PUT', `/v1/blocks/${block.id}/fee-policy`, { operatorServiceFeeXofPerFarmerSeason: 50000, landFeeXofPerHaSeason: 0, investmentRecoveryFeeXofPerHaSeason: 100000 });
  const o = await op.call<{ id: string }>('POST', '/v1/offtake-contracts', { blockId: block.id, buyerOrgId: buyer.orgId, cropId: maize.id, minVolumeKg: 15000, maxVolumeKg: 25000, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30, paysIntoEscrow: true });
  await op.call('POST', `/v1/offtake-contracts/${o.id}/actions/mark-signed`, {}, { 'if-match': '"1"' });
  return { op, opEmail, buyer, admin, blockId: block.id, seasonId: season.id, plots, farmers, offtakeId: o.id };
}

/** Verified lender whose user is org_admin + credit_officer + credit_committee with TOTP enrolled. */
export async function lenderViaApi(request: APIRequestContext, legalName: string, lenderKind: string, profile: Record<string, unknown>, stamp = Date.now()) {
  const email = `${legalName.toLowerCase().replace(/[^a-z]/g, '')}.${stamp}@lender.test`;
  const a = await verifiedOrgViaApi(request, { orgType: 'lender', lenderKind, legalName, legalForm: lenderKind === 'bank' ? 'SA' : 'mutuelle', email });
  const me = await a.call<{ user: { id: string } }>('GET', '/v1/me');
  await a.call('PATCH', `/v1/orgs/current/members/${me.user.id}`, { roles: ['org_admin', 'credit_officer', 'credit_committee'] });
  const { secret } = await a.call<{ secret: string }>('POST', '/v1/auth/mfa/enroll');
  const act = await a.call<{ accessToken: string }>('POST', '/v1/auth/mfa/activate', { code: totp(secret) });
  a.token = act.accessToken;
  await a.call('POST', '/v1/lender-profiles', { name: 'Profil', minTicketXof: 500_000, maxTicketXof: 50_000_000, maxTenorMonths: 12, trancheTypes: ['seasonal'], ...profile });
  return { api: a, email, totpSecret: secret };
}

/** Latest contract signature code sent to an email address or phone number. */
export async function signatureCode(destination: string): Promise<string> {
  const rows = await dbQuery<{ code: string }>("select data->>'code' as code from notifications where destination = $1 and template_code = 'contract.otp' order by id desc limit 1", [destination]);
  if (!rows[0]?.code) throw new Error(`no signature code for ${destination}`);
  return rows[0].code;
}

export const png = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b10000000049454e44ae426082', 'hex') });

type ContractView = { id: string; type: string; status: string; parties: { id: string; partyType: string; farmerId: string | null; canSign: boolean }[] };

/** Sign a contract through the API as the caller's organisation party (OTP read from the e2e DB). */
export async function signAsOrg(a: E2eApi, contractId: string, destination: string) {
  await a.call('POST', `/v1/contracts/${contractId}/signatures/actions/request-otp`, {});
  return a.call<ContractView>('POST', `/v1/contracts/${contractId}/signatures`, { method: 'otp', code: await signatureCode(destination) });
}

/**
 * readyScenarioViaApi + model run + frozen dossier + tender won and accepted by one lender
 * (3 000 000 XOF, 18 % flat, 1 % fee, 6 months bullet) → facility pending_cp.
 */
export async function awardedViaApi(request: APIRequestContext, stamp = Date.now()) {
  const s = await readyScenarioViaApi(request, stamp);
  await s.op.call('PUT', `/v1/seasons/${s.seasonId}/model-assumptions`, { seasonal: { rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, repaymentProfile: 'bullet', feesChargedTo: 'operator', borrowerType: 'farmers' }, investment: null });
  await s.op.call('POST', `/v1/seasons/${s.seasonId}/model-runs`);
  const dossier = await s.op.call<{ id: string }>('POST', `/v1/seasons/${s.seasonId}/dossiers`);
  const lenderName = `Mutuelle Alpha ${stamp % 10000} SFD`;
  const alpha = await lenderViaApi(request, lenderName, 'sfd', { name: 'Campagne', regions: ['Ziguinchor'] }, stamp);
  const fr = await s.op.call<{ id: string; version: number; tranches: { id: string }[] }>('POST', '/v1/financing-requests', { dossierId: dossier.id });
  await s.op.call('POST', `/v1/financing-requests/${fr.id}/actions/submit`, undefined, { 'if-match': `"${fr.version}"` });
  const rfp = await s.op.call<{ id: string; version: number }>('POST', '/v1/rfps', { financingRequestId: fr.id, lenderOrgIds: [alpha.api.orgId] });
  await s.op.call('POST', `/v1/rfps/${rfp.id}/actions/open`, {}, { 'if-match': `"${rfp.version}"` });
  const bid = await alpha.api.call<{ id: string; version: number }>('POST', `/v1/rfps/${rfp.id}/bids`, { trancheId: fr.tranches[0]!.id, amountXof: 3_000_000, rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, repaymentProfile: 'bullet', daysToDisbursement: 10, validUntil: '2027-06-30' });
  await alpha.api.call('POST', `/v1/bids/${bid.id}/actions/submit`, undefined, { 'if-match': `"${bid.version}"` });
  await s.op.call('POST', `/v1/rfps/${rfp.id}/actions/close-early`, {});
  const closed = await s.op.call<{ version: number }>('GET', `/v1/rfps/${rfp.id}`);
  await s.op.call('POST', `/v1/rfps/${rfp.id}/actions/award`, { awards: [{ bidId: bid.id, amountXof: 3_000_000 }] }, { 'if-match': `"${closed.version}"` });
  const aw = await alpha.api.call<{ data: { id: string }[] }>('GET', '/v1/lender/awards');
  await alpha.api.call('POST', `/v1/awards/${aw.data[0]!.id}/actions/accept`, {});
  const fac = (await alpha.api.call<{ data: { id: string; ref: string }[] }>('GET', `/v1/facilities?blockId=${s.blockId}`)).data[0]!;
  return { ...s, alpha, lenderName, buyerEmail: `ready.buyer.${stamp}@zeta.test`, frId: fr.id, facilityId: fac.id, facilityRef: fac.ref };
}

/** awardedViaApi + escrow + full pack signed + CPs + confirmed disbursement + season started. */
export async function activeSeasonViaApi(request: APIRequestContext, stamp = Date.now()) {
  const s = await awardedViaApi(request, stamp);
  const esc = await s.alpha.api.call<{ id: string }>('POST', '/v1/escrow-accounts', { blockId: s.blockId, bankName: 'Mutuelle Alpha SFD', accountLabel: 'Séquestre bloc', accountNumber: 'SN012 01001 000123456789' });
  const pack = await s.op.call<{ data: ContractView[] }>('POST', `/v1/blocks/${s.blockId}/contracts/actions/generate-pack`, { seasonId: s.seasonId, send: true });
  const photo = await s.op.upload('/v1/files', {}, png('sig.png'));
  for (const c of pack.data) {
    if (c.type === 'plot_production') {
      const fp = c.parties.find((p) => p.partyType === 'farmer')!;
      await s.op.call('POST', `/v1/contracts/${c.id}/signatures`, { partyId: fp.id, method: 'in_person_witnessed', evidenceFileId: photo.id });
      await signAsOrg(s.op, c.id, s.opEmail);
    } else {
      await signAsOrg(s.op, c.id, s.opEmail);
      if (c.type === 'escrow_mandate') await signAsOrg(s.buyer, c.id, s.buyerEmail);
      await signAsOrg(s.alpha.api, c.id, s.alpha.email);
      if (c.type === 'block_framework') await signAsOrg(s.buyer, c.id, s.buyerEmail);
    }
  }
  const f = await s.alpha.api.call<{ version: number }>('GET', `/v1/facilities/${s.facilityId}`);
  await s.alpha.api.call('POST', `/v1/facilities/${s.facilityId}/actions/confirm-cp`, undefined, { 'if-match': `"${f.version}"` });
  const d = await s.op.call<{ id: string }>('POST', `/v1/facilities/${s.facilityId}/disbursements`, { amountXof: 3_000_000, purpose: 'Intrants campagne', beneficiaryType: 'supplier', beneficiaryName: 'Intrants Delta SARL' });
  await s.alpha.api.call('POST', `/v1/disbursements/${d.id}/actions/approve`, {}, { 'if-match': '"1"' });
  await s.alpha.api.call('POST', `/v1/disbursements/${d.id}/actions/execute`, { bankReference: 'VIR-2026-1101' }, { 'if-match': '"2"' });
  await s.alpha.api.call('POST', `/v1/disbursements/${d.id}/actions/confirm`, {}, { 'if-match': '"3"' });
  const season = await s.op.call<{ version: number }>('GET', `/v1/seasons/${s.seasonId}`);
  await s.op.call('POST', `/v1/seasons/${s.seasonId}/actions/start`, { selfFinanced: false }, { 'if-match': `"${season.version}"` });
  return { ...s, escrowAccountId: esc.id };
}

/** activeSeasonViaApi + WF-1 harvest (1 ha plots, 12 000 / 8 000 / 3 000 kg) paid into escrow + settlement reconciled. */
export async function settledViaApi(request: APIRequestContext, stamp = Date.now(), beforeHarvest?: (s: Awaited<ReturnType<typeof activeSeasonViaApi>>) => Promise<void>) {
  const s = await activeSeasonViaApi(request, stamp);
  if (beforeHarvest) await beforeHarvest(s);
  await dbQuery('update plots set area_ha = 1 where block_id = $1', [s.blockId]);
  await dbQuery('update plantings set area_ha = 1 where season_id = $1', [s.seasonId]);
  const plots = (await s.op.call<{ data: { id: string; farmers: { farmerId: string }[] }[] }>('GET', `/v1/blocks/${s.blockId}/plots`)).data;
  const tickets: string[] = [];
  for (const [i, f] of s.farmers.entries()) {
    const p = plots.find((x) => x.farmers.some((y) => y.farmerId === f.id))!;
    tickets.push((await s.op.call<{ id: string }>('POST', `/v1/seasons/${s.seasonId}/harvest-deliveries`, { plotId: p.id, farmerId: f.id, grossKg: [12_000, 8_000, 3_000][i], grade: 'A' })).id);
  }
  const d = await s.op.call<{ id: string }>('POST', `/v1/seasons/${s.seasonId}/dispatches`, { offtakeContractId: s.offtakeId, deliveryIds: tickets });
  await s.buyer.call('POST', `/v1/dispatches/${d.id}/actions/accept`, { acceptedKg: 23_000, rejectedKg: 0 }, { 'if-match': '"1"' });
  const inv = await s.op.call<{ id: string }>('POST', '/v1/buyer-invoices', { dispatchIds: [d.id] });
  await s.alpha.api.call('POST', '/v1/escrow-receipts', { escrowAccountId: s.escrowAccountId, amountXof: 5_750_000, valueDate: new Date().toISOString().slice(0, 10), bankReference: `ZETA-${stamp}`, buyerInvoiceId: inv.id });
  let run = await s.op.call<{ id: string; version: number }>('POST', `/v1/seasons/${s.seasonId}/settlement-runs`);
  run = await s.op.call('POST', `/v1/settlement-runs/${run.id}/actions/approve-operator`, undefined, { 'if-match': `"${run.version}"` });
  run = await s.alpha.api.call('POST', `/v1/settlement-runs/${run.id}/actions/approve-lender`);
  run = await s.op.call('POST', `/v1/settlement-runs/${run.id}/actions/instruct`, undefined, { 'if-match': `"${run.version}"` });
  for (const i of (await s.op.call<{ data: { id: string; beneficiaryType: string }[] }>('GET', `/v1/settlement-runs/${run.id}/instructions`)).data) {
    await (i.beneficiaryType === 'lender' ? s.alpha.api : s.op).call('POST', `/v1/payout-instructions/${i.id}/actions/confirm`, {});
  }
  run = await s.op.call('GET', `/v1/settlement-runs/${run.id}`);
  run = await s.op.call('POST', `/v1/settlement-runs/${run.id}/actions/mark-executed`, undefined, { 'if-match': `"${run.version}"` });
  await s.op.call('POST', `/v1/settlement-runs/${run.id}/actions/reconcile`, undefined, { 'if-match': `"${run.version}"` });
  return { ...s, runId: run.id };
}
