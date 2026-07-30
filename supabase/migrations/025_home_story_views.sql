-- Home stories: track unique viewers + fast aggregate count for UI.

ALTER TABLE home_stories
ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS home_story_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES home_stories(id) ON DELETE CASCADE,
  viewer_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  viewer_key TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Authenticated viewer: one view per story per profile.
CREATE UNIQUE INDEX IF NOT EXISTS uq_home_story_views_story_profile
  ON home_story_views(story_id, viewer_profile_id);

-- Anonymous/session viewer: one view per story per viewer key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_home_story_views_story_key
  ON home_story_views(story_id, viewer_key);

CREATE INDEX IF NOT EXISTS idx_home_story_views_story
  ON home_story_views(story_id);

CREATE OR REPLACE FUNCTION increment_home_story_views_count(p_story_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE home_stories
  SET views_count = views_count + 1
  WHERE id = p_story_id;
END;
$$;
