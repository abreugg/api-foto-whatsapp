-- Upgrade existing VPS databases: negative photo cache, preserving all existing data.
CREATE TABLE IF NOT EXISTS missing_photos (
  phone VARCHAR(15) PRIMARY KEY, saved_at BIGINT NOT NULL,
  invalidated BOOLEAN NOT NULL DEFAULT FALSE, INDEX missing_photos_date (saved_at)
) ENGINE=InnoDB;
