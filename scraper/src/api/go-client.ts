import axios, { AxiosInstance } from "axios";
import { config } from "../config.js";
import { RawLead, LeadBatchResponse } from "../types/lead.js";
import { log } from "../utils/logger.js";

/**
 * HTTP client for the Go API.
 * Handles JWT auth (login + auto-refresh on 401).
 */
export class GoClient {
  private http: AxiosInstance;
  private accessToken = "";
  private refreshToken = "";

  constructor() {
    this.http = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: 30_000,
      headers: { "Content-Type": "application/json" },
    });

    // Interceptor: attach access token
    this.http.interceptors.request.use((req) => {
      if (this.accessToken) {
        req.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return req;
    });

    // Interceptor: auto-refresh on 401
    this.http.interceptors.response.use(undefined, async (error) => {
      const original = error.config;
      if (
        error.response?.status === 401 &&
        !original._retry &&
        this.refreshToken
      ) {
        original._retry = true;
        await this.refresh();
        original.headers.Authorization = `Bearer ${this.accessToken}`;
        return this.http(original);
      }
      throw error;
    });
  }

  /** Authenticate with Go API — call once on startup. */
  async login(): Promise<void> {
    const { data } = await this.http.post("/auth/login", {
      username: config.serviceUser,
      password: config.servicePass,
    });
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    log.info("authenticated with Go API");
  }

  /** Refresh the JWT tokens. */
  private async refresh(): Promise<void> {
    try {
      const { data } = await axios.post(
        `${config.apiBaseUrl}/auth/refresh`,
        null,
        { headers: { Authorization: `Bearer ${this.refreshToken}` } }
      );
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
    } catch {
      // Refresh failed — re-login from scratch
      await this.login();
    }
  }

  /** POST /internal/leads/batch — send scraped leads to Go API. */
  async submitLeads(
    jobId: string,
    leads: RawLead[]
  ): Promise<LeadBatchResponse> {
    const { data } = await this.http.post<LeadBatchResponse>(
      "/internal/leads/batch",
      { job_id: jobId, leads }
    );
    return data;
  }

  /** POST /internal/jobs/{id}/status — report job completion/failure. */
  async updateJobStatus(
    jobId: string,
    status: string,
    leadsFound: number,
    error?: string
  ): Promise<void> {
    await this.http.post(`/internal/jobs/${encodeURIComponent(jobId)}/status`, {
      status,
      leads_found: leadsFound,
      ...(error ? { error } : {}),
    });
  }
}
