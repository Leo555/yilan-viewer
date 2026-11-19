-- 电商示例库：建表、索引与常用报表查询（PostgreSQL）
CREATE TABLE users (
    id          BIGSERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    nickname    VARCHAR(50)  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    amount      NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    status      TEXT         NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);

-- 近 30 天每日 GMV 及环比
WITH daily AS (
    SELECT date_trunc('day', created_at)::date AS day,
           SUM(amount)                         AS gmv,
           COUNT(*)                            AS orders
    FROM orders
    WHERE status IN ('paid', 'shipped')
      AND created_at >= now() - INTERVAL '30 days'
    GROUP BY 1
)
SELECT day,
       gmv,
       orders,
       ROUND(100.0 * (gmv - LAG(gmv) OVER w) / NULLIF(LAG(gmv) OVER w, 0), 1) AS growth_pct
FROM daily
WINDOW w AS (ORDER BY day)
ORDER BY day DESC;

-- 每个用户消费金额排名前 3 的订单
SELECT *
FROM (
    SELECT u.nickname, o.id AS order_id, o.amount,
           ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.amount DESC) AS rn
    FROM orders o
    JOIN users u ON u.id = o.user_id
) t
WHERE rn <= 3;
