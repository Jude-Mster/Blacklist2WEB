-- Email verification: a user must confirm their email before recharging, redeeming codes or
-- changing the password. Tokens are stored only as SHA-256 hashes.

ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER email;

CREATE TABLE IF NOT EXISTS email_tokens (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  email       VARCHAR(190) NOT NULL,          -- the address this token confirms
  token_hash  CHAR(64)     NOT NULL,
  expires_at  DATETIME     NOT NULL,
  used_at     DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_tokens_hash (token_hash),
  KEY ix_email_tokens_user (user_id, created_at),
  CONSTRAINT fk_email_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
