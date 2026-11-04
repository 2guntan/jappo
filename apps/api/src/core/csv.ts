/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF); auto-detects `,` or `;` delimiter. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\u{FEFF}/u, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function csvToObjects(text: string): { header: string[]; rows: Record<string, string>[] } {
  const [header = [], ...data] = parseCsv(text);
  const h = header.map((x) => x.trim().toLowerCase());
  return { header: h, rows: data.map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? '').trim()]))) };
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]): string => [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
