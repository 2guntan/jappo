import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/** Stamp every page with a diagonal confidentiality watermark (SPEC §14.1). */
export async function watermarkPdf(pdf: Buffer, text: string): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const safe = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '-');
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(28, (width * 1.1) / Math.max(10, safe.length) / 0.5);
    page.drawText(safe, { x: width * 0.12, y: height * 0.3, size, font, color: rgb(0.75, 0.1, 0.1), opacity: 0.25, rotate: degrees(35) });
    page.drawText(safe, { x: 20, y: 12, size: 7, font, color: rgb(0.5, 0.5, 0.5), opacity: 0.8 });
  }
  return Buffer.from(await doc.save());
}

export const watermarkText = (orgName: string, at = new Date()) =>
  `Confidentiel / Confidential - ${orgName} - ${at.toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' })}`;
