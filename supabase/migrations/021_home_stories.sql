-- Home / "our work" stories: staff + admin uploads; public read on home

CREATE TABLE home_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_home_stories_created ON home_stories(created_at DESC);
CREATE INDEX idx_home_stories_staff ON home_stories(staff_id) WHERE staff_id IS NOT NULL;

COMMENT ON TABLE home_stories IS 'Salon stories: staff_id NULL = admin/salon post; else barber post.';

ALTER TABLE home_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read home stories"
  ON home_stories FOR SELECT
  USING (true);

-- Inserts/updates/deletes go through API (service role)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'home-stories',
  'home-stories',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read home stories storage" ON storage.objects;
CREATE POLICY "Public read home stories storage"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'home-stories');
