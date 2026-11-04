import type { Browser } from 'playwright';

/** PDF adapter (SPEC §13): HTML → PDF with Playwright Chromium (worker). */
export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
  close(): Promise<void>;
}

export class ChromiumPdf implements PdfRenderer {
  private browser: Promise<Browser> | null = null;
  private launch() {
    this.browser ??= import('playwright').then(({ chromium }) =>
      chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] }),
    );
    return this.browser;
  }
  async render(html: string): Promise<Buffer> {
    const browser = await this.launch();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, footerTemplate: '<div style="font-size:7px;width:100%;text-align:center;color:#888"><span class="pageNumber"></span>/<span class="totalPages"></span></div>', headerTemplate: '<div></div>', margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' } }));
    } finally {
      await page.close();
    }
  }
  async close() {
    if (this.browser) await (await this.browser).close();
    this.browser = null;
  }
}

let shared: ChromiumPdf | null = null;
export const pdfRenderer = (): PdfRenderer => (shared ??= new ChromiumPdf());
