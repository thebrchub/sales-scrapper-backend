/** ScrapeJob — what Redis queue contains (matches Go's queue payload). */
export interface ScrapeJob {
  campaign_id: string;
  job_id: string;
  source: string;
  city: string;
  category: string;
  urls?: string[];
}
