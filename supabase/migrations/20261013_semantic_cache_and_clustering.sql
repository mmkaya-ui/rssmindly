-- ==============================================================================
-- RSSMindly — Supabase pgvector Semantic Cache & Clustering Migration
-- Step 1: Semantic Deduping via Embedding Fingerprints (Cross-Publisher Cache)
-- Step 2: Predictive Pre-Warming via Trend Clustering
-- Step 3: Cascading Multi-Tier Speculative Summarization
-- Step 4: Self-Evaluating Groundedness & Source Attribution
-- ==============================================================================

-- 1. Enable the pgvector extension for semantic similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create or upgrade the summaries table
CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    source TEXT,
    headline_embedding VECTOR(768),             -- Gemini text-embedding-004 output dimension
    fingerprint TEXT,                          -- Fast lexical/content hash
    tier1_micro TEXT,                          -- Tier 1: 0ms instant extractive micro-summary
    tier2_bullets TEXT,                        -- Tier 2: 3-bullet structured takeaway
    tier3_deepdive TEXT,                       -- Tier 3: On-demand contextual deep dive
    text TEXT NOT NULL,                        -- Default rendered summary (Tier 2 HTML)
    groundedness_score FLOAT DEFAULT 1.0,      -- 0.0 to 1.0 deterministic factual check score
    groundedness_report JSONB DEFAULT '{}'::jsonb, -- Verified numbers, entities, warnings
    cluster_id TEXT,                           -- Identifier if grouped in a trend cluster
    is_prewarmed BOOLEAN DEFAULT FALSE,        -- True if pre-cached by predictive clustering cron
    hit_count INT DEFAULT 1,                   -- Number of times served (cost savings metric)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Add column safety for existing tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'headline_embedding') THEN
        ALTER TABLE summaries ADD COLUMN headline_embedding VECTOR(768);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'fingerprint') THEN
        ALTER TABLE summaries ADD COLUMN fingerprint TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'tier1_micro') THEN
        ALTER TABLE summaries ADD COLUMN tier1_micro TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'tier2_bullets') THEN
        ALTER TABLE summaries ADD COLUMN tier2_bullets TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'tier3_deepdive') THEN
        ALTER TABLE summaries ADD COLUMN tier3_deepdive TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'groundedness_score') THEN
        ALTER TABLE summaries ADD COLUMN groundedness_score FLOAT DEFAULT 1.0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'groundedness_report') THEN
        ALTER TABLE summaries ADD COLUMN groundedness_report JSONB DEFAULT '{}'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'cluster_id') THEN
        ALTER TABLE summaries ADD COLUMN cluster_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'is_prewarmed') THEN
        ALTER TABLE summaries ADD COLUMN is_prewarmed BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'hit_count') THEN
        ALTER TABLE summaries ADD COLUMN hit_count INT DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'title') THEN
        ALTER TABLE summaries ADD COLUMN title TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'summaries' AND column_name = 'source') THEN
        ALTER TABLE summaries ADD COLUMN source TEXT;
    END IF;
END $$;

-- 4. Create High-Speed Indexes
-- Fast exact URL lookup
CREATE INDEX IF NOT EXISTS idx_summaries_url ON summaries(url);

-- Fast lookup by creation timestamp for recency filters
CREATE INDEX IF NOT EXISTS idx_summaries_created_at ON summaries(created_at DESC);

-- HNSW vector cosine similarity index for sub-10ms cross-publisher semantic matching
CREATE INDEX IF NOT EXISTS idx_summaries_embedding_hnsw 
ON summaries USING hnsw (headline_embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 5. RPC Function: match_summaries
-- Finds existing summaries with cosine similarity >= match_threshold within the last max_age_hours
CREATE OR REPLACE FUNCTION match_summaries (
    query_embedding VECTOR(768),
    match_threshold FLOAT DEFAULT 0.92,
    match_count INT DEFAULT 1,
    max_age_hours INT DEFAULT 48
)
RETURNS TABLE (
    id UUID,
    url TEXT,
    title TEXT,
    source TEXT,
    text TEXT,
    tier1_micro TEXT,
    tier2_bullets TEXT,
    tier3_deepdive TEXT,
    groundedness_score FLOAT,
    groundedness_report JSONB,
    similarity FLOAT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.url,
        s.title,
        s.source,
        s.text,
        s.tier1_micro,
        s.tier2_bullets,
        s.tier3_deepdive,
        s.groundedness_score,
        s.groundedness_report,
        (1 - (s.headline_embedding <=> query_embedding))::FLOAT AS similarity,
        s.created_at
    FROM summaries s
    WHERE s.headline_embedding IS NOT NULL
      AND s.created_at >= (NOW() - (max_age_hours || ' hours')::INTERVAL)
      AND (1 - (s.headline_embedding <=> query_embedding)) >= match_threshold
    ORDER BY s.headline_embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

-- 6. Helper function to record cache hits and update savings metrics
CREATE OR REPLACE FUNCTION increment_summary_hit (summary_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE summaries
    SET hit_count = hit_count + 1,
        updated_at = NOW()
    WHERE id = summary_id;
END;
$$;

-- 7. Trending Clusters Table (Optional for Pre-Warming audit and analytics)
CREATE TABLE IF NOT EXISTS trending_clusters (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    article_count INT DEFAULT 0,
    feed_sources TEXT[] DEFAULT '{}',
    representative_summary_id UUID REFERENCES summaries(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_trending_clusters_created ON trending_clusters(created_at DESC);
