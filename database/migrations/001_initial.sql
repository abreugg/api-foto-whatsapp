-- Dates are UTC epoch milliseconds, independent of the database time zone.
CREATE TABLE IF NOT EXISTS settings (`key` VARCHAR(80) PRIMARY KEY, value VARCHAR(255) NOT NULL) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS api_keys (
  id CHAR(36) PRIMARY KEY, name VARCHAR(80) NOT NULL, digest CHAR(64) NOT NULL UNIQUE,
  prefix VARCHAR(16) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at BIGINT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS domains (
  id CHAR(36) PRIMARY KEY, origin VARCHAR(255) COLLATE utf8mb4_bin NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at BIGINT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS connections (
  id VARCHAR(100) PRIMARY KEY, name VARCHAR(255) NOT NULL, token TEXT NOT NULL, jid VARCHAR(255),
  connected BOOLEAN NOT NULL DEFAULT FALSE, logged_in BOOLEAN NOT NULL DEFAULT FALSE,
  rotation BOOLEAN NOT NULL DEFAULT FALSE, last_used BIGINT NOT NULL DEFAULT 0, synced_at BIGINT NOT NULL
) ENGINE=InnoDB;
-- MEDIUMBLOB stores the actual image, rather than only an expiring WhatsApp URL.
CREATE TABLE IF NOT EXISTS photos (
  id CHAR(36) PRIMARY KEY, phone VARCHAR(15) NOT NULL, source_url TEXT NOT NULL,
  image MEDIUMBLOB NOT NULL, mime VARCHAR(30) NOT NULL, connection_id VARCHAR(100) NOT NULL,
  saved_at BIGINT NOT NULL, invalidated BOOLEAN NOT NULL DEFAULT FALSE,
  INDEX photos_phone_date (phone,saved_at), FOREIGN KEY (connection_id) REFERENCES connections(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS requests (
  id CHAR(36) PRIMARY KEY, phone VARCHAR(15) NOT NULL, api_key_id CHAR(36), domain_id CHAR(36),
  origin VARCHAR(255), photo_id CHAR(36), cache_hit BOOLEAN NOT NULL, status SMALLINT NOT NULL,
  error VARCHAR(512), created_at BIGINT NOT NULL,
  INDEX requests_key_date (api_key_id,created_at), INDEX requests_domain_date (domain_id,created_at),
  INDEX requests_phone_date (phone,created_at), INDEX requests_created (created_at),
  FOREIGN KEY (photo_id) REFERENCES photos(id), FOREIGN KEY (api_key_id) REFERENCES api_keys(id), FOREIGN KEY (domain_id) REFERENCES domains(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sessions (
  digest CHAR(64) PRIMARY KEY, csrf CHAR(48) NOT NULL, admin_key_digest CHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL, INDEX session_expiry (expires_at)
) ENGINE=InnoDB;
