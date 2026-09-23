-- =====================================================================
-- PulseCraft - Veritabanı Şeması
-- PostgreSQL 16 + TimescaleDB
-- Bu dosya container ilk ayağa kalktığında otomatik çalışır.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------
-- 1. İLİŞKİSEL TABLOLAR
-- ---------------------------------------------------------------------

-- Kullanıcılar (dashboard'a giriş yapanlar)
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT        NOT NULL,
    password_hash   TEXT        NOT NULL,
    display_name    TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));

-- İzlenen sunucular (her birinde bir agent çalışır)
CREATE TABLE nodes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    hostname        TEXT,
    os              TEXT,
    api_key_hash    TEXT        NOT NULL,            -- agent kimlik doğrulaması (düz key saklanmaz)
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    last_seen_at    TIMESTAMPTZ,                     -- son metrik geliş zamanı (online/offline için)
    created_by      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alarm kuralları (ör. cpu_percent > 85, 30 sn boyunca)
CREATE TABLE alert_rules (
    id               BIGSERIAL PRIMARY KEY,
    name             TEXT        NOT NULL,
    node_id          UUID        REFERENCES nodes(id) ON DELETE CASCADE,  -- NULL = tüm sunucular
    metric           TEXT        NOT NULL CHECK (metric IN ('cpu_percent','mem_percent','disk_percent')),
    operator         TEXT        NOT NULL CHECK (operator IN ('>','>=','<','<=')),
    threshold        REAL        NOT NULL,
    duration_seconds INT         NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    severity         TEXT        NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
    enabled          BOOLEAN     NOT NULL DEFAULT true,
    created_by       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tetiklenen alarmlar (open -> acknowledged -> resolved)
CREATE TABLE alerts (
    id               BIGSERIAL PRIMARY KEY,
    rule_id          BIGINT      NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    node_id          UUID        NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
    trigger_value    REAL        NOT NULL,
    triggered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by  BIGINT      REFERENCES users(id) ON DELETE SET NULL,   -- "İncelemeye aldım"
    acknowledged_at  TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ
);
-- Aynı kural + sunucu için aynı anda tek aktif alarm olsun (spam engeli)
CREATE UNIQUE INDEX ux_alerts_active ON alerts (rule_id, node_id)
    WHERE status IN ('open','acknowledged');
CREATE INDEX ix_alerts_status_time ON alerts (status, triggered_at DESC);

-- Bildirimler (kullanıcıya düşen alarm bildirimleri)
CREATE TABLE notifications (
    id          BIGSERIAL PRIMARY KEY,
    alert_id    BIGINT      NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel     TEXT        NOT NULL DEFAULT 'web' CHECK (channel IN ('web','email')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at     TIMESTAMPTZ
);
CREATE INDEX ix_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------
-- 2. ZAMAN SERİSİ TABLOSU (geniş tablo)
-- ---------------------------------------------------------------------

CREATE TABLE metrics (
    time             TIMESTAMPTZ NOT NULL,
    node_id          UUID        NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    cpu_percent      REAL        NOT NULL,
    mem_percent      REAL        NOT NULL,
    mem_used_bytes   BIGINT      NOT NULL,
    disk_percent     REAL        NOT NULL,
    net_rx_bps       BIGINT      NOT NULL,   -- saniyede alınan byte
    net_tx_bps       BIGINT      NOT NULL,   -- saniyede gönderilen byte
    load1            REAL                    -- Linux load average (Windows'ta NULL)
);

SELECT create_hypertable('metrics', 'time', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX ix_metrics_node_time ON metrics (node_id, time DESC);

-- ---------------------------------------------------------------------
-- 3. TIMESCALE POLİTİKALARI
-- ---------------------------------------------------------------------

-- 7 günden eski ham veriyi sıkıştır (sunucu bazında gruplanarak)
ALTER TABLE metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'node_id',
    timescaledb.compress_orderby   = 'time DESC'
);
SELECT add_compression_policy('metrics', INTERVAL '7 days');

-- 30 günden eski ham veriyi sil
SELECT add_retention_policy('metrics', INTERVAL '30 days');

-- 1 dakikalık özet (uzun aralıklı grafikler buradan okunur)
CREATE MATERIALIZED VIEW metrics_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket(INTERVAL '1 minute', time) AS bucket,
    node_id,
    avg(cpu_percent)  AS cpu_avg,
    max(cpu_percent)  AS cpu_max,
    avg(mem_percent)  AS mem_avg,
    max(mem_percent)  AS mem_max,
    avg(disk_percent) AS disk_avg,
    avg(net_rx_bps)   AS net_rx_avg,
    avg(net_tx_bps)   AS net_tx_avg
FROM metrics
GROUP BY bucket, node_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_1m',
    start_offset      => INTERVAL '1 hour',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

-- Özet veriyi 180 gün tut
SELECT add_retention_policy('metrics_1m', INTERVAL '180 days');
