import { ScrapeJob } from "../types/job.js";
import { RawLead } from "../types/lead.js";

/**
 * All scrapers implement this interface.
 * `scrape()` is an async generator that yields batches of RawLead[].
 * The runner calls it and POSTs each batch to Go API as they come in.
 */
export abstract class BaseScraper {
  abstract readonly source: string;

  /**
   * Scrape leads for a given job.
   * Yields arrays of RawLead (batch size controlled by config.batchSize).
   * Must check signal.aborted periodically and stop if true.
   */
  abstract scrape(
    job: ScrapeJob,
    signal: AbortSignal
  ): AsyncGenerator<RawLead[], void, unknown>;
}
