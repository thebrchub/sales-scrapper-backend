# Sales Scrapper Backend — Plan

## Architecture: Dual Backend (Node.js + Go)

Two independent services, each doing what it's best at:

| Service | Language | Role |
|---|---|---|
| **Scraping Engine** | Node.js + TypeScript | Crawling, scraping, web crawling, data extraction, phone validation |
| **API Server** | Go (`go-starter-kit` v0.2.x) | REST API, lead scoring, dedup, auth, export, queue management |

### Why Split?
- **Node.js** has the best scraping ecosystem (Puppeteer, Cheerio, Playwright)
- **Go** handles 10M+ RPS with go-starter-kit's lock-free hot paths, connection pooling, circuit breakers
- Each scales independently — scraper crash doesn't take down API
- go-starter-kit already has: Postgres ORM, Redis queues, JWT auth, rate limiting, circuit breaker, cron — zero code to write for infra
- **Loose coupling** — Go is completely source-agnostic. Adding a new scraper source in Node.js requires ZERO changes in Go.

---

## Tech Stack

### Scraping Engine (Node.js)
- **Runtime:** Node.js + TypeScript
- **Scraping:** Puppeteer, Cheerio, Axios
- **Phone Validation:** libphonenumber-js
- **Tech Detection:** Wappalyzer (open-source)
- **Queue Consumer:** Redis (ioredis) — pulls jobs from queue, publishes progress
- **DB Access:** NONE — Node.js never touches Postgres directly. All data goes through Go API.

### API Server (Go)
- **Framework:** `go-starter-kit` (github.com/shivanand-burli/go-starter-kit)
- **Database:** `postgress` package — pgxpool, 200 conns, batch insert, generics, migrations
- **Cache + Queue:** `redis` package — Lua-scripted dedup queue, pub/sub, singleflight fetch, distributed locks
- **Auth:** `jwt` package — RS256 access + HMAC refresh tokens
- **Middleware:** `middleware` package — rate limiter (256-shard), circuit breaker, CORS, JWT auth, RBAC, compression, request ID, logger
- **Background Jobs:** `cron` package — bounded worker pool, panic recovery
- **HTTP Utils:** `helper` package — retry with backoff, graceful shutdown, worker pool, JSON responses, pagination
- **Host:** Must bind to `0.0.0.0:8080` (not `localhost` or `127.0.0.1`) — required for Docker/Railway/Render to route traffic into the container

### Shared Infrastructure
- **Database:** PostgreSQL (Neon free tier)
- **Queue + Cache:** Redis (Upstash free tier)
- **Deployment:** Railway/Render (both services) — $0/month

---

## Inter-Service Communication (Node.js ↔ Go)

The two backends talk via **Redis** (shared queue + pub/sub) and **HTTP** (Node POSTs leads to Go). Node.js has **ZERO database access** — only Go talks to Postgres.

### Flow Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                      USER / DASHBOARD                          │
│                      (Browser / API Client)                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP (REST)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GO API SERVER                                │
│                    (go-starter-kit)                              │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │
│  │ REST API │  │ Auth/JWT │  │ Rate     │  │ Lead Scorer   │   │
│  │ Handlers │  │ Middleware│  │ Limiter  │  │ + Dedup Engine│   │
│  └────┬─────┘  └──────────┘  └──────────┘  └───────┬───────┘   │
│       │                                            │            │
│       ▼                                            ▼            │
│  ┌──────────┐                              ┌──────────────┐    │
│  │ Campaign │──── queue.Enqueue() ─────────▶│ Redis Queue  │    │
│  │ Creator  │                              │ "scrape_jobs"│    │
│  └──────────┘                              └──────┬───────┘    │
│       │                                           │             │
│       │  postgress.Insert()                       │             │
│       ▼                                           │             │
│  ┌──────────┐                                     │             │
│  │ Postgres │◀── postgress.InsertBatch() ─────┐   │             │
│  │ (Neon)   │                                 │   │             │
│  └──────────┘                                 │   │             │
│       ▲                                       │   │             │
│       │  redis.Publish("lead_updates")        │   │             │
│       │  (real-time progress to dashboard)     │   │             │
└───────┼───────────────────────────────────────┼───┼─────────────┘
        │                                       │   │
        │                                       │   │ redis.BlockingDequeue()
        │                                       │   │
┌───────┼───────────────────────────────────────┼───┼─────────────┐
│       │     NODE.JS SCRAPING ENGINE           │   │             │
│       │                                       │   ▼             │
│       │                                  ┌────────────┐        │
│       │                                  │ Job Runner │        │
│       │                                  │ (pulls from│        │
│       │                                  │  Redis)    │        │
│       │                                  └─────┬──────┘        │
│       │                                        │               │
│       │              ┌─────────────────────────┼────────┐      │
│       │              ▼                         ▼        ▼      │
│       │         ┌─────────┐  ┌──────────┐  ┌─────────┐        │
│       │         │ Google  │  │  Yelp    │  │ Yellow  │        │
│       │         │ Maps    │  │ Scraper  │  │ Pages   │  ...   │
│       │         │ Scraper │  │          │  │ Scraper │        │
│       │         └────┬────┘  └────┬─────┘  └────┬────┘        │
│       │              │            │              │             │
│       │              └────────────┼──────────────┘             │
│       │                           │                            │
│       │                           ▼                            │
│       │                    ┌──────────────┐                    │
│       │                    │ Contact      │                    │
│       │                    │ Extractor    │                    │
│       │                    │ + Phone      │                    │
│       │                    │ Validator    │                    │
│       │                    │ + Wappalyzer │                    │
│       │                    └──────┬───────┘                    │
│       │                           │                            │
│       │                           ▼                            │
│       │               ┌───────────────────────┐                │
│       │               │ POST to Go API        │                │
│       └───────────────│ /internal/leads/batch  │                │
│                       │ (batch of raw leads)   │                │
│                       └───────────────────────┘                │
│                                                                 │
│  ⛔ Node.js has ZERO direct DB access                           │
│  ✅ Node.js only uses: Redis (queue + pub/sub) + HTTP (Go API)  │
└─────────────────────────────────────────────────────────────────┘
```

### Communication Channels

| Channel | Direction | Method | What |
|---|---|---|---|
| **Job Queue** | Go → Node | `redis.Enqueue()` / ioredis `BLPOP` | Go pushes scrape jobs, Node pulls them |
| **Lead Submission** | Node → Go | HTTP POST `/internal/leads/batch` | Node sends scraped leads to Go for scoring/dedup/storage |
| **Progress Updates** | Node → Redis | ioredis `PUBLISH("scrape_progress")` | Node publishes job progress, Go subscribes and relays |
| **Job Status** | Node → Go | HTTP POST `/internal/jobs/{id}/status` | Node reports job completion to Go API |

### Strict Rule: Node.js = No Database
- Node.js reads from Redis (job queue) and writes to Redis (progress/status)
- Node.js sends scraped data to Go API over HTTP
- **Only Go talks to PostgreSQL** — all insert, query, update, dedup happens in Go
- This keeps Node.js stateless and disposable — crash/restart loses nothing

### Loose Coupling: Go is Source-Agnostic

**Go knows nothing about scraper sources.** It doesn't know Google Maps exists, doesn't know Yelp exists, doesn't care. It only knows:

1. **A job has a `source` field** (opaque string — could be `"google_maps"`, `"yelp"`, or `"alien_database"` — Go doesn't interpret it)
2. **A lead has a `source[]` array** (just strings Go stores, never acts on)
3. **The internal API contract is fixed** — Node always POSTs the same `RawLead` shape regardless of source

**Adding a new scraper source (e.g., Facebook Marketplace, Craigslist, Apollo):**

```
Node.js changes (scraper/):
  1. Create scraper/src/scrapers/facebook.ts     ← new scraper file
  2. Register in scraper/src/worker/runner.ts     ← add to dispatch map
     scraperMap["facebook"] = facebookScraper
  3. Done. Deploy scraper only.

Go changes (api/):
  NONE. Zero. Nothing.
  └── Go receives the same POST /internal/leads/batch
  └── Lead has source: ["facebook"] — Go stores it as-is
  └── Job has source: "facebook" — Go stores it as-is
  └── Scoring, dedup, validation — all source-independent
```

**Why this works:**
- The `POST /internal/leads/batch` contract is **source-independent** — same fields for every source
- The `source` field in jobs/leads is a plain string, not an enum — no Go-side validation against a list
- Scoring uses signals (has_website, has_ssl, tech_stack) not source identity
- The Redis job queue payload is generic: `{ source, city, category, config }` — Node interprets `source`, Go just stores it
- Node's `runner.ts` has a simple dispatch map — one line to add a new source

### Why Redis Queue (Not Direct HTTP Polling)?
- **Decoupled** — Go and Node don't need to know each other's URL/port
- **Persistent** — jobs survive if Node restarts (Redis persists queue)
- **Backpressure** — Node only pulls when it has capacity (BlockingDequeue)
- **Dedup built-in** — `redis.Enqueue(ctx, key, value, false)` uses Lua-scripted dedup to prevent duplicate jobs
- **go-starter-kit already has it** — `redis.Enqueue`, `redis.BlockingDequeue`, `redis.Publish` all ready to use

### Internal API (Go exposes for Node only)

**Auth: JWT Bearer Token (service role)**

Node.js must first authenticate via `POST /auth/login` with service credentials (`SERVICE_USER` / `SERVICE_PASS` from env). This returns a JWT access token + refresh token. All internal API calls use `Authorization: Bearer <access_token>`. When the access token expires, Node.js calls `POST /auth/refresh` with the refresh token to get a new pair.

```
# Step 1 — Node.js authenticates on startup
POST /auth/login
  Body: { "username": "$SERVICE_USER", "password": "$SERVICE_PASS" }
  Response: { "access_token": "eyJ...", "refresh_token": "eyJ..." }

# Step 2 — Node.js uses access token for all internal calls
POST /internal/leads/batch
  Auth: Authorization: Bearer <access_token>
  Body: { "job_id": "uuid", "leads": [{...}, {...}] }
  
  ⚠️ FIXED CONTRACT — source-independent. Never changes when adding scrapers.
  
  Lead shape (same for ALL sources):
  {
    "business_name": "string",
    "phone": "string | null",
    "email": "string | null",
    "website_url": "string | null",
    "address": "string | null",
    "city": "string",
    "country": "string",
    "category": "string",
    "source": "string",           // opaque — Go stores as-is
    "tech_stack": {} | null,
    "has_ssl": "boolean | null",
    "is_mobile_friendly": "boolean | null"
  }
  
  Go does:
    1. Validate phone (double-check with Go-side validation)
    2. Dedup against DB (postgress.Query + unique constraint)
    3. Score each lead
    4. postgress.InsertBatch() — single round-trip
    5. Update job stats
    6. redis.Publish("lead_updates", {job_id, new_count})
  
  Response: { "inserted": 47, "merged": 12, "skipped": 3 }

POST /internal/jobs/{id}/status
  Auth: Authorization: Bearer <access_token>
  Body: { "status": "completed", "leads_found": 62 }

# Step 3 — Refresh when access token expires
POST /auth/refresh
  Auth: Authorization: Bearer <refresh_token>
  Response: { "access_token": "eyJ...(new)", "refresh_token": "eyJ...(new)" }
```

**Auth roles:**
| Role | Credentials | Access |
|---|---|---|
| `service` | `SERVICE_USER` / `SERVICE_PASS` | `/internal/*` endpoints only |
| `admin` | `ADMIN_USER` / `ADMIN_PASS` | All endpoints (`/leads/*`, `/campaigns/*`, `/internal/*`) |

---

## User Flow (How It Works End-to-End)

### Step 1 — User Creates a Scrape Campaign
```
User opens Dashboard / hits Go API:
  → Authenticates (jwt package — RS256 access token)
  → Picks sources: [Google Maps, Yelp, Yellow Pages]
  → Picks cities: ["New York", "Chicago", "Miami"]
  → Picks categories: ["Restaurants", "Plumbers", "Dentists"]
  → Clicks "Start Scraping"
```

### Step 2 — Go API Creates Jobs
```
Go API receives POST /campaigns
  │
  ▼
middleware.Auth("user") → verifies JWT
middleware.IPRateLimiter → 1000 req/s per IP
  │
  ▼
Creates campaign record: postgress.Insert(ctx, "campaigns", campaign)
  │
  ▼
Generates scrape_job combos (source × city × category)
  │  e.g., 3 × 3 × 3 = 27 jobs
  ▼
postgress.InsertBatch(ctx, "scrape_jobs", jobs)  → single DB round-trip
  │
  ▼
redis.EnqueueBatch(ctx, "scrape_queue", jobPayloads, false)  → Lua dedup
  │
  ▼
Return: { campaign_id, jobs_created: 27 }
```

### Step 3 — Node.js Workers Pull & Scrape
```
Node.js worker loop:
  │
  ▼
redis.BlockingDequeue("scrape_queue", 30s)  → waits for job
  │
  ▼
Parse job: { source: "google_maps", city: "NYC", category: "restaurant" }
  │
  ▼
Run source scraper (Puppeteer/Cheerio)
  │
  ▼
Contact Extractor → visit websites, regex emails/phones
  │
  ▼
Phone Validator → libphonenumber format + type check
  │
  ▼
Tech Analyzer → Wappalyzer scan for tech stack
  │
  ▼
Batch POST → Go API: POST /internal/leads/batch
  │  { job_id, leads: [{name, phone, email, website, tech_stack, ...}] }
  ▼
Go API receives batch → dedup + score + InsertBatch → respond
  │
  ▼
Node updates job status → POST /internal/jobs/{id}/status
```

### Step 4 — Go Scores & Stores (on receiving batch)
```
Go API /internal/leads/batch handler:
  │
  ▼
For each lead in batch:
  ├── Normalize phone to E.164, set phone_valid + phone_type
  ├── Validate email: format → MX lookup → SMTP ping
  │   └── Set email_valid, email_catchall, email_disposable, email_confidence
  ├── Check postgress unique constraint (phone/email/domain)
  ├── If duplicate → merge sources, recalculate score
  ├── If new → score lead (0-100), store ALL leads (no discard)
  └── Collect for batch insert
  │
  ▼
postgress.InsertBatch(ctx, "leads", allLeads)  ← every lead stored
  │
  ▼
redis.Publish(ctx, "lead_updates", {campaign_id, new_leads: 47})
  │
  ▼
Return { inserted: 47, merged: 12, duplicates_skipped: 3 }
```

### Step 5 — User Checks Progress
```
Dashboard polls Go API:
  GET /campaigns/{id}/status  (or WebSocket via redis.Subscribe)
  
  → Job status: 18/27 completed, 6 running, 3 pending
  → Leads found so far: 1,247
  → After dedup: 892
  → After validation: 734
  → Scored breakdown: 200 hot (>70), 400 warm (40-70), 134 cold (<40)
```

### Step 6 — User Reviews & Exports Leads
```
User opens Leads page → Go API:
  GET /leads?score_gte=60&city=New+York&has_phone=true&sort=-lead_score&page=1
  
  Go does:
    redis.Fetch() → check cache first (singleflight dedup)
    cache miss → postgress.GetSortedPage() → paginated, sorted
    helper.Paginated(w, leads, page, pageSize, total)
  
  → Sees: business name, phone, email, website, score, tech stack
  → Actions: PATCH /leads/{id} → { status: "contacted" }
  → Export: GET /leads/export?format=csv&score_gte=60
```

### Step 7 — Automated Re-Scraping
```
Go cron.Scheduler runs daily:
  cron.Register("rescrape", 24*time.Hour, func(ctx) {
    → Load saved campaigns with auto_rescrape=true
    → redis.EnqueueBatch() → push jobs to queue
    → Node picks up, scrapes, sends back
    → Dedup skips existing leads automatically
  })
```

---

## Sources (All Free)

### Source 1: Google Maps
- **Query examples:** "restaurant New York", "plumber Chicago"
- **Extracts:** business name, phone, address, website, rating, category
- **Method:** Puppeteer → search → scroll → extract sidebar
- **Priority:** HIGH

### Source 2: Google Search (Dorks)
- **Query examples:** "built with WordPress" + "contact us", "need a website" site:reddit.com
- **Extracts:** URLs → visit each → pull emails/phones
- **Method:** Axios + Cheerio on SERP HTML
- **Priority:** MEDIUM

### Source 3: Yelp
- **Query examples:** /search?find_desc=restaurants&find_loc=Miami
- **Extracts:** business name, phone, website, address
- **Method:** Axios + Cheerio, paginate results
- **Priority:** HIGH

### Source 4: Yellow Pages
- **Query examples:** /search?search_terms=plumber&geo_location_terms=Dallas
- **Extracts:** business name, phone, website, address
- **Method:** Axios + Cheerio
- **Priority:** MEDIUM

### Source 5: Job Boards (Indeed / LinkedIn Jobs)
- **Query examples:** "hiring web developer", "need React developer"
- **Extracts:** company name, location → Google company for contacts
- **Method:** Puppeteer (JS-rendered pages)
- **Priority:** LOW

### Source 6: New Domains (WHOIS)
- **Source:** whoisds.com daily CSV downloads
- **Extracts:** domain, registration date, registrant email
- **Method:** Download CSV → filter business-looking domains → visit site
- **Priority:** MEDIUM

### Source 7: Reddit
- **Query examples:** "need a website", "looking for developer"
- **Extracts:** post URL, username, any contact info in post
- **Method:** Reddit JSON API (old.reddit.com/search.json)
- **Priority:** LOW

---

## Lead Scoring (0-100)

**All leads are stored regardless of score.** No leads are discarded. Score is informational — lets the user filter and prioritize.

| Signal                              | Points |
|-------------------------------------|--------|
| No website at all                   | +30    |
| Website uses outdated tech          | +20    |
| No SSL certificate                  | +10    |
| Hiring developers (job board)       | +20    |
| Newly registered domain             | +20    |
| Found on 2+ sources                 | +10    |
| Has mobile number                   | +5     |
| No mobile app but has web product   | +10    |

**No threshold. Every lead is kept.** User filters by score in the dashboard/API.

---

## Phone Verification

1. **Format validation** — libphonenumber-js (valid E.164, correct country)
2. **Type detection** — mobile / landline / VoIP / toll-free
3. **Cross-source check** — same number on 2+ sources = high confidence
4. **Stored fields:**
   - `phone_valid` — BOOLEAN (true if libphonenumber says format is valid)
   - `phone_type` — TEXT ("mobile", "landline", "voip", "toll_free", "unknown")
   - `phone_confidence` — INT (0-100)
     - Format valid: +25
     - Found on 2+ sources: +30
     - Type is mobile/landline: +20
     - Matches business listing: +15
   - **All leads stored regardless.** `phone_valid` flag lets the user filter.

---

## Email Verification

Node.js extracts emails via regex. Go validates them in 3 layers (all free):

**Layer 1 — Format Validation (instant, in Go)**
- Regex check: valid email format (RFC 5322)
- Reject obvious junk: `test@test.com`, `admin@example.com`, `noreply@...`
- Check for common typos: `gmial.com` → flag as suspicious

**Layer 2 — DNS / MX Record Check (free, in Go)**
- `net.LookupMX(domain)` — does the domain actually have mail servers?
- No MX record → `email_valid = false` (domain can't receive email)
- Has MX record → `email_valid = true` (domain exists and accepts mail)
- Also checks if domain is a known disposable email provider (list of ~3K domains)

**Layer 3 — SMTP Handshake / Ping (free, optional, in Go)**
- Connect to the MX server via SMTP (port 25)
- Send `EHLO`, `MAIL FROM`, `RCPT TO` — but **never send actual email**
- If server responds `250 OK` → mailbox exists
- If `550 User not found` → `email_valid = false`
- **Catch:** Many servers return 250 for everything (catch-all). Mark as `email_catchall = true`
- Rate-limit: max 1 SMTP check/second per domain to avoid being blacklisted

**Stored fields:**
| Field | Type | Description |
|---|---|---|
| `email_valid` | BOOLEAN | true if format + MX check pass |
| `email_catchall` | BOOLEAN | true if domain is catch-all (can't confirm mailbox) |
| `email_disposable` | BOOLEAN | true if domain is known disposable provider |
| `email_confidence` | INT | 0-100 score |

**Email confidence scoring:**
- Valid format: +20
- MX record exists: +30
- SMTP mailbox confirmed: +30
- Not disposable: +10
- Not catch-all: +10

---

## Deduplication

- **Phone:** Normalize to E.164 → UNIQUE index
- **Email:** Lowercase + trim → UNIQUE index
- **Domain:** Strip www/http → UNIQUE index
- **Business name:** Normalize + fuzzy match (Levenshtein < 3) within same city
- **On insert:** Check all 4 fields → skip or merge
- **On export:** Final batch dedup pass

---

## Database Schema (Postgres)

```sql
-- leads table
id              UUID PRIMARY KEY
business_name   TEXT NOT NULL
category        TEXT
phone_e164      TEXT UNIQUE
phone_valid     BOOLEAN DEFAULT false
phone_type      TEXT               -- mobile, landline, voip, toll_free, unknown
phone_confidence INT DEFAULT 0
email           TEXT
email_valid     BOOLEAN DEFAULT false
email_catchall  BOOLEAN DEFAULT false
email_disposable BOOLEAN DEFAULT false
email_confidence INT DEFAULT 0
website_url     TEXT
address         TEXT
city            TEXT
country         TEXT
source          TEXT[]              -- ["google_maps", "yelp"]
lead_score      INT DEFAULT 0
tech_stack      JSONB               -- {"cms": "wordpress", "version": "4.9"}
has_ssl         BOOLEAN
is_mobile_friendly BOOLEAN
status          TEXT DEFAULT 'new'  -- new, contacted, converted, rejected
created_at      TIMESTAMPTZ DEFAULT NOW()
updated_at      TIMESTAMPTZ DEFAULT NOW()

-- scrape_jobs table
id              UUID PRIMARY KEY
source          TEXT NOT NULL
query           TEXT NOT NULL
status          TEXT DEFAULT 'pending'  -- pending, in_progress, completed, timeout, failed, dead
attempt_count   INT DEFAULT 0
max_attempts    INT DEFAULT 3
timeout_seconds INT DEFAULT 480         -- 8 min default
leads_found     INT DEFAULT 0
last_error      TEXT
started_at      TIMESTAMPTZ
completed_at    TIMESTAMPTZ
died_at         TIMESTAMPTZ              -- when moved to dead letter
campaign_id     UUID REFERENCES campaigns(id)
error           TEXT
```

---

## Logging Policy

**Log failures only.** After server startup, no success logs. Keep logs lean and useful.

| Event | Log? | Level |
|---|---|---|
| Server started, DB connected, Redis connected | YES (once at boot) | `INFO` |
| Successful API request (200/201) | **NO** | — |
| Successful lead batch insert | **NO** | — |
| Successful job completion | **NO** | — |
| Failed API request (4xx/5xx) | YES | `WARN` / `ERROR` |
| Lead validation failure | YES | `WARN` |
| Dedup conflict / merge | YES | `WARN` |
| DB connection error / timeout | YES | `ERROR` |
| Redis connection error | YES | `ERROR` |
| Scraper timeout / kill signal | YES | `WARN` |
| Job moved to dead letter | YES | `ERROR` |
| Watchdog detected stalled job | YES | `WARN` |
| Unhandled panic / crash | YES | `FATAL` |

**Rules:**
- **Go API:** `middleware.Logger` should be configured to skip 2xx responses. Only log 4xx/5xx.
- **Node.js Scraper:** Only log scraper errors, timeouts, and kill signals. No "scraping page 3 of 10" noise.
- **Structured JSON logs** — every log line has `timestamp`, `level`, `service`, `error`, `job_id` (if applicable). No free-text logs.
- **No request body logging** — leads contain PII (phone numbers, emails). Never log request/response bodies.

---

## Anti-Ban Strategy

- Random delays: 2-8 seconds between requests
- Rotate User-Agents: pool of 50+ browser UAs
- Respect robots.txt
- Retry with exponential backoff on 429/503
- Session cookies to mimic real browser
- Optional: free proxy rotation / Tor fallback

---

## Job Timeout, Retry & Dead Letter Queue

### The Problem
A scrape job gets stuck — Node.js crashes mid-scrape, source site hangs, Puppeteer freezes, network drops. The job stays `in_progress` in DB forever.

### Solution: Go Watchdog Cron + Redis Kill Signal + Dead Letter Queue

```
┌──────────────────────────────────────────────────────────────────┐
│          GO WATCHDOG CRON (every WATCHDOG_INTERVAL_SEC)          │
│                                                                  │
│  Env vars (all configurable):                                    │
│    WATCHDOG_INTERVAL_SEC=120        # how often cron runs        │
│    WATCHDOG_STALE_THRESHOLD_SEC=600 # job stale after 10 min     │
│    WATCHDOG_MAX_ATTEMPTS=3          # retries before dead letter  │
│                                                                  │
│  1. Query DB: SELECT * FROM scrape_jobs                          │
│     WHERE status = 'in_progress'                                 │
│     AND updated_at < NOW() - INTERVAL '$STALE_THRESHOLD sec'     │
│                                                                  │
│  2. For each stalled job:                                        │
│     ├── attempt_count < MAX_ATTEMPTS?                            │
│     │   ├── YES → Re-queue for retry                             │
│     │   │   ├── redis.Publish("kill:{job_id}", "abort")          │
│     │   │   │   (tells Node to stop current work)                │
│     │   │   ├── UPDATE scrape_jobs SET status='pending',          │
│     │   │   │   attempt_count = attempt_count + 1                │
│     │   │   └── redis.Enqueue("scrape_queue", job) → re-queue    │
│     │   │                                                        │
│     │   └── NO (all attempts exhausted) → Dead Letter            │
│     │       ├── UPDATE scrape_jobs SET status='dead'              │
│     │       └── Log: "Job {id} permanently failed"               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### How Node.js Knows to Stop

```
Node.js worker (for each active job):
  │
  ├── Subscribes to Redis channel "kill:{job_id}" on job start
  │
  ├── While scraping:
  │   ├── Every page/scroll/request → check kill signal
  │   ├── If kill signal received:
  │   │   ├── Abort Puppeteer browser.close()
  │   │   ├── Discard partial results (don't POST to Go API)
  │   │   ├── Unsubscribe from kill channel
  │   │   └── Move to next job in queue
  │   │
  │   └── Also: per-job timeout (8 minutes max)
  │       ├── setTimeout → if job exceeds 8 min
  │       ├── Self-abort: same cleanup as kill signal
  │       └── POST /internal/jobs/{id}/status → { status: "timeout" }
  │
  └── On success:
      ├── POST /internal/leads/batch → send results
      ├── POST /internal/jobs/{id}/status → { status: "completed" }
      └── Unsubscribe from kill channel
```

### Retry Strategy

| Attempt | Behavior | Wait Before Retry |
|---|---|---|
| 1st try | Normal scrape | Immediate |
| 2nd try (retry) | Switch User-Agent + proxy | 2 min (backoff) |
| 3rd try (retry) | Switch scraper strategy (e.g., Cheerio instead of Puppeteer) | 5 min (backoff) |
| 4th+ | **Dead letter** — stop trying | Never |

### DB Schema Addition

```sql
-- Add to scrape_jobs table:
attempt_count    INT DEFAULT 0       -- how many times this job was attempted
max_attempts     INT DEFAULT 3       -- configurable per job
timeout_seconds  INT DEFAULT 480     -- 8 min default, configurable
last_error       TEXT                -- error message from last failure
died_at          TIMESTAMPTZ         -- when it was moved to dead letter
```

### Dead Letter Queue (What Happens to Failed Jobs)

1. **Status set to `dead`** — visible in dashboard with error reason
2. **Logged** — structured log with job details (source, city, category, error, attempt count)
3. **Manual retry** — admin can hit `POST /jobs/{id}/retry` to reset attempt count and re-queue
4. **Dashboard shows:** "3 dead jobs — Google Maps NYC timed out 3x — [Retry] [Dismiss]"
5. **Preserved data** — if any partial leads were extracted before timeout, they're already POSTed and stored (Node POSTs in batches as it goes, not only at the end)

### Partial Results (Don't Lose Work)

Node.js sends leads to Go API in **streaming batches**, not one big batch at the end:

```
Scraping Google Maps "restaurant NYC":
  │
  ├── Scroll 1 → extract 20 results → POST /internal/leads/batch (20 leads)
  ├── Scroll 2 → extract 20 results → POST /internal/leads/batch (20 leads)
  ├── Scroll 3 → extract 20 results → POST /internal/leads/batch (20 leads)
  ├── ❌ Timeout / kill at scroll 4
  │
  └── Result: 60 leads already saved in DB, only scroll 4+ lost
      Job marked as "timeout" with leads_found=60
      On retry: dedup ensures those 60 aren't re-inserted
```

### Configurable Timeouts per Source

| Source | Default Timeout | Why |
|---|---|---|
| Google Maps | 8 min | Scrolling is slow, lots of JS |
| Yelp | 3 min | Static HTML, fast |
| Yellow Pages | 3 min | Static HTML, fast |
| Google Dorks | 5 min | Multiple page visits |
| New Domains | 2 min | CSV download + parse |
| Reddit | 2 min | JSON API, fast |
| Crawler | 10 min | Multi-page BFS, many requests |
| Crawler | 10 min | Multi-page BFS, many requests |

---

## Build Phases

### Project Structure

**Monorepo — two services in one repo:**
```
sales-scrapper-backend/
├── PLAN.md
├── .env.example
├── .env                                # Shared env vars (watchdog config, etc.)
├── railway.json                     # Railway monorepo config (watch paths per service)
│
├── api/                             # GO API SERVER
│   ├── go.mod
│   ├── go.sum
│   ├── main.go                      # Entry point: init subsystems, start server
│   ├── Dockerfile
│   ├── .env
│   │
│   ├── config/
│   │   └── config.go                # Centralised env-based configuration (typed struct)
│   │
│   ├── database/
│   │   └── migrations/              # Ordered SQL migration files
│   │       ├── 001_create_leads.sql
│   │       ├── 002_create_scrape_jobs.sql
│   │       └── 003_create_campaigns.sql
│   │
│   ├── models/                      # Go structs with `db` + `json` tags (no methods, no logic)
│   │   ├── lead.go
│   │   ├── campaign.go
│   │   └── scrape_job.go
│   │
│   ├── repository/                  # Direct DB access — calls postgress.Insert(), Get(), Query() etc.
│   │   ├── lead_repo.go             # Lead CRUD (insert, get, batch insert, dedup check)
│   │   ├── campaign_repo.go         # Campaign CRUD
│   │   └── job_repo.go              # Scrape job queries (stalled jobs, status updates)
│   │
│   ├── service/                     # Business logic + orchestration (no HTTP, no DB direct)
│   │   ├── lead_service.go          # Scoring, dedup, validation orchestration
│   │   ├── campaign_service.go      # Campaign creation, job generation, queue dispatch
│   │   ├── scoring.go               # Lead scoring engine (0-100)
│   │   ├── dedup.go                 # Dedup engine (phone/email/domain/name)
│   │   ├── phone_validator.go       # Phone format + type validation
│   │   └── email_validator.go       # Email format + MX + SMTP ping
│   │
│   ├── handler/                     # HTTP handlers — parse request, call service, write response
│   │   ├── lead_handler.go          # GET /leads, GET /leads/:id, PATCH /leads/:id
│   │   ├── campaign_handler.go      # POST /campaigns, GET /campaigns/:id/status
│   │   ├── export_handler.go        # GET /leads/export?format=csv
│   │   └── internal_handler.go      # POST /internal/leads/batch, POST /internal/jobs/:id/status
│   │
│   ├── router/
│   │   └── router.go                # All route definitions + middleware wiring
│   │
│   ├── cron/                        # Background/scheduled jobs (calls service, no business logic here)
│   │   ├── rescrape.go              # Cron job: re-run saved campaigns
│   │   └── watchdog.go              # Cron job: detect stalled jobs, retry or dead-letter
│   │
│   └── data/                        # Static data files
│       ├── disposable_domains.go    # List of ~3K disposable email domains
│       └── user_agents.go           # Pool of 50+ browser UAs (shared with Node if needed)
│
├── scraper/                         # NODE.JS SCRAPING ENGINE
│   ├── package.json
│   ├── tsconfig.json
│   ├── .eslintrc.js
│   ├── .env
│   │
│   ├── src/
│   │   ├── index.ts                 # Entry point: connect Redis, start worker loop
│   │   │
│   │   ├── worker/                   # Job consumer
│   │   │   ├── runner.ts            # BLPOP loop → dispatch map → correct scraper → POST to Go API
│   │   │   │                        # Adding a source = 1 line: scraperMap["new_source"] = newScraper
│   │   │   └── kill-listener.ts     # Subscribe to kill:{job_id} channel, abort on signal
│   │   │
│   │   ├── scrapers/                # One file per source (add new sources here — zero Go changes)
│   │   │   ├── base.ts              # BaseScraper interface — all scrapers implement this
│   │   │   ├── google-maps.ts       # Puppeteer scraper
│   │   │   ├── yelp.ts              # Cheerio scraperalo
│   │   │   ├── yellow-pages.ts      # Cheerio scraper
│   │   │   ├── google-dorks.ts      # Axios + Cheerio
│   │   │   ├── new-domains.ts       # WHOIS CSV download + parse
│   │   │   └── reddit.ts            # Reddit JSON API
│   │   │
│   │   ├── crawler/                 # Generic web crawler (follows links, extracts contacts)
│   │   │   ├── crawler.ts           # BFS link follower + contact extractor
│   │   │   ├── frontier.ts          # URL queue with depth tracking + visited set
│   │   │   └── link-filter.ts       # Filter: skip images/PDFs/external, prioritize /contact /about
│   │   │
│   │   ├── extractors/              # Data extraction utilities
│   │   │   ├── contact.ts           # Email/phone regex extraction from HTML
│   │   │   ├── phone.ts             # libphonenumber-js validation
│   │   │   └── tech-stack.ts        # Wappalyzer integration
│   │   │
│   │   ├── api/                     # HTTP client to Go API
│   │   │   └── go-client.ts         # POST /internal/leads/batch, POST /internal/jobs/:id/status
│   │   │
│   │   ├── anti-ban/                # Anti-detection
│   │   │   ├── user-agents.ts       # UA rotation pool
│   │   │   ├── delays.ts            # Random delay helpers (2-8s)
│   │   │   └── proxy.ts             # Optional proxy rotation
│   │   │
│   │   └── types/                   # TypeScript types
│   │       ├── lead.ts              # RawLead interface (what Node extracts)
│   │       └── job.ts               # ScrapeJob interface (what Redis queue contains)
│   │
│   └── dist/                        # Compiled JS (gitignored)
│
└── dashboard/                       # REACT FRONTEND (Phase 7, separate app)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts               # Vite build tool
    ├── .env                         # API base URL
    ├── public/
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/
        │   └── client.ts            # Axios client to Go API (auth, interceptors)
        ├── pages/
        │   ├── CampaignsPage.tsx     # Campaign list + create
        │   ├── CampaignDetailPage.tsx # Live progress + job status
        │   ├── LeadsPage.tsx         # Leads table with filters
        │   ├── LeadDetailPage.tsx    # Single lead full view
        │   ├── DeadLetterPage.tsx    # Failed jobs — retry / dismiss
        │   ├── ExportPage.tsx        # Export with filters
        │   ├── AnalyticsPage.tsx     # Charts + stats
        │   └── SettingsPage.tsx      # Watchdog config, timeouts
        ├── components/              # Reusable UI components
        ├── hooks/                   # useLeads, useCampaigns, useWebSocket
        └── types/                   # TypeScript interfaces
```

**Key design rules:**
- `api/` is a standalone Go binary — `cd api && go run main.go`
- `scraper/` is a standalone Node process — `cd scraper && npm start`
- They share NOTHING except Redis + Postgres connection strings in `.env`
- No shared code, no shared types, no import across services
- Each has its own Dockerfile for independent deployment
- Railway watch paths ensure changing one service does NOT redeploy the other
- **Adding a new scraper source = 1 new file in `scraper/` + 1 line in dispatch map. ZERO Go changes.**

### Go API Dockerfile (`api/Dockerfile`)

Multi-stage build. Handles go-starter-kit private module via build arg token. Produces a minimal distroless image.

```dockerfile
# ================================
# Build stage
# ================================
FROM golang:1.26.1-alpine3.23 AS builder

WORKDIR /app

# 1. Install git (Required for fetching private modules)
RUN apk add --no-cache git

# 2. Receive the token from build args
ARG GO_KIT_GITHUB_TOKEN

# 3. Configure Git to use the token
RUN git config --global url."https://${GO_KIT_GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"

# 4. Set GOPRIVATE to skip the public proxy for your repos
ENV GOPRIVATE=github.com/shivanand-burli/*

# 5. Download dependencies (Cached layer)
COPY ./go.mod ./go.sum ./
RUN go mod download

# 6. Copy source and build
COPY ./ .
RUN CGO_ENABLED=0 \
    GOOS=linux \
    GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o app

# ================================
# Runtime stage
# ================================
FROM gcr.io/distroless/static-debian12

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/app /app/app

EXPOSE 8080

CMD ["/app/app"]
```

**Key points:**
- `GO_KIT_GITHUB_TOKEN` — pass as build arg on Railway/Render (never in code/env file)
- `GOPRIVATE` — tells Go to skip public proxy for go-starter-kit
- `distroless` runtime — no shell, no package manager, minimal attack surface
- `-trimpath -ldflags="-s -w"` — strip debug info, smaller binary
- Dependencies cached via `go mod download` before copying source

### Go Backend Rule: go-starter-kit First, Clean Layers

**`api/` contains ONLY business logic. ZERO infrastructure code.**

go-starter-kit already provides all infra (DB, Redis, auth, middleware, cron, helpers). The `api/` folder uses clean layered architecture: **handler → service → repository**. Kit functions are called directly in the appropriate layer — no wrappers, no abstractions around kit packages.

**Layer Responsibilities:**

| Layer | Does | Does NOT |
|---|---|---|
| **handler** | Parse HTTP request, validate input, call service, write response | Touch the database directly |
| **service** | Business logic, orchestration across repos, validation rules | Know about `http.Request/Response` |
| **repository** | DB reads/writes — calls `postgress.Insert()`, `Get()`, `Query()` directly | Contain business rules |
| **models** | Define data structures (`db` + `json` tags) | Contain methods or logic |
| **router** | Register routes, compose middleware chains | Contain handler logic |
| **config** | Read env vars, expose typed config struct | Contain defaults that belong in `.env` |
| **cron** | Periodic background tasks (watchdog, rescrape) | Contain business logic (calls service) |

**Data Flow:**
```
HTTP Request
  → router (middleware: rate-limit, CORS, auth)
    → handler (parse + validate)
      → service (business logic + orchestration)
        → repository (DB query via postgress.*)
        → redis.* (queue/cache ops)
      ← service returns result/error
    ← handler writes JSON response (helper.JSON / helper.Error)
  ← router
HTTP Response
```

**Rules:**
1. **Read the package README first.** Every go-starter-kit package (`postgress/`, `redis/`, `jwt/`, `middleware/`, `cron/`, `helper/`, etc.) has its own README.md with function signatures, usage examples, and init patterns. Read it before using the package. Don't guess function signatures or init flows — the README is the source of truth.
2. **Call go-starter-kit functions directly in the right layer.** `postgress.*` calls go in `repository/`. `helper.JSON/Error` calls go in `handler/`. `redis.Enqueue/Publish` go in `service/` or `repository/`. Don't wrap them.
3. **No wrappers around kit packages.** Don't create `utils/db.go` that wraps `postgress.Insert()`. Don't create `utils/cache.go` that wraps `redis.Fetch()`. Import and call directly in the correct layer.
4. **Before writing any infra code, check if go-starter-kit already has it.** If it does — use it. If it doesn't — ask the user before writing it. The kit is battle-tested; custom infra code is not.
5. **Only business logic belongs in `service/`.** Scoring, dedup, email validation, phone validation — these are business-specific. DB calls, Redis ops, JWT, rate limiting, cron scheduling — these come from the kit.
6. **Respect the dependency direction.** `handler → service → repository`. Never backwards. Handler never calls repository directly. Repository never calls service.
7. **If the kit is missing something, ask first.** Don't silently implement a Redis wrapper or a custom connection pool. Ask: "go-starter-kit doesn't have X — should I add it to the kit or build it here?"

**What this looks like in practice:**
```go
// ✅ CORRECT — handler → service → repository, kit called in the right layer

// handler/lead_handler.go — parse request, call service, respond
func HandleCreateLead(w http.ResponseWriter, r *http.Request) {
    var lead models.Lead
    helper.ReadJSON(r, &lead)                     // kit call in handler ✅
    result, err := leadService.Create(r.Context(), lead)
    if err != nil {
        helper.Error(w, 500, err.Error())         // kit call in handler ✅
        return
    }
    helper.JSON(w, http.StatusCreated, result)    // kit call in handler ✅
}

// service/lead_service.go — business logic, orchestration
func (s *LeadService) Create(ctx context.Context, lead models.Lead) (models.Lead, error) {
    lead.LeadScore = scoring.Calculate(lead)       // business logic ✅
    if s.dedup.IsDuplicate(ctx, lead) {
        return lead, ErrDuplicate
    }
    return s.repo.Insert(ctx, lead)
}

// repository/lead_repo.go — DB access, kit calls
func (r *LeadRepo) Insert(ctx context.Context, lead models.Lead) (models.Lead, error) {
    return postgress.Insert(ctx, "leads", lead)   // kit call in repo ✅
}
```

```go
// ❌ WRONG — handler calling DB directly (skipping service + repo layers)
func HandleCreateLead(w http.ResponseWriter, r *http.Request) {
    var lead models.Lead
    helper.ReadJSON(r, &lead)
    postgress.Insert(ctx, "leads", lead)  // DB call in handler — wrong layer
    helper.JSON(w, http.StatusCreated, lead)
}
```

**Naming convention:** One file per domain entity in each layer: `lead_repo.go`, `lead_service.go`, `lead_handler.go`, `campaign_repo.go`, etc.

### Performance Constraint: Built for 10M+ RPS — Cache First, DB Second

**This API is designed to handle 10M+ RPS. Every read endpoint MUST go through Redis cache before hitting Postgres.**

The DB is the bottleneck. Redis handles ~100K ops/s per instance. Postgres handles ~10K QPS. If every API call hits the DB directly, you cap out at 10K RPS — that's 1000x short of the target. The rule is simple: **cache everything that gets read more than once.**

**Cache-first pattern (use `redis.Fetch` — singleflight built-in):**
```go
// ✅ CORRECT — cache first, DB on miss only
func (r *LeadRepo) GetByID(ctx context.Context, id string) (models.Lead, error) {
    var lead models.Lead
    err := redis.Fetch(ctx, "lead:"+id, 5*time.Minute, &lead, func() (any, error) {
        return postgress.Get[models.Lead](ctx, "leads", id)  // only on cache miss
    })
    return lead, err
}

// ✅ CORRECT — cached list query
func (r *LeadRepo) GetByCity(ctx context.Context, city string, page, size int) ([]models.Lead, error) {
    key := fmt.Sprintf("leads:city:%s:p%d", city, page)
    var leads []models.Lead
    err := redis.Fetch(ctx, key, 60*time.Second, &leads, func() (any, error) {
        return postgress.GetSortedPage[models.Lead](ctx, "leads", "lead_score DESC", page, size,
            "city = $1", city)
    })
    return leads, err
}

// ❌ WRONG — hitting DB on every request
func (r *LeadRepo) GetByID(ctx context.Context, id string) (models.Lead, error) {
    return postgress.Get[models.Lead](ctx, "leads", id)  // DB hit every time — kills throughput
}
```

**What MUST be cached:**

| Endpoint | Cache Key Pattern | TTL | Why |
|---|---|---|---|
| `GET /leads/:id` | `lead:{id}` | 5 min | Individual lead lookups are frequent |
| `GET /leads?filters` | `leads:{filter_hash}:p{page}` | 60s | List queries are the heaviest DB load |
| `GET /campaigns/:id/status` | `campaign_status:{id}` | 30s | Dashboard polls this repeatedly |
| `GET /leads/export` | No cache | — | One-off export, hits DB directly |
| `POST /internal/leads/batch` | No cache (write path) | — | Writes go direct to DB, then invalidate related caches |

**Cache invalidation rules:**
- On lead insert/update → `redis.Del("lead:{id}")` + `redis.Del("leads:city:{city}:*")` (pattern invalidate)
- On job status change → `redis.Del("campaign_status:{campaign_id}")`
- On batch insert → invalidate city-level list caches for affected cities
- Use `redis.Publish("cache_invalidate", keys)` if running multiple API instances

**Result:** 95%+ of read requests served from Redis (~50μs). DB only sees cache misses + writes (~5% of traffic). This is how you get from 10K to 10M+ RPS without changing a single query.

### Phase 1 — Go API Core ✅ COMPLETE
- [x] Go project setup (go mod, import go-starter-kit)
- [x] DB migrations (postgress.MigrateFS — leads, scrape_jobs, campaigns tables)
- [x] Lead CRUD handlers (postgress.Insert, Get, GetSortedPage, Update)
- [x] Internal batch lead endpoint (POST /internal/leads/batch)
- [x] Dedup engine (phone E.164 + email + domain unique checks)
- [x] Lead scoring engine (calculate score on insert, store ALL leads)
- [x] Phone validation in Go (format + type detection)
- [x] Email validation in Go (format + MX + SMTP ping)
- [x] Auth setup (JWT login + refresh, middleware.Auth, RBAC with service/admin roles)
- [x] Rate limiting (middleware.NewIPRateLimiter — 100 RPS / 200 burst per IP)
- [x] Watchdog cron job (detect stalled jobs, retry or dead-letter)
- [x] Kill signal via redis.Publish("kill:{job_id}")
- [x] Cache-first on ALL read endpoints (redis.Fetch with singleflight)
- [x] Streaming CSV export (chunked pagination, configurable max rows)
- [x] Configurable cache TTLs, connection pool, memory limit, shutdown timeout
- [x] Production hardening (atomic ops, error handling, input validation, SMTP rate limiting)

### Phase 2 — Node.js Scraping Engine ✅ COMPLETE
- [x] Node project setup (TS, ESLint, ioredis)
- [x] Redis job consumer (BLPOP loop)
- [x] Kill signal listener (subscribe to kill:{job_id}, abort on signal)
- [x] Per-job timeout (configurable, default 8 min)
- [x] Streaming batch POSTs (send leads every N results, don't wait till end)
- [x] Google Maps scraper (Puppeteer)
- [x] Contact extractor (email/phone regex from pages)
- [x] Phone validation (libphonenumber-js)
- [x] Tech stack analyzer (Wappalyzer)
- [x] Batch POST to Go API (/internal/leads/batch)
- [x] Job status reporter (POST /internal/jobs/{id}/status)
- [x] Production hardening (idempotent cleanup, graceful shutdown, partial result preservation)

### Phase 3 — Campaign & Queue System ✅ COMPLETE
- [x] Campaign CRUD in Go (create, list, get status)
- [x] Job queue management (redis.EnqueueBatch from Go)
- [x] Progress tracking (SSE endpoint via redis.Subscribe for live updates)
- [x] Campaign status aggregation (jobs completed/total)

### Phase 4 — More Scrapers + Web Crawler (Node.js) ✅ COMPLETE
- [x] Yelp scraper
- [x] Yellow Pages scraper
- [x] Google Dork scraper
- [x] New Domains (WHOIS) scraper
- [x] Reddit scraper
- [x] Web Crawler engine (BFS link follower + contact extractor)
- [x] Crawler frontier (URL queue with depth tracking + visited set)
- [x] Crawler link filter (skip junk URLs, prioritize /contact /about /team)
- [x] Crawler seed URLs for well-known sites (Clutch, G2, BBB, Chambers of Commerce)
- [x] Custom URL list crawling (user provides list of URLs to crawl)

### Phase 5 — API Polish & Export ✅ COMPLETE
- [x] GET /leads with filters (score, city, status, source, pagination)
- [x] CSV / JSON export endpoint
- [x] Circuit breaker on DB (middleware.NewCircuitBreaker)
- [x] Response compression (middleware.Compress — brotli + gzip)
- [x] Request logging (middleware.Logger — failure-only via slog WARN level)

### Phase 6 — Automation ✅ COMPLETE
- [x] Cron scheduler (cron.Register — daily rescrape)
- [x] Redis cache on hot queries (redis.Fetch with singleflight)
- [x] Multi-city batch campaigns

### Production Hardening ✅ COMPLETE
- [x] N+1 dedup queries consolidated into single OR query (3 queries/lead → 1 query/lead)
- [x] Email validation made async — MX/SMTP moved to background cron (5min interval), only format+disposable in hot path
- [x] Circuit breaker moved outside rate limiter (correct position: outermost middleware)
- [x] SQL parameterization: GetStalledJobs interval, LIMIT/OFFSET in GetFiltered
- [x] SMTP connection deadline (10s total conversation limit)
- [x] Export handler error row marker for incomplete CSV
- [x] Slice pre-allocation in ProcessBatch

### Phase 7 — Dashboard (Separate React App) — ON DEMAND ONLY

**⚠️ This phase is NOT part of the default build. Will only be built when explicitly requested.**

The dashboard is a **standalone React frontend** — completely separate from the Go API and Node.js scraper. It talks to the Go API over REST. No backend logic in the dashboard, it's purely a UI layer.

**Build separately:** `cd dashboard && npm run dev` — its own package.json, own Dockerfile, deployed as a static site (Cloudflare Pages / Vercel / Netlify — all free). Until then, all operations are done via the Go REST API directly (Postman / curl / any HTTP client).

**What the dashboard shows:**

- [ ] **Campaign Manager** — create campaigns (pick sources, cities, categories), start/stop/pause
- [ ] **Live Scraping Progress** — real-time job status per campaign (WebSocket / SSE via redis.Subscribe)
  - Jobs breakdown: pending / in_progress / completed / timeout / failed / dead
  - Leads found so far (live counter)
  - Per-source progress bars
- [ ] **Dead Letter Queue Panel** — stalled/failed jobs with error reason
  - "Google Maps NYC timed out 3x" — [Retry] [Dismiss]
  - Filterable by source, status, error type
  - Bulk retry / bulk dismiss
- [ ] **Leads Table** — sortable, filterable, searchable
  - Columns: business name, phone, email, website, score, city, source, status
  - Filters: score range, city, source, phone_valid, email_valid, status
  - Inline actions: mark contacted, mark converted, reject
  - Bulk actions: export selected, bulk status change
- [ ] **Lead Detail View** — full info for a single lead
  - All contact info, tech stack, validation details, confidence scores
  - Source history (which sources found this lead)
  - Timeline (when scraped, when contacted)
- [ ] **Export** — CSV / JSON download with filters applied
- [ ] **Analytics Dashboard**
  - Leads per day (line chart)
  - Leads by source (pie chart)
  - Leads by score bucket: hot (>70) / warm (40-70) / cold (<40)
  - Conversion funnel: scraped → validated → contacted → converted
  - Dead job rate by source (helps identify unreliable sources)
- [ ] **Settings Page**
  - Watchdog config (stale threshold, max attempts — updates env vars via API)
  - Per-source timeout overrides
  - Auto-rescrape toggle per campaign

---

## Estimated Output

| Scale              | Leads/Day (after dedup + validation) |
|--------------------|--------------------------------------|
| 1 city, 5 categories   | 300-800                         |
| 5 cities, 10 categories | 1,500-4,000                    |
| 10 cities, 10 categories| 3,000-8,000                    |

---

## Scalability Architecture (10M+ RPS — Never Breaks)

### Design Principle
Every layer is **stateless + horizontally scalable**. No single point of failure.

**🔑 Rule: Entire stack runs on FREE TIER on day 1. $0/month. Scale up only when you outgrow it.**

### API Layer — Handling 10M+ Requests/Second
```
                    ┌─────────────────┐
                    │   Cloudflare    │  (CDN + DDoS + edge cache)
                    │   + Rate Limiter│  (token bucket per IP/API key)
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Go API   │   │ Go API   │   │ Go API   │  (N instances, auto-scale)
        │ (kit)    │   │ (kit)    │   │ (kit)    │  50K+ RPS each (goroutines)
        └────┬─────┘   └────┬─────┘   └────┬─────┘
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    ┌───────────────┐
                    │  Redis Cache  │  go-starter-kit redis.Fetch()
                    │  (singleflight│  + Lua dedup + pub/sub
                    │   + pipeline) │
                    └───────┬───────┘
                            │ cache miss
                            ▼
                    ┌───────────────┐
                    │  PostgreSQL   │  go-starter-kit postgress
                    │  pgxpool 200  │  + read replicas at scale
                    │  + PgBouncer  │
                    └───────────────┘

              ┌──────────────────────────────┐
              │  Node.js Scraping Workers    │  (separate service)
              │  Pull from Redis queue       │  Scale independently
              │  POST leads to Go API        │
              └──────────────────────────────┘
```

### Key Strategies

**1. Go API Nodes (Stateless, Horizontal Scale)**
- Each Go instance handles 50K+ RPS (goroutines, not single-threaded like Node)
- go-starter-kit's lock-free hot paths — `atomic.Bool` init checks, no mutex on request paths
- pgxpool: 200 connections, binary protocol, prepared-statement caching
- Spin up N instances behind load balancer (auto-scale on CPU/memory/RPS)
- Sticky sessions NOT needed — any node can serve any request

**2. Rate Limiting (Protect Everything)**
- Token bucket at load balancer level: 1000 req/s per API key
- Redis-backed sliding window: prevents burst abuse
- Separate limits: reads (high), writes (medium), exports (low)

**3. Redis Cache Layer**
- Cache hot queries: `GET /leads?city=NYC&score>60` → cached 60s
- Cache individual leads by ID → cached 5 min
- Cache dashboard stats → cached 30s
- Cache invalidation on write (pub/sub)
- **Result:** 95%+ of read requests never hit Postgres

**4. PostgreSQL at Scale**
- **Connection Pooling:** PgBouncer (10K+ concurrent connections → 100 DB connections)
- **Read Replicas:** All GET requests hit replicas, writes go to primary
- **Partitioning:** Partition leads table by `city` or `created_at` month
- **Indexes:** Covering indexes on (city, lead_score), (status), (phone_e164), (email)
- **At 10M+ leads:** Add table partitioning by city hash (64 partitions)

**5. Queue / Scraper Workers (Independent Scale)**
- Node.js scraper workers are completely separate from Go API
- Scale workers independently: 1 worker for free tier, 100 for bulk campaigns
- Each worker pulls from Redis (BlockingDequeue) → scrapes → POSTs to Go API
- Workers crashing does NOT affect API availability
- Go's cron package auto-reschedules failed jobs

**6. Backpressure & Circuit Breakers**
- If queue depth > 10,000 → reject new scrape campaigns with 429
- If DB response time > 2s → circuit breaker trips, serve from cache only
- If scraper source returns 429/503 → exponential backoff, don't retry flood

### Scale Benchmarks

| Component | Single Instance | Scaled (10 instances) | With Cache |
|---|---|---|---|
| Go API (go-starter-kit) | ~50,000 RPS | ~500,000 RPS | ~5,000,000 RPS |
| Add Cloudflare CDN | — | — | **10M+ RPS** |
| PostgreSQL reads | ~10,000 QPS | ~50,000 QPS (replicas) | N/A |
| Redis cache | ~100,000 ops/s | ~500,000 ops/s (cluster) | N/A |
| Scraper workers | ~50 leads/min | ~500 leads/min | N/A |

### How 10M+ RPS Actually Works
```
10M requests hit load balancer
  │
  ├── 70% are static/CDN-cached (Cloudflare edge) → served in <10ms
  ├── 25% hit Redis cache (hot lead queries) → served in <50ms
  ├── 4.5% hit read replicas (cold queries) → served in <200ms
  └── 0.5% are writes (new leads, status updates) → primary DB

Result: DB only sees ~50K actual queries/sec even at 10M RPS
```

### Growth Path
| Stage | Setup | Cost | Handles |
|---|---|---|---|
| **Start (FREE)** | 1 Railway/Render server + Neon DB + Upstash Redis | **$0/mo** | 5K RPS |
| **Growing** | 3 API nodes + Redis + PgBouncer | ~$15/mo | 50K RPS |
| **Scaling** | 10 nodes + Redis Cluster + read replicas | ~$100/mo | 500K RPS |
| **Massive** | N nodes + CDN + edge caching + DB sharding | $500+/mo | 10M+ RPS |

**You start at $0.** The code is identical at every stage — you only change infra config (add instances, flip on replicas). No rewrites needed.

---

## Deployment (100% Free Tier)

### Railway Monorepo Setup (Independent Deploys)

Both services live in the same repo but deploy independently. Changing Node.js code does **NOT** redeploy the Go app, and vice versa.

**How:** Railway supports per-service `watchPaths`. Each service is configured with a root directory and watch paths — Railway only triggers a build when files in that path change.

**Setup:** Create 2 services in the same Railway project, both pointing to the same GitHub repo:

| Railway Service | Root Directory | Watch Paths | Build Command | Start Command |
|---|---|---|---|---|
| `sales-api` | `/api` | `/api/**` | `go build -o server .` | `./server` |
| `sales-scraper` | `/scraper` | `/scraper/**` | `npm run build` | `npm start` |

**`railway.json`** (in repo root):
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "services": {
    "sales-api": {
      "source": {
        "rootDirectory": "api",
        "watchPatterns": ["api/**"]
      },
      "build": {
        "builder": "DOCKERFILE",
        "dockerfilePath": "api/Dockerfile"
      }
    },
    "sales-scraper": {
      "source": {
        "rootDirectory": "scraper",
        "watchPatterns": ["scraper/**"]
      },
      "build": {
        "builder": "DOCKERFILE",
        "dockerfilePath": "scraper/Dockerfile"
      }
    }
  }
}
```

**What happens on push:**
```
git push (changed scraper/src/scrapers/yelp.ts)
  │
  ├── Railway checks watch paths:
  │   ├── sales-api:     /api/**     → NO match → skip deploy ✅
  │   └── sales-scraper: /scraper/** → MATCH    → rebuild + deploy ✅
  │
  └── Result: Only Node.js scraper redeploys. Go API stays running.
```

**Edge cases:**
- Change `PLAN.md` or root `.env` → neither service redeploys (not in watch paths)
- Change both `api/` and `scraper/` in one commit → both redeploy independently
- Shared env vars (DB/Redis URLs) are configured per-service in Railway dashboard, not from root `.env`

---

Entire stack runs on **$0/month** using free tiers:

| Component       | Platform         | Free Tier Limits                          | Cost   |
|-----------------|------------------|-------------------------------------------|--------|
| Go API Server   | **Render**       | 750 hrs/mo (always-on service)             | **$0** |
| Node.js Scraper | **Render** (2nd)  | Runs on-demand (cron trigger / manual)     | **$0** |
| Alt: Both       | **Railway**      | $5 credit/mo (covers both light services)  | **$0** |
| PostgreSQL      | **Neon**         | 0.5 GB storage, 100 hrs compute/mo         | **$0** |
| PostgreSQL      | **Supabase** (alt)| 500 MB storage, 50K rows                   | **$0** |
| Redis / Queue   | **Upstash**      | 10K commands/day, 256 MB                   | **$0** |
| CDN             | **Cloudflare**   | Unlimited bandwidth                        | **$0** |
| DNS             | **Cloudflare**   | Free DNS + proxy                           | **$0** |
| Monitoring      | **Betterstack**  | Free tier logging                          | **$0** |
| **TOTAL**       |                  |                                             | **$0/mo** |

### Free Tier Strategy
- Go API is always-on (uses Render's 750 free hours)
- Node.js scraper runs on-demand: triggered by API, sleeps when idle (uses minimal hours)
- Or combine both on Railway's $5 free credit (both services fit easily)
- Use Neon's serverless Postgres (auto-sleeps when idle, wakes on request)
- Upstash Redis is pay-per-request — 10K free commands/day is enough for queue + caching
- Cloudflare in front handles SSL + CDN + basic DDoS protection for free
- go-starter-kit's pgxpool (200 conns) + redis pool (200 conns) maximize free tier throughput

### When to Upgrade (You'll Know)
| Signal | Action | Cost |
|---|---|---|
| Neon DB hits 0.5 GB | Upgrade to Neon Pro | $19/mo |
| Upstash hits 10K cmds/day | Upgrade to Pay-as-you-go | ~$5/mo |
| Render 750 hrs not enough | Add 2nd service or switch to Railway Pro | $7/mo |
| Need concurrent scraping | Split workers to separate service | +$7/mo |

Start at $0. First paid upgrade probably won't happen until ~50K leads in DB.

---

## Notes
- Edit this file to customize priorities, add/remove sources, adjust scoring
- Mark checkboxes as you complete each phase
- Add city/category lists below as needed

## Target Cities
- [ ] (add your target cities here)

## Target Categories
- [ ] Restaurants
- [ ] Plumbers
- [ ] Real Estate Agents
- [ ] Dentists
- [ ] Lawyers
- [ ] (add more categories)
