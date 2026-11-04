# Jappo API (`/v1`)

Generated from the OpenAPI 3.1.0 document (`pnpm sdk:gen && node scripts/api-doc.mjs`). Interactive docs: `/v1/docs` on the API; typed client: `packages/sdk`.

## Conventions

- Auth: `Authorization: Bearer <access token>` (15 min; refresh via `POST /v1/auth/refresh` with the HttpOnly cookie + `X-CSRF-Token`), or `Authorization: ApiKey <key>`; farmer portal tokens for `x-permission: farmer` routes. `X-Org-Id` selects the active organisation.
- Every route declares a permission (`x-permission`); resources of other organisations answer **404**, missing permissions **403**.
- Errors: RFC 9457 `application/problem+json` with a stable `code` and field `errors[]`.
- Optimistic concurrency: `ETag` on reads, `If-Match: "<version>"` required on updates and state actions (428 when missing, 412 on a stale version).
- `Idempotency-Key` header supported on POST; money is integer XOF; dates ISO 8601 (Africa/Dakar = UTC).
- Webhooks: `Jappo-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, `Jappo-Event-Id`.

## admin

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/admin/audit` | `adminListAudit` | `admin:read` |  |
| POST | `/v1/admin/audit/actions/verify` | `adminVerifyAuditChain` | `admin:read` | Verify the audit hash chain |
| POST | `/v1/admin/contract-templates/preview` | `adminPreviewContractTemplate` | `contract_template:manage` | Render template text with sample data (HTML) |
| POST | `/v1/admin/crops` | `adminCreateCrop` | `admin:catalogue` |  |
| GET | `/v1/admin/holidays` | `adminListHolidays` | `admin:read` |  |
| POST | `/v1/admin/holidays` | `adminAddHoliday` | `settings:manage` | Movable religious holidays (Tabaski, Korité, …) are entered here |
| DELETE | `/v1/admin/holidays/{id}` | `adminDeleteHoliday` | `settings:manage` |  |
| GET | `/v1/admin/invoices` | `adminListInvoices` | `admin:read` |  |
| POST | `/v1/admin/invoices/{id}/actions/mark-paid` | `adminMarkInvoicePaid` | `invoice:manage` |  |
| POST | `/v1/admin/invoices/{id}/actions/void` | `adminVoidInvoice` | `invoice:manage` |  |
| GET | `/v1/admin/invoices/{id}/pdf` | `adminGetInvoicePdf` | `admin:read` |  |
| GET | `/v1/admin/land-documents` | `adminListLandDocuments` | `admin:read` |  |
| POST | `/v1/admin/land-documents/{id}/actions/reject` | `adminRejectLandDocument` | `land_document:verify` |  |
| POST | `/v1/admin/land-documents/{id}/actions/verify` | `adminVerifyLandDocument` | `land_document:verify` |  |
| POST | `/v1/admin/market-prices` | `adminCreateMarketPrice` | `admin:catalogue` |  |
| GET | `/v1/admin/orgs` | `adminListOrgs` | `admin:read` | Organisations (KYC queue with filter[kycStatus]=submitted) |
| GET | `/v1/admin/orgs/{id}` | `adminGetOrg` | `admin:read` |  |
| POST | `/v1/admin/orgs/{id}/actions/reactivate` | `adminReactivateOrg` | `admin:orgs` |  |
| POST | `/v1/admin/orgs/{id}/actions/suspend` | `adminSuspendOrg` | `admin:orgs` |  |
| POST | `/v1/admin/orgs/{id}/kyc/actions/reject` | `adminRejectOrgKyc` | `admin:kyc_review` |  |
| POST | `/v1/admin/orgs/{id}/kyc/actions/verify` | `adminVerifyOrgKyc` | `admin:kyc_review` |  |
| GET | `/v1/admin/plans` | `adminListPlans` | `admin:read` |  |
| PATCH | `/v1/admin/plans/{id}` | `adminUpdatePlan` | `plan:manage` | Prices are settings, editable by the platform admin |
| GET | `/v1/admin/settings` | `adminListSettings` | `admin:read` |  |
| PUT | `/v1/admin/settings/{key}` | `adminUpdateSetting` | `settings:manage` | Scoring weights, gate thresholds, RFP defaults, VAT, legal texts… |
| GET | `/v1/admin/webhook-deliveries` | `adminListWebhookDeliveries` | `admin:read` | Delivery monitor across organisations (failed and pending first) |

## agreements

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| POST | `/v1/blocks/{id}/contracts/actions/generate-pack` | `generateContractPack` | `contract:manage` | Framework, plot contracts for allocated farmers, offtake, loan contracts from facilities, escrow mandate |
| GET | `/v1/contract-templates` | `listContractTemplates` | `contract:read` |  |
| PATCH | `/v1/contract-templates/{id}` | `reviseContractTemplate` | `contract_template:manage` | Platform admin: creates a new active template version. Template text must be reviewed by counsel before production use. |
| GET | `/v1/contracts` | `listContracts` | `contract:read` |  |
| POST | `/v1/contracts` | `createContract` | `contract:manage` | Type + related entity; data assembled from block, season, award, offtake |
| GET | `/v1/contracts/{id}` | `getContract` | `contract:read` |  |
| PATCH | `/v1/contracts/{id}` | `updateContract` | `contract:manage` | Draft only: editable clauses; `refresh` re-assembles data from source entities |
| POST | `/v1/contracts/{id}/actions/send` | `sendContract` | `contract:manage` | Render, fix the content hash, store the PDF, notify signatories |
| POST | `/v1/contracts/{id}/actions/void` | `voidContract` | `contract:manage` |  |
| GET | `/v1/contracts/{id}/pdf` | `getContractPdf` | `contract:read` | Signed URL of the contract PDF (signed version once fully signed) |
| POST | `/v1/contracts/{id}/signatures` | `signContract` | `contract:read` | Sign with the OTP code; or in person (field agent witness + photo) for farmers |
| POST | `/v1/contracts/{id}/signatures/actions/request-otp` | `requestSignatureOtp` | `contract:read` | Send a signature code to the current principal's party (or a farmer party, for field agents) |

## api-keys

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/orgs/current/api-keys` | `listApiKeys` | `apikey:manage` |  |
| POST | `/v1/orgs/current/api-keys` | `createApiKey` | `apikey:manage` | Create an API key (shown once) |
| DELETE | `/v1/orgs/current/api-keys/{id}` | `revokeApiKey` | `apikey:manage` |  |

## auth

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| POST | `/v1/auth/login` | `login` | `public` | Email + password (+ TOTP) login |
| POST | `/v1/auth/logout` | `logout` | `public` | Revoke the session family |
| POST | `/v1/auth/mfa/activate` | `mfaActivate` | `authenticated` | Confirm TOTP enrolment |
| POST | `/v1/auth/mfa/enroll` | `mfaEnroll` | `authenticated` | Start TOTP enrolment |
| POST | `/v1/auth/otp/request` | `requestLoginOtp` | `public` | Send a login code by SMS |
| POST | `/v1/auth/otp/verify` | `verifyLoginOtp` | `public` | Log in with an SMS code |
| POST | `/v1/auth/password/forgot` | `forgotPassword` | `public` | Email a password reset link |
| POST | `/v1/auth/password/reset` | `resetPassword` | `public` | Set a new password from a reset link |
| POST | `/v1/auth/refresh` | `refreshSession` | `public` | Rotate refresh token (cookie + X-CSRF-Token) |
| POST | `/v1/auth/signup` | `signup` | `public` | Create an organisation and its first admin user |
| POST | `/v1/auth/verify-email` | `verifyEmail` | `public` | Confirm email address |
| GET | `/v1/me` | `getMe` | `authenticated` | Current principal, memberships and permissions |

## billing

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/billing/invoices` | `listPlatformInvoices` | `billing:read` |  |
| GET | `/v1/billing/invoices/{id}/pdf` | `getPlatformInvoicePdf` | `billing:read` |  |
| GET | `/v1/billing/plans` | `listPlans` | `public` | Public price list |
| GET | `/v1/billing/subscription` | `getSubscription` | `billing:read` |  |
| POST | `/v1/billing/subscription` | `changeSubscription` | `billing:manage` | Subscribe or change plan (annual seats invoiced at start) |

## buyer

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/buyer/contracts` | `listBuyerContracts` | `offtake:read` | Offtake contracts where the current organisation is the buyer |

## catalogue

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/crop-templates` | `listCropTemplates` | `catalogue:read` | Effective crop templates (operator overrides replace platform defaults) |
| POST | `/v1/crop-templates` | `createCropTemplate` | `crop_template:manage` | Operator override (or platform default when called by a platform admin) |
| PATCH | `/v1/crop-templates/{id}` | `updateCropTemplate` | `crop_template:manage` |  |
| GET | `/v1/crops` | `listCrops` | `catalogue:read` |  |
| GET | `/v1/market-prices` | `listMarketPrices` | `catalogue:read` |  |
| GET | `/v1/services` | `listServices` | `catalogue:read` |  |
| POST | `/v1/services` | `createService` | `service:manage` |  |
| PATCH | `/v1/services/{id}` | `updateService` | `service:manage` |  |
| GET | `/v1/zones` | `listZones` | `catalogue:read` |  |

## dossier

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/blocks/{id}/risk-covers` | `listRiskCovers` | `risk_cover:read` |  |
| POST | `/v1/blocks/{id}/risk-covers` | `createRiskCover` | `risk_cover:manage` |  |
| GET | `/v1/dossiers/{id}` | `getDossier` | `dossier:read` |  |
| GET | `/v1/dossiers/{id}/data-room` | `getDossierDataRoom` | `dossier:read` |  |
| GET | `/v1/dossiers/{id}/pdf` | `getDossierPdf` | `dossier:read` | Signed URL of the dossier PDF (409 while rendering) |
| PATCH | `/v1/risk-covers/{id}` | `updateRiskCover` | `risk_cover:manage` |  |
| GET | `/v1/seasons/{id}/dossiers` | `listDossiers` | `dossier:read` |  |
| POST | `/v1/seasons/{id}/dossiers` | `freezeDossier` | `dossier:freeze` | Freeze a dossier version (all gates must pass); PDF rendered asynchronously |
| GET | `/v1/seasons/{id}/readiness` | `getReadiness` | `readiness:read` | Hard gates and readiness score (SPEC §9.2) |

## facilities

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| POST | `/v1/disbursements/{id}/actions/approve` | `approveDisbursement` | `disbursement:approve` |  |
| POST | `/v1/disbursements/{id}/actions/confirm` | `confirmDisbursement` | `disbursement:approve` |  |
| POST | `/v1/disbursements/{id}/actions/execute` | `executeDisbursement` | `disbursement:execute` | Four-eyes: a different credit officer than the approver when the lender has ≥ 2 |
| POST | `/v1/disbursements/{id}/actions/reject` | `rejectDisbursement` | `disbursement:approve` |  |
| GET | `/v1/disbursements/pending` | `listPendingDisbursements` | `disbursement:read` | Requested, approved or executed disbursements of the current organisation |
| GET | `/v1/escrow-accounts` | `listEscrowAccounts` | `escrow_receipt:read` | Masked accounts: lender (own), operator (its blocks), buyer (blocks it buys from) |
| POST | `/v1/escrow-accounts` | `createEscrowAccount` | `escrow_account:manage` | Lender: block escrow account; linked to the lender's facilities and the block's offtake contracts |
| GET | `/v1/facilities` | `listFacilities` | `facility:read` |  |
| GET | `/v1/facilities/{id}` | `getFacility` | `facility:read` | Facility with schedule, farmer allocations and CP checklist |
| PATCH | `/v1/facilities/{id}` | `updateFacility` | `facility:manage` | Lender: core-banking loan reference, escrow account |
| POST | `/v1/facilities/{id}/actions/confirm-cp` | `confirmFacilityCp` | `facility:manage` | Conditions precedent met → active; schedule dated from today |
| POST | `/v1/facilities/{id}/actions/mark-default` | `markFacilityDefault` | `facility:manage` |  |
| POST | `/v1/facilities/{id}/actions/restructure` | `restructureFacility` | `facility:manage` |  |
| GET | `/v1/facilities/{id}/disbursements` | `listDisbursements` | `disbursement:read` |  |
| POST | `/v1/facilities/{id}/disbursements` | `requestDisbursement` | `disbursement:request` |  |
| GET | `/v1/facilities/{id}/repayments` | `listRepayments` | `facility:read` |  |

## farmer-portal

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| POST | `/v1/auth/farmer/otp/request` | `requestFarmerLoginOtp` | `public` |  |
| POST | `/v1/auth/farmer/otp/verify` | `verifyFarmerLoginOtp` | `public` | Short-lived farmer token (1 h, no refresh) |
| GET | `/v1/me/farmer` | `getMeFarmer` | `farmer` |  |
| GET | `/v1/me/farmer/plots` | `listMeFarmerPlots` | `farmer` |  |
| GET | `/v1/me/farmer/statements` | `listMeFarmerStatements` | `farmer` |  |
| GET | `/v1/me/farmer/statements/{id}/pdf` | `getMeFarmerStatementPdf` | `farmer` |  |

## farmers

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/farmers` | `listFarmers` | `farmer:read` |  |
| POST | `/v1/farmers` | `createFarmer` | `farmer:create` |  |
| GET | `/v1/farmers/{id}` | `getFarmer` | `farmer:read` |  |
| PATCH | `/v1/farmers/{id}` | `updateFarmer` | `farmer:update` |  |
| POST | `/v1/farmers/{id}/actions/confirm-wallet` | `confirmFarmerWallet` | `farmer:verify_wallet` |  |
| POST | `/v1/farmers/{id}/actions/verify-kyc` | `verifyFarmerKyc` | `farmer:verify_kyc` |  |
| POST | `/v1/farmers/{id}/actions/verify-wallet` | `startFarmerWalletVerification` | `farmer:verify_wallet` | Send an OTP to the wallet phone number |
| GET | `/v1/farmers/{id}/history` | `getFarmerHistory` | `farmer:read` |  |
| GET | `/v1/farmers/{id}/pii` | `revealFarmerPii` | `farmer:pii_read` | Full national id and wallet number (audited with reason) |
| POST | `/v1/farmers/import` | `importFarmers` | `farmer:import` | Bulk import farmers from CSV (multipart `file`), idempotent by phone / national id |
| GET | `/v1/farmers/import-template` | `farmerImportTemplate` | `farmer:import` | CSV template for bulk import |

## field

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/field/bootstrap` | `fieldBootstrap` | `field:sync` | Offline dataset for the field PWA (masked PII) with a sync token |
| POST | `/v1/field/sync` | `fieldSync` | `field:sync` | Apply offline operations (idempotent by clientId) and return server changes |

## files

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| POST | `/v1/files` | `uploadFile` | `file:create` | Upload a file (multipart: file, optional linkedType/linkedId). ≤ 25 MB, MIME allow-list. |
| GET | `/v1/files/{id}` | `getFile` | `file:read` |  |
| GET | `/v1/files/{id}/download` | `downloadFile` | `file:read` | 302 redirect to a 5-minute signed URL |
| GET | `/v1/files/{id}/signed-url` | `getFileSignedUrl` | `file:read` | Signed download URL (5 minutes) for browser clients that cannot follow an authenticated redirect |

## finance

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/model-runs/{id}` | `getModelRun` | `model_run:read` |  |
| GET | `/v1/seasons/{id}/model-assumptions` | `getModelAssumptions` | `model_run:read` |  |
| PUT | `/v1/seasons/{id}/model-assumptions` | `putModelAssumptions` | `model_run:create` | Tranche terms assumed for modelling (seasonal / investment) |
| POST | `/v1/seasons/{id}/model-runs` | `runModel` | `model_run:create` | Compute and store the block financial model (SPEC §9.1) |
| GET | `/v1/seasons/{id}/model-runs/current` | `getCurrentModelRun` | `model_run:read` |  |
| POST | `/v1/seasons/{id}/model-runs/preview` | `previewModel` | `model_run:read` | Unsaved what-if with yield/price shocks and rate |

## harvest

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/buyer-invoices` | `listBuyerInvoices` | `buyer_invoice:read` |  |
| POST | `/v1/buyer-invoices` | `createBuyerInvoice` | `buyer_invoice:create` | From accepted dispatches of one offtake contract; Σ accepted kg × price × grade adjustment |
| POST | `/v1/buyer-invoices/{id}/actions/dispute` | `disputeBuyerInvoice` | `dispatch:accept` |  |
| GET | `/v1/buyer-invoices/{id}/pdf` | `getBuyerInvoicePdf` | `buyer_invoice:read` |  |
| GET | `/v1/dispatches` | `listDispatches` | `dispatch:read` | Operator: by season. Buyer: its own dispatches |
| POST | `/v1/dispatches/{id}/actions/accept` | `acceptDispatch` | `dispatch:accept` | Buyer: accepted and rejected kg |
| GET | `/v1/escrow-receipts` | `listEscrowReceipts` | `escrow_receipt:read` |  |
| POST | `/v1/escrow-receipts` | `recordEscrowReceipt` | `escrow_receipt:record` | Lender (confirmed at once) or buyer (pending lender confirmation) |
| POST | `/v1/escrow-receipts/{id}/actions/confirm` | `confirmEscrowReceipt` | `escrow_receipt:confirm` |  |
| POST | `/v1/escrow-receipts/{id}/actions/reject` | `rejectEscrowReceipt` | `escrow_receipt:confirm` |  |
| POST | `/v1/harvest-deliveries/{id}/actions/void` | `voidHarvestDelivery` | `harvest:record` |  |
| GET | `/v1/seasons/{id}/dispatches` | `listSeasonDispatches` | `dispatch:read` |  |
| POST | `/v1/seasons/{id}/dispatches` | `createDispatch` | `dispatch:create` |  |
| GET | `/v1/seasons/{id}/harvest-deliveries` | `listHarvestDeliveries` | `harvest:read` |  |
| POST | `/v1/seasons/{id}/harvest-deliveries` | `recordHarvestDelivery` | `harvest:record` | Weighing ticket (net = gross − tare); grade from the offtake quality spec; idempotent by offlineClientId |

## land

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| POST | `/v1/allocations/{id}/actions/end` | `endAllocation` | `allocation:manage` |  |
| GET | `/v1/blocks` | `listBlocks` | `block:read` |  |
| POST | `/v1/blocks` | `createBlock` | `block:create` |  |
| GET | `/v1/blocks/{id}` | `getBlock` | `block:read` |  |
| PATCH | `/v1/blocks/{id}` | `updateBlock` | `block:update` |  |
| POST | `/v1/blocks/{id}/actions/archive` | `archiveBlock` | `block:archive` |  |
| POST | `/v1/blocks/{id}/actions/check-readiness` | `checkBlockReadiness` | `block:update` | Move the block documenting ↔ ready from a season readiness |
| GET | `/v1/blocks/{id}/assets` | `listBlockAssets` | `block:read` |  |
| POST | `/v1/blocks/{id}/assets` | `createBlockAsset` | `asset:manage` |  |
| PUT | `/v1/blocks/{id}/boundary` | `setBlockBoundary` | `block:update` | Set boundary from GeoJSON (Polygon/MultiPolygon) or an uploaded GeoJSON/KML file |
| GET | `/v1/blocks/{id}/grievances` | `listGrievances` | `block:read` |  |
| POST | `/v1/blocks/{id}/grievances` | `createGrievance` | `grievance:manage` |  |
| GET | `/v1/blocks/{id}/land-documents` | `listLandDocuments` | `land_document:read` |  |
| POST | `/v1/blocks/{id}/land-documents` | `createLandDocument` | `land_document:create` | Register a land document (file uploaded via POST /files) |
| GET | `/v1/blocks/{id}/map` | `getBlockMap` | `block:read` |  |
| GET | `/v1/blocks/{id}/plots` | `listPlots` | `plot:read` |  |
| POST | `/v1/blocks/{id}/plots` | `createPlot` | `plot:create` |  |
| POST | `/v1/blocks/{id}/plots/actions/auto-grid` | `autoGridPlots` | `plot:create` | Split the boundary into N equal-area plots along the longest axis |
| PATCH | `/v1/grievances/{id}` | `updateGrievance` | `grievance:manage` |  |
| DELETE | `/v1/plots/{id}` | `archivePlot` | `plot:update` | Archive a plot (soft delete) |
| GET | `/v1/plots/{id}` | `getPlot` | `plot:read` |  |
| PATCH | `/v1/plots/{id}` | `updatePlot` | `plot:update` |  |
| GET | `/v1/plots/{id}/allocations` | `listAllocations` | `plot:read` |  |
| POST | `/v1/plots/{id}/allocations` | `createAllocation` | `allocation:manage` |  |

## marketplace

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| POST | `/v1/awards/{id}/actions/accept` | `acceptAward` | `award:respond` |  |
| POST | `/v1/awards/{id}/actions/decline` | `declineAward` | `award:respond` |  |
| GET | `/v1/bids/{id}` | `getBid` | `bid:read` |  |
| PATCH | `/v1/bids/{id}` | `updateBid` | `bid:draft` |  |
| POST | `/v1/bids/{id}/actions/submit` | `submitBid` | `bid:submit` |  |
| POST | `/v1/bids/{id}/actions/withdraw` | `withdrawBid` | `bid:submit` |  |
| POST | `/v1/bids/preview` | `previewBid` | `bid:draft` | Live EAR and schedule for bid terms |
| GET | `/v1/financing-requests` | `listFinancingRequests` | `financing_request:read` |  |
| POST | `/v1/financing-requests` | `createFinancingRequest` | `financing_request:manage` | From a frozen dossier; tranches default from the model assumptions |
| GET | `/v1/financing-requests/{id}` | `getFinancingRequest` | `financing_request:read` |  |
| PATCH | `/v1/financing-requests/{id}` | `updateFinancingRequest` | `financing_request:manage` |  |
| POST | `/v1/financing-requests/{id}/actions/cancel` | `cancelFinancingRequest` | `financing_request:manage` |  |
| POST | `/v1/financing-requests/{id}/actions/submit` | `submitFinancingRequest` | `financing_request:submit` |  |
| GET | `/v1/financing-requests/{id}/matches` | `getFinancingRequestMatches` | `financing_request:read` |  |
| GET | `/v1/lender-profiles` | `listLenderProfiles` | `lender_profile:read` |  |
| POST | `/v1/lender-profiles` | `createLenderProfile` | `lender_profile:manage` |  |
| PATCH | `/v1/lender-profiles/{id}` | `updateLenderProfile` | `lender_profile:manage` |  |
| GET | `/v1/lender-profiles/{id}/preview` | `previewLenderProfile` | `lender_profile:read` | How many open financing requests this profile matches |
| GET | `/v1/lender/awards` | `listLenderAwards` | `rfp:read` |  |
| GET | `/v1/lender/opportunities` | `listOpportunities` | `rfp:read` | Invitations of the current lender with RFP summary |
| POST | `/v1/rfps` | `createRfp` | `rfp:manage` | Create a draft RFP; invitees default to all matching lenders |
| GET | `/v1/rfps/{id}` | `getRfp` | `rfp:read` |  |
| POST | `/v1/rfps/{id}/actions/award` | `awardRfp` | `award:decide` |  |
| POST | `/v1/rfps/{id}/actions/cancel` | `cancelRfp` | `rfp:manage` |  |
| POST | `/v1/rfps/{id}/actions/close-early` | `closeRfpEarly` | `rfp:manage` |  |
| POST | `/v1/rfps/{id}/actions/decline` | `declineRfp` | `rfp:respond` |  |
| POST | `/v1/rfps/{id}/actions/extend` | `extendRfp` | `rfp:manage` |  |
| POST | `/v1/rfps/{id}/actions/open` | `openRfp` | `rfp:manage` |  |
| POST | `/v1/rfps/{id}/actions/view` | `viewRfp` | `rfp:respond` |  |
| GET | `/v1/rfps/{id}/awards` | `listRfpAwards` | `rfp:read` |  |
| GET | `/v1/rfps/{id}/bids` | `listRfpBids` | `bid:read` | Lenders: own bids. Operator: all bids, only after close (sealed) |
| POST | `/v1/rfps/{id}/bids` | `createBid` | `bid:draft` |  |
| GET | `/v1/rfps/{id}/evaluation` | `getRfpEvaluation` | `rfp:manage` | Scores, ranks, suggested allocation (after close) |
| GET | `/v1/rfps/{id}/questions` | `listRfpQuestions` | `rfp:read` |  |
| POST | `/v1/rfps/{id}/questions` | `askRfpQuestion` | `rfp_question:ask` |  |
| POST | `/v1/rfps/{id}/questions/{qid}/answer` | `answerRfpQuestion` | `rfp_question:answer` |  |

## members

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| POST | `/v1/invitations/accept` | `acceptInvitation` | `public` |  |
| GET | `/v1/invitations/lookup` | `lookupInvitation` | `public` |  |
| GET | `/v1/orgs/current/invitations` | `listInvitations` | `member:manage` |  |
| POST | `/v1/orgs/current/invitations` | `createInvitation` | `member:manage` |  |
| DELETE | `/v1/orgs/current/invitations/{id}` | `revokeInvitation` | `member:manage` |  |
| GET | `/v1/orgs/current/members` | `listMembers` | `member:manage` |  |
| PATCH | `/v1/orgs/current/members/{userId}` | `updateMember` | `member:manage` |  |

## monitoring

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/dashboards/block/{id}` | `getBlockDashboard` | `dashboard:read` |  |
| GET | `/v1/dashboards/guarantor` | `getGuarantorDashboard` | `dashboard:read` | Covered facilities, exposure, PAR, claim candidates |
| GET | `/v1/dashboards/lender` | `getLenderDashboard` | `dashboard:read` | Portfolio KPIs (outstanding, PAR, repayment rate) and pending approvals |
| GET | `/v1/dashboards/operator` | `getOperatorDashboard` | `dashboard:read` | KPIs, blocks by status, open alerts, tasks |
| GET | `/v1/kpis` | `listKpis` | `kpi:read` | Nightly KPI snapshots for a scope |
| GET | `/v1/reports` | `listReports` | `report:read` |  |
| POST | `/v1/reports` | `createReport` | `report:create` | Generate a PDF report (lender monthly, season close, guarantor portfolio) |
| GET | `/v1/reports/{id}` | `getReport` | `report:read` |  |

## notifications

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/notifications` | `listMyNotifications` | `authenticated` |  |
| POST | `/v1/notifications/{id}/actions/read` | `markNotificationRead` | `authenticated` |  |

## offtake

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/offtake-contracts` | `listOfftakeContracts` | `offtake:read` |  |
| POST | `/v1/offtake-contracts` | `createOfftakeContract` | `offtake:manage` |  |
| GET | `/v1/offtake-contracts/{id}` | `getOfftakeContract` | `offtake:read` |  |
| PATCH | `/v1/offtake-contracts/{id}` | `updateOfftakeContract` | `offtake:manage` |  |
| POST | `/v1/offtake-contracts/{id}/actions/mark-loi` | `markOfftakeLoi` | `offtake:manage` |  |
| POST | `/v1/offtake-contracts/{id}/actions/mark-signed` | `markOfftakeSigned` | `offtake:manage` |  |
| POST | `/v1/offtake-contracts/{id}/actions/terminate` | `terminateOfftake` | `offtake:manage` |  |

## operations

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/alert-rules` | `listAlertRules` | `alert:read` |  |
| PATCH | `/v1/alert-rules/{code}` | `updateAlertRule` | `alert_rule:manage` | Platform admin: enable/disable and tune parameters |
| POST | `/v1/alerts/{id}/actions/acknowledge` | `acknowledgeAlert` | `alert:manage` |  |
| POST | `/v1/alerts/{id}/actions/resolve` | `resolveAlert` | `alert:manage` |  |
| GET | `/v1/blocks/{id}/alerts` | `listBlockAlerts` | `alert:read` |  |
| POST | `/v1/blocks/{id}/alerts` | `createManualAlert` | `alert:manage` |  |
| POST | `/v1/blocks/{id}/alerts/actions/evaluate` | `evaluateBlockAlerts` | `alert:manage` | Run the alert rules for the block now |
| POST | `/v1/farmers/{id}/actions/request-ack-code` | `requestFarmerAckCode` | `harvest:record` | SMS code for the farmer to acknowledge a service or harvest delivery |
| GET | `/v1/plots/{id}/visits` | `listPlotVisits` | `visit:read` |  |
| POST | `/v1/plots/{id}/visits` | `recordPlotVisit` | `visit:record` | Field visit; alert rules re-evaluated for the block |
| GET | `/v1/seasons/{id}/service-deliveries` | `listServiceDeliveries` | `service_delivery:read` |  |
| POST | `/v1/seasons/{id}/service-deliveries` | `recordServiceDelivery` | `service_delivery:record` | Idempotent by offlineClientId; farmer acknowledgement by SMS code or signature photo |

## orgs

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/orgs/current` | `getCurrentOrg` | `org:read` |  |
| PATCH | `/v1/orgs/current` | `updateCurrentOrg` | `org:update` |  |
| POST | `/v1/orgs/current/actions/submit-kyc` | `submitKyc` | `org:update` | Submit KYC documents for review |
| GET | `/v1/orgs/current/kyc-documents` | `listKycDocuments` | `org:read` |  |
| POST | `/v1/orgs/current/kyc-documents` | `uploadKycDocument` | `org:update` | Upload a KYC document (multipart: docType, file) |
| GET | `/v1/orgs/directory` | `orgDirectory` | `org:directory` | Public profiles of verified lenders, buyers, guarantors, insurers, suppliers |

## planning

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/blocks/{id}/capex-items` | `listCapexItems` | `budget:read` |  |
| POST | `/v1/blocks/{id}/capex-items` | `createCapexItem` | `capex:manage` |  |
| GET | `/v1/blocks/{id}/fee-policy` | `getFeePolicy` | `budget:read` |  |
| PUT | `/v1/blocks/{id}/fee-policy` | `putFeePolicy` | `fee_policy:manage` |  |
| GET | `/v1/blocks/{id}/operator-opex` | `listOperatorOpex` | `budget:read` |  |
| POST | `/v1/blocks/{id}/operator-opex` | `createOperatorOpex` | `opex:manage` |  |
| GET | `/v1/blocks/{id}/seasons` | `listSeasons` | `season:read` |  |
| POST | `/v1/blocks/{id}/seasons` | `createSeason` | `season:create` |  |
| DELETE | `/v1/budget-lines/{id}` | `deleteBudgetLine` | `budget:manage` |  |
| PATCH | `/v1/budget-lines/{id}` | `updateBudgetLine` | `budget:manage` |  |
| DELETE | `/v1/capex-items/{id}` | `deleteCapexItem` | `capex:manage` |  |
| DELETE | `/v1/operator-opex/{id}` | `deleteOperatorOpex` | `opex:manage` |  |
| DELETE | `/v1/plantings/{id}` | `deletePlanting` | `planting:manage` |  |
| PATCH | `/v1/plantings/{id}` | `updatePlanting` | `planting:manage` |  |
| GET | `/v1/seasons/{id}` | `getSeason` | `season:read` |  |
| PATCH | `/v1/seasons/{id}` | `updateSeason` | `season:update` |  |
| POST | `/v1/seasons/{id}/actions/cancel` | `cancelSeason` | `season:cancel` |  |
| POST | `/v1/seasons/{id}/actions/start` | `startSeason` | `season:start` | Start the season (confirmed disbursement or self-financed) |
| GET | `/v1/seasons/{id}/budget-lines` | `listBudgetLines` | `budget:read` |  |
| POST | `/v1/seasons/{id}/budget-lines` | `createBudgetLine` | `budget:manage` |  |
| POST | `/v1/seasons/{id}/budget-lines/actions/generate-from-templates` | `generateBudgetFromTemplates` | `budget:manage` |  |
| GET | `/v1/seasons/{id}/budget-summary` | `getBudgetSummary` | `budget:read` | Budget totals by payer, per ha and per farmer (SPEC §9.1.3 allocation) |
| GET | `/v1/seasons/{id}/plantings` | `listPlantings` | `season:read` |  |
| POST | `/v1/seasons/{id}/plantings` | `createPlanting` | `planting:manage` |  |
| POST | `/v1/seasons/{id}/plantings/actions/bulk-assign` | `bulkAssignPlantings` | `planting:manage` | Plant one crop on many plots (full plot area); plots already planted are skipped |
| GET | `/v1/supplier-quotes` | `listSupplierQuotes` | `quote:read` |  |
| POST | `/v1/supplier-quotes` | `createSupplierQuote` | `quote:manage` |  |

## settlement

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/farmer-statements/{id}/pdf` | `getFarmerStatementPdf` | `statement:read` |  |
| GET | `/v1/farmers/{id}/arrears` | `listFarmerArrears` | `farmer:read` |  |
| POST | `/v1/payout-instructions/{id}/actions/confirm` | `confirmPayoutInstruction` | `payout:confirm` | Operator for farmer/operator payouts; the receiving lender for its own lines (posts the repayment) |
| POST | `/v1/payout-instructions/{id}/actions/fail` | `failPayoutInstruction` | `payout:confirm` | Operator for farmer/operator payouts; the receiving lender for its own lines (posts the repayment) |
| GET | `/v1/seasons/{id}/settlement-runs` | `listSettlementRuns` | `settlement:read` |  |
| POST | `/v1/seasons/{id}/settlement-runs` | `computeSettlementRun` | `settlement:compute` | Compute the waterfall (SPEC §9.6) from confirmed receipts and accepted deliveries; season → settlement |
| GET | `/v1/settlement-runs` | `listVisibleSettlementRuns` | `settlement:read` |  |
| GET | `/v1/settlement-runs/{id}` | `getSettlementRun` | `settlement:read` | With lines and distribution |
| POST | `/v1/settlement-runs/{id}/actions/approve-lender` | `approveSettlementLender` | `settlement:approve_lender` |  |
| POST | `/v1/settlement-runs/{id}/actions/approve-operator` | `approveSettlementOperator` | `settlement:approve_operator` |  |
| POST | `/v1/settlement-runs/{id}/actions/instruct` | `instructSettlementRun` | `settlement:instruct` |  |
| POST | `/v1/settlement-runs/{id}/actions/mark-executed` | `markSettlementExecuted` | `settlement:reconcile` |  |
| POST | `/v1/settlement-runs/{id}/actions/recompute` | `recomputeSettlementRun` | `settlement:compute` |  |
| POST | `/v1/settlement-runs/{id}/actions/reconcile` | `reconcileSettlementRun` | `settlement:reconcile` |  |
| GET | `/v1/settlement-runs/{id}/instructions` | `listPayoutInstructions` | `settlement:read` | `?format=generic\|wave\|orange_money` returns the CSV export (operator) and marks rows exported |
| POST | `/v1/settlement-runs/{id}/instructions/actions/import-confirmations` | `importPayoutConfirmations` | `payout:confirm` | CSV `reference,status,provider_ref,reason` from the bank or mobile-money provider |
| GET | `/v1/settlement-runs/{id}/statements` | `listFarmerStatements` | `statement:read` |  |
| POST | `/v1/settlement-runs/{id}/statements/actions/send` | `sendFarmerStatements` | `statement:send` | SMS summary to every farmer (PDF available in the farmer portal) |

## system

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/health` | `health` | `public` |  |
| GET | `/v1/legal/{doc}` | `getLegalText` | `public` | Terms of use / privacy text managed by the platform admin |
| GET | `/v1/modules` | `listModules` | `authenticated` | Active modules and navigation entries for the current organisation (SPEC §11.3) |
| GET | `/v1/ready` | `ready` | `public` |  |

## webhooks

| Method | Path | Operation | Permission | Summary |
|---|---|---|---|---|
| GET | `/v1/events` | `listEvents` | `event:read` | Org-scoped event feed for polling integrations |
| GET | `/v1/webhooks` | `listWebhooks` | `webhook:manage` |  |
| POST | `/v1/webhooks` | `createWebhook` | `webhook:manage` | The signing secret is returned once |
| DELETE | `/v1/webhooks/{id}` | `deleteWebhook` | `webhook:manage` |  |
| POST | `/v1/webhooks/{id}/actions/test` | `testWebhook` | `webhook:manage` |  |
| GET | `/v1/webhooks/{id}/deliveries` | `listWebhookDeliveries` | `webhook:manage` |  |
