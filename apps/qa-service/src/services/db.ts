import mysql from 'mysql2/promise'

let _pool: mysql.Pool | null = null

export function getPool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 3306),
      database: process.env.DB_NAME ?? 'bookstack',
      user: process.env.DB_USER ?? 'bookstack',
      password: process.env.DB_PASS ?? 'bookstack_secret',
      waitForConnections: true,
      connectionLimit: 5,
    })
  }
  return _pool
}

// keep pool export for backward-compat with tests
export const pool = {
  execute: (...args: Parameters<mysql.Pool['execute']>) => getPool().execute(...args),
} as unknown as mysql.Pool

export async function runMigrations(): Promise<void> {
  const p = getPool()
  await p.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_user_roles (
      user_id     INT          NOT NULL,
      email       VARCHAR(255) NOT NULL,
      name        VARCHAR(255) NOT NULL DEFAULT '',
      role        ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id)
    )
  `)
  await p.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_shelf_visibility (
      shelf_id    INT          NOT NULL,
      shelf_name  VARCHAR(255) NOT NULL DEFAULT '',
      visibility  ENUM('public','team','private') NOT NULL DEFAULT 'public',
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (shelf_id)
    )
  `)
  await p.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id           BIGINT       NOT NULL AUTO_INCREMENT,
      page_id      INT          NOT NULL,
      chunk_index  INT          NOT NULL,
      page_name    VARCHAR(512) NOT NULL DEFAULT '',
      page_url     VARCHAR(1024) NOT NULL DEFAULT '',
      text         MEDIUMTEXT   NOT NULL,
      embedding    JSON         NOT NULL,
      updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_page_chunk (page_id, chunk_index),
      KEY idx_page_id (page_id)
    )
  `)
  await p.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_sync_meta (
      meta_key   VARCHAR(64)  NOT NULL,
      meta_value TEXT         NOT NULL,
      PRIMARY KEY (meta_key)
    )
  `)
  await p.execute(`
    CREATE TABLE IF NOT EXISTS asset_source (
      id            BIGINT       NOT NULL AUTO_INCREMENT,
      name          VARCHAR(255) NOT NULL,
      source_type   VARCHAR(64)  NOT NULL DEFAULT 'bookstack',
      system_name   VARCHAR(255) NOT NULL DEFAULT '',
      config_json   JSON         NULL,
      status        VARCHAR(32)  NOT NULL DEFAULT 'healthy',
      asset_count   INT          NOT NULL DEFAULT 0,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_asset_source_type (source_type)
    )
  `)
  await p.execute(`
    CREATE TABLE IF NOT EXISTS asset_item (
      id              BIGINT        NOT NULL AUTO_INCREMENT,
      source_id       BIGINT        NOT NULL,
      external_ref    VARCHAR(512)  NOT NULL,
      name            VARCHAR(512)  NOT NULL,
      asset_type      VARCHAR(64)   NOT NULL DEFAULT 'document',
      project_tag     VARCHAR(128)  NULL,
      domain_tag      VARCHAR(128)  NULL,
      summary         TEXT          NULL,
      summary_status  VARCHAR(32)   NOT NULL DEFAULT 'pending',
      ingest_status   VARCHAR(32)   NOT NULL DEFAULT 'unknown',
      updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_asset_source_ext (source_id, external_ref),
      KEY idx_asset_item_source (source_id),
      CONSTRAINT fk_asset_item_source FOREIGN KEY (source_id) REFERENCES asset_source(id) ON DELETE CASCADE
    )
  `)
  await p.execute(`
    CREATE TABLE IF NOT EXISTS asset_knowledge_link (
      id                 BIGINT        NOT NULL AUTO_INCREMENT,
      item_id            BIGINT        NOT NULL,
      vector_mapping_id  VARCHAR(128)  NULL,
      graph_mapping_id   VARCHAR(128)  NULL,
      mapping_type       VARCHAR(32)   NOT NULL DEFAULT 'rag',
      status             VARCHAR(32)   NOT NULL DEFAULT 'pending',
      last_error         TEXT          NULL,
      updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_asset_knowledge_item (item_id),
      CONSTRAINT fk_asset_knowledge_item FOREIGN KEY (item_id) REFERENCES asset_item(id) ON DELETE CASCADE
    )
  `)
  await ensureDefaultAssetSource(p)
}

async function ensureDefaultAssetSource(p: mysql.Pool): Promise<void> {
  const [rows] = await p.execute(
    `SELECT id FROM asset_source WHERE source_type = ? LIMIT 1`,
    ['bookstack'],
  )
  if ((rows as { id: number }[]).length > 0) return
  await p.execute(
    `INSERT INTO asset_source (name, source_type, system_name, status, asset_count)
     VALUES (?, ?, ?, 'healthy', 0)`,
    ['BookStack 主库', 'bookstack', 'BookStack'],
  )
}
