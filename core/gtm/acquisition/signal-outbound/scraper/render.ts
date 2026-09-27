/**
 * Playwright renderer (M2) — JS-only pages.
 *
 * Some pages render their contact info entirely in JavaScript, so the static
 * HTML has no mailto links to extract. When the crawler detects a page that
 * is (a) too short to be real content or (b) script-heavy with no mailto, it
 * calls renderPage(url) to execute the JS in headless Chromium and return the
 * post-render HTML for extraction.
 *
 * Playwright is loaded LAZILY (dynamic import) and the browser is a reused
 * singleton, so the scraper CLI stays fast when no JS rendering is needed and
 * chromium only starts once, on first use.
 */
import type { Browser } from 'playwright';

const USER_AGENT = 'PreCRM-Demo-Bot/1.0 (+revops portfolio demo)';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const { chromium } = await import('playwright');
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

/** Render a URL in headless Chromium and return the post-JS HTML. */
export async function renderPage(url: string): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage({ userAgent: USER_AGENT });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);
  // page.content() serializes the live DOM AFTER scripts ran — this is the
  // post-JS HTML we extract from. (Not the static response body.)
  const finalHtml = await page.content();
  await page.close();
  return finalHtml;
}

/** Close the browser once done (frees memory). */
export async function closeRenderer(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close().catch(() => {});
    browserPromise = null;
  }
}
