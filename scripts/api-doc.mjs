// Generate docs/API.md from the exported OpenAPI document (packages/sdk/openapi.json).
import { readFileSync, writeFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('../packages/sdk/openapi.json', import.meta.url), 'utf8'));
const byTag = new Map();
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const tag = op.tags?.[0] ?? 'other';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push({ method: method.toUpperCase(), path, id: op.operationId, perm: op['x-permission'], summary: (op.summary ?? '').replace(/\|/g, '\\|') });
  }
}
const lines = [
  '# Jappo API (`/v1`)',
  '',
  `Generated from the OpenAPI ${spec.openapi} document (\`pnpm sdk:gen && node scripts/api-doc.mjs\`). Interactive docs: \`/v1/docs\` on the API; typed client: \`packages/sdk\`.`,
  '',
  '## Conventions',
  '',
  '- Auth: `Authorization: Bearer <access token>` (15 min; refresh via `POST /v1/auth/refresh` with the HttpOnly cookie + `X-CSRF-Token`), or `Authorization: ApiKey <key>`; farmer portal tokens for `x-permission: farmer` routes. `X-Org-Id` selects the active organisation.',
  '- Every route declares a permission (`x-permission`); resources of other organisations answer **404**, missing permissions **403**.',
  '- Errors: RFC 9457 `application/problem+json` with a stable `code` and field `errors[]`.',
  '- Optimistic concurrency: `ETag` on reads, `If-Match: "<version>"` required on updates and state actions (428 when missing, 412 on a stale version).',
  '- `Idempotency-Key` header supported on POST; money is integer XOF; dates ISO 8601 (Africa/Dakar = UTC).',
  '- Webhooks: `Jappo-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, `Jappo-Event-Id`.',
  '',
];
for (const tag of [...byTag.keys()].sort()) {
  lines.push(`## ${tag}`, '', '| Method | Path | Operation | Permission | Summary |', '|---|---|---|---|---|');
  for (const o of byTag.get(tag).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))) lines.push(`| ${o.method} | \`${o.path}\` | \`${o.id}\` | \`${o.perm}\` | ${o.summary} |`);
  lines.push('');
}
writeFileSync(new URL('../docs/API.md', import.meta.url), lines.join('\n'));
console.log(`docs/API.md: ${[...byTag.values()].reduce((s, x) => s + x.length, 0)} operations`);
