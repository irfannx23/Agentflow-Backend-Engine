/**
 * Scraper domain types (M1).
 * A ScrapedContact is a normalized, engine-ready contact extracted from a
 * company's public site. Company + domain are filled at crawl time so the
 * ingest stage can tag source_type='outbound_scraped'.
 */
export interface ScrapedContact {
  email: string;
  name: string | null;
  role: string | null;
  company: string;
  domain: string;
  source_url: string;
}
