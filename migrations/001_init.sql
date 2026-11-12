-- Blacklist2WEB website database (separate from the game database ts2_gamedb).

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_id    VARCHAR(16)  NOT NULL,              -- the game login (memberinfo.uID)
  email         VARCHAR(190) NULL,
  pass_hash     VARCHAR(100) NOT NULL,              -- bcrypt, website login only
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  banned        TINYINT(1)   NOT NULL DEFAULT 0,
  referral_code VARCHAR(32)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME     NULL,
  last_ip       VARCHAR(45)  NULL,
  UNIQUE KEY uq_users_account (account_id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS news (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tag          ENUM('Update','Event','Notice','Maintenance') NOT NULL DEFAULT 'Update',
  title        VARCHAR(160) NOT NULL,
  summary      VARCHAR(400) NOT NULL,
  body         TEXT         NOT NULL,
  published    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_news_pub (published, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS packs (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  coins       INT UNSIGNED NOT NULL,
  bonus       INT UNSIGNED NOT NULL DEFAULT 0,
  price_php   DECIMAL(10,2) NOT NULL,
  price_usd   DECIMAL(10,2) NULL,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  sort        INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resellers (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  prefix      VARCHAR(4)   NOT NULL,                 -- shown in their codes, e.g. PH1
  country     VARCHAR(60)  NOT NULL DEFAULT '',
  contact     VARCHAR(200) NOT NULL DEFAULT '',      -- link or handle shown publicly
  methods     VARCHAR(200) NOT NULL DEFAULT '',      -- e.g. "GCash, Maya, bank"
  visible     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_resellers_prefix (prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS code_batches (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reseller_id INT UNSIGNED NULL,
  label       VARCHAR(120) NOT NULL,
  coins       INT UNSIGNED NOT NULL,
  quantity    INT UNSIGNED NOT NULL,
  expires_at  DATETIME     NULL,
  disabled    TINYINT(1)   NOT NULL DEFAULT 0,
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_batch_reseller FOREIGN KEY (reseller_id) REFERENCES resellers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS codes (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id    INT UNSIGNED NOT NULL,
  code_hash   CHAR(64)     NOT NULL,                 -- sha256(pepper + normalized code); the code itself is never stored
  hint        VARCHAR(12)  NOT NULL,                 -- prefix + last 4, for support
  disabled    TINYINT(1)   NOT NULL DEFAULT 0,
  redeemed_by INT UNSIGNED NULL,
  redeemed_at DATETIME     NULL,
  UNIQUE KEY uq_codes_hash (code_hash),
  KEY ix_codes_batch (batch_id),
  CONSTRAINT fk_codes_batch FOREIGN KEY (batch_id) REFERENCES code_batches(id),
  CONSTRAINT fk_codes_user FOREIGN KEY (redeemed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- GCash manual orders
CREATE TABLE IF NOT EXISTS orders (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_no     VARCHAR(16)  NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  pack_id      INT UNSIGNED NOT NULL,
  coins        INT UNSIGNED NOT NULL,                -- coins + bonus at the time of ordering
  amount_php   DECIMAL(10,2) NOT NULL,               -- price + unique centavos
  method       VARCHAR(20)  NOT NULL DEFAULT 'gcash',
  reference_no VARCHAR(32)  NULL,
  status       ENUM('awaiting_payment','submitted','approved','rejected','expired') NOT NULL DEFAULT 'awaiting_payment',
  note         VARCHAR(255) NULL,
  reviewed_by  INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME     NOT NULL,
  submitted_at DATETIME     NULL,
  reviewed_at  DATETIME     NULL,
  UNIQUE KEY uq_orders_no (order_no),
  UNIQUE KEY uq_orders_ref (method, reference_no),
  KEY ix_orders_status (status, created_at),
  KEY ix_orders_user (user_id, created_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_pack FOREIGN KEY (pack_id) REFERENCES packs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every coin grant, from any source. (source, source_id) is unique, so a grant can never run twice.
CREATE TABLE IF NOT EXISTS coin_credits (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  source      ENUM('order','code','admin') NOT NULL,
  source_id   VARCHAR(40)  NOT NULL,
  coins       INT          NOT NULL,
  status      ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
  attempts    INT UNSIGNED NOT NULL DEFAULT 0,
  last_error  VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  done_at     DATETIME     NULL,
  UNIQUE KEY uq_credit_source (source, source_id),
  KEY ix_credit_user (user_id, created_at),
  KEY ix_credit_status (status),
  CONSTRAINT fk_credit_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_log (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_id    INT UNSIGNED NOT NULL,
  action      VARCHAR(60)  NOT NULL,
  detail      VARCHAR(500) NOT NULL DEFAULT '',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_admin_log (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Example packs (edit them in Admin > Packs)
INSERT INTO packs (coins, bonus, price_php, price_usd, sort)
SELECT * FROM (SELECT 500 AS c, 0 AS b, 250.00 AS p, 5.00 AS u, 1 AS s
  UNION ALL SELECT 1000, 50, 500.00, 10.00, 2
  UNION ALL SELECT 2500, 250, 1250.00, 25.00, 3
  UNION ALL SELECT 5000, 750, 2500.00, 50.00, 4
  UNION ALL SELECT 10000, 2000, 5000.00, 100.00, 5) AS seed
WHERE NOT EXISTS (SELECT 1 FROM packs);
