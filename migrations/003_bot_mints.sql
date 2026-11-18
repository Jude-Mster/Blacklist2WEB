-- One row per Discord order that received a code from the bot. order_ref is unique, so the
-- same order can never mint two codes (the bot may retry after a timeout).
CREATE TABLE IF NOT EXISTS bot_mints (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_ref    VARCHAR(40)  NOT NULL,
  pack_id      INT UNSIGNED NOT NULL,
  coins        INT UNSIGNED NOT NULL,
  code_id      INT UNSIGNED NULL,                    -- set in the same transaction
  discord_user VARCHAR(32)  NOT NULL DEFAULT '',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bot_mints_ref (order_ref),
  CONSTRAINT fk_bot_mints_code FOREIGN KEY (code_id) REFERENCES codes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
