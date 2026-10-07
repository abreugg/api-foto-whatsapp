-- Preserve connection IDs referenced by historical photos after remote deletion.
CREATE TABLE IF NOT EXISTS deleted_connections (
  id VARCHAR(100) PRIMARY KEY, deleted_at BIGINT NOT NULL,
  FOREIGN KEY (id) REFERENCES connections(id)
) ENGINE=InnoDB;
