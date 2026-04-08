CREATE TABLE IF NOT EXISTS leads (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name       TEXT NOT NULL,
    category            TEXT,
    phone_e164          TEXT UNIQUE,
    phone_valid         BOOLEAN NOT NULL DEFAULT false,
    phone_type          TEXT,
    phone_confidence    INT NOT NULL DEFAULT 0,
    email               TEXT,
    email_valid         BOOLEAN NOT NULL DEFAULT false,
    email_catchall      BOOLEAN NOT NULL DEFAULT false,
    email_disposable    BOOLEAN NOT NULL DEFAULT false,
    email_confidence    INT NOT NULL DEFAULT 0,
    website_url         TEXT,
    website_domain      TEXT UNIQUE,
    address             TEXT,
    city                TEXT,
    country             TEXT,
    source              TEXT[] NOT NULL DEFAULT '{}',
    lead_score          INT NOT NULL DEFAULT 0,
    tech_stack          JSONB,
    has_ssl             BOOLEAN,
    is_mobile_friendly  BOOLEAN,
    status              TEXT NOT NULL DEFAULT 'new',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_city_score ON leads (city, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_unique ON leads (LOWER(email)) WHERE email IS NOT NULL;
