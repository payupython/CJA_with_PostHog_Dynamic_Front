import type { Browser } from 'playwright';

export type AvailabilityStatus = 'available' | 'sold_out' | 'limited' | 'unknown';

export interface ScanOptions {
  maxDaysAhead?: number;
}

export interface ScanAdapter {
  scan(browser: Browser, siteId: number, options?: ScanOptions): Promise<void>;
}

export interface SelectorConfig {
  container?: string;
  title?: string;
  date?: string;
  status?: {
    available?: string;
    sold_out?: string;
    limited?: string;
  };
  statusText?: {
    available?: string[];
    sold_out?: string[];
    limited?: string[];
  };
}

export interface ScraperOptions {
  timeout?: number;
  waitAfterLoad?: number;
  userAgent?: string;
  useRandomDelay?: boolean;
  minDelay?: number;
  maxDelay?: number;
}

export interface ScraperResult {
  status: AvailabilityStatus;
  confidence: number;
  raw_text: string;
  timestamp: Date;
  eventDate?: string; // ISO string or similar
}
