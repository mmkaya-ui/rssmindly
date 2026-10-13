-- ==============================================================================
-- RSSMindly — Full Supabase Database Schema
-- Includes pgvector semantic caching, trend clustering, and verification
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    source TEXT,
    headline_embedding VECTOR(768),             -- Gemini text-embedding-004 vector
    fingerprint TEXT,                          -- Fast content hash
    tier1_micro TEXT,                          -- Tier 1: 0ms instant extractive micro-summary
    tier2_bullets TEXT,                        -- Tier 2: 3-bullet structured takeaway (HTML)
    tier3_deepdive TEXT,                       -- Tier 3: On-demand contextual deep dive
    text TEXT NOT NULL,                        -- Rendered summary
    groundedness_score FLOAT DEFAULT 1.0,      -- 0.0 to 1.0 score
    groundedness_report JSONB DEFAULT '{}'::jsonb,
    cluster_id TEXT,                           -- Identifier if grouped in a trend cluster
    is_prewarmed BOOLEAN DEFAULT FALSE,
    hit_count INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_summaries_url ON summaries(url);
CREATE INDEX IF NOT EXISTS idx_summaries_created_at ON summaries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_embedding_hnsw 
ON summaries USING hnsw (headline_embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

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
