CREATE TABLE IF NOT EXISTS campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    sources         TEXT[] NOT NULL,
    cities          TEXT[] NOT NULL,
    categories      TEXT[] NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    auto_rescrape   BOOLEAN NOT NULL DEFAULT false,
    jobs_total      INT NOT NULL DEFAULT 0,
    jobs_completed  INT NOT NULL DEFAULT 0,
    leads_found     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
