-- PulseCraft database schema (PostgreSQL 16 + TimescaleDB).
-- Runs automatically on the first start of an empty database volume.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------
-- 1. Relational tables
-- ---------------------------------------------------------------------

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT        NOT NULL,
    password_hash   TEXT        NOT NULL,
    display_name    TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));

CREATE TABLE nodes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    hostname        TEXT,
    os              TEXT,
    api_key_hash    TEXT        NOT NULL,            -- the plain key is never stored
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    last_seen_at    TIMESTAMPTZ,                     -- server receive time of the last samples
    created_by      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
    id               BIGSERIAL PRIMARY KEY,
    name             TEXT        NOT NULL,
    node_id          UUID        REFERENCES nodes(id) ON DELETE CASCADE,  -- NULL = all servers
    metric           TEXT        NOT NULL CHECK (metric IN ('cpu_percent','mem_percent','disk_percent')),
    operator         TEXT        NOT NULL CHECK (operator IN ('>','>=','<','<=')),
    threshold        REAL        NOT NULL,
    duration_seconds INT         NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    severity         TEXT        NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
    enabled          BOOLEAN     NOT NULL DEFAULT true,
    created_by       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lifecycle: open -> acknowledged -> resolved
CREATE TABLE alerts (
    id               BIGSERIAL PRIMARY KEY,
    rule_id          BIGINT      NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    node_id          UUID        NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
    trigger_value    REAL        NOT NULL,
    triggered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by  BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at  TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ
);
-- At most one active alert per rule and server, even under concurrent evaluation.
CREATE UNIQUE INDEX ux_alerts_active ON alerts (rule_id, node_id)
    WHERE status IN ('open','acknowledged');
CREATE INDEX ix_alerts_status_time ON alerts (status, triggered_at DESC);

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
-- 2. Time series (one wide row per sample)
-- ---------------------------------------------------------------------

CREATE TABLE metrics (
    time             TIMESTAMPTZ NOT NULL,
    node_id          UUID        NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    cpu_percent      REAL        NOT NULL,
    mem_percent      REAL        NOT NULL,
    mem_used_bytes   BIGINT      NOT NULL,
    disk_percent     REAL        NOT NULL,
    net_rx_bps       BIGINT      NOT NULL,   -- bytes received per second
    net_tx_bps       BIGINT      NOT NULL,   -- bytes sent per second
    load1            REAL                    -- NULL where the platform has no load average
);

SELECT create_hypertable('metrics', 'time', chunk_time_interval => INTERVAL '1 day');
-- One row per server and timestamp: a batch re-sent after an agent timeout (or a timestamp repeated within
-- one request) cannot create duplicates, because the server inserts with ON CONFLICT DO NOTHING. A unique
-- index on a hypertable must include the partitioning column (time). The same index also serves the
-- "newest sample per server" lookup.
CREATE UNIQUE INDEX ux_metrics_node_time ON metrics (node_id, time DESC);

-- ---------------------------------------------------------------------
-- 3. TimescaleDB policies
-- ---------------------------------------------------------------------

ALTER TABLE metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'node_id',
    timescaledb.compress_orderby   = 'time DESC'
);
SELECT add_compression_policy('metrics', INTERVAL '7 days');

SELECT add_retention_policy('metrics', INTERVAL '30 days');

-- 1-minute aggregate: longer chart ranges read from here.
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

SELECT add_retention_policy('metrics_1m', INTERVAL '180 days');
