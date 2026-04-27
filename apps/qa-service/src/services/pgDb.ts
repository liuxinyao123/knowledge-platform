import pg from 'pg'
import { hashPassword } from './passwordHash.ts'

let _pool: pg.Pool | null = null

export function getPgPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      host:     process.env.PG_HOST     ?? '127.0.0.1',
      port:     Number(process.env.PG_PORT ?? 5432),
      database: process.env.PG_DB       ?? 'knowledge',
      user:     process.env.PG_USER     ?? 'knowledge',
      password: process.env.PG_PASS     ?? 'knowledge_secret',
      max: 5,
    })
  }
  return _pool
}

export async function runPgMigrations(): Promise<void> {
  const pool = getPgPool()
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_source (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(256) NOT NULL,
      type       VARCHAR(64)  NOT NULL,
      connector  VARCHAR(128),
      config     JSONB,
      status     VARCHAR(32)  DEFAULT 'active',
      created_by VARCHAR(128),
      created_at TIMESTAMP    DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_asset (
      id          SERIAL PRIMARY KEY,
      source_id   INT REFERENCES metadata_source(id),
      external_id VARCHAR(512),
      name        VARCHAR(512) NOT NULL,
      type        VARCHAR(64),
      path        TEXT,
      content     TEXT,
      summary     TEXT,
      tags        TEXT[],
      metadata    JSONB,
      indexed_at  TIMESTAMP,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_source ON metadata_asset(source_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_ext ON metadata_asset(external_id)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_field (
      id          SERIAL PRIMARY KEY,
      asset_id    INT REFERENCES metadata_asset(id) ON DELETE CASCADE,
      chunk_index INT NOT NULL,
      chunk_level INT DEFAULT 3,
      content     TEXT NOT NULL,
      embedding   vector(4096),
      token_count INT,
      metadata    JSONB
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_field_embedding
      ON metadata_field USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
  `).catch(() => {})
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_acl_rule (
      id         SERIAL PRIMARY KEY,
      asset_id   INT REFERENCES metadata_asset(id) ON DELETE CASCADE,
      source_id  INT REFERENCES metadata_source(id),
      role       VARCHAR(64),
      permission VARCHAR(64) NOT NULL,
      condition  JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  // PDF Pipeline v2 — 给 metadata_field 加 page 列（保留页码引用，便于 citation 高亮）
  await pool.query(
    `ALTER TABLE metadata_field ADD COLUMN IF NOT EXISTS page INT`,
  )

  // Ingest Pipeline 统一 —— kind / bbox / heading_path / image_id
  await pool.query(
    `ALTER TABLE metadata_field ADD COLUMN IF NOT EXISTS kind VARCHAR(32)`,
  )
  await pool.query(
    `ALTER TABLE metadata_field ADD COLUMN IF NOT EXISTS bbox JSONB`,
  )
  await pool.query(
    `ALTER TABLE metadata_field ADD COLUMN IF NOT EXISTS heading_path TEXT`,
  )
  await pool.query(
    `ALTER TABLE metadata_field ADD COLUMN IF NOT EXISTS image_id INT`,
  )
  // image_id FK 分开加，避免重复运行报错
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'metadata_field_image_fk'
      ) THEN
        ALTER TABLE metadata_field
          ADD CONSTRAINT metadata_field_image_fk
          FOREIGN KEY (image_id) REFERENCES metadata_asset_image(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `)

  // PDF Pipeline v2 — 图片落档元数据
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_asset_image (
      id          SERIAL PRIMARY KEY,
      asset_id    INT NOT NULL REFERENCES metadata_asset(id) ON DELETE CASCADE,
      page        INT NOT NULL,
      image_index INT NOT NULL,
      bbox        JSONB,
      file_path   TEXT NOT NULL,
      caption     TEXT,
      created_at  TIMESTAMP DEFAULT NOW(),
      UNIQUE (asset_id, page, image_index)
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_metadata_asset_image_asset
     ON metadata_asset_image(asset_id)`,
  )
  // 知识治理 —— 审计 / 重复忽略表 / asset 软删除标
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id                BIGSERIAL PRIMARY KEY,
      ts                TIMESTAMP NOT NULL DEFAULT NOW(),
      principal_user_id INT,
      principal_email   VARCHAR(255),
      action            VARCHAR(64) NOT NULL,
      target_type       VARCHAR(32),
      target_id         VARCHAR(128),
      detail            JSONB,
      source_ip         VARCHAR(64)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(principal_user_id)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS duplicate_dismissed (
      asset_id_a   INT NOT NULL,
      asset_id_b   INT NOT NULL,
      dismissed_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (asset_id_a, asset_id_b)
    )
  `)

  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS merged_into INT`)
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS author VARCHAR(255)`)

  // unified-auth-permissions —— ACL 规则可加 permission_required 列
  await pool.query(
    `ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS permission_required VARCHAR(64)`,
  )

  // real-login (G9) —— users 表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         VARCHAR(128) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      roles         JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email))`)

  // ─── 评测体系（Roadmap-2 雏形：资产级 recall@K） ─────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eval_dataset (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(256) NOT NULL,
      description TEXT,
      created_by  VARCHAR(255),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eval_case (
      id                 SERIAL PRIMARY KEY,
      dataset_id         INT NOT NULL REFERENCES eval_dataset(id) ON DELETE CASCADE,
      ext_id             VARCHAR(64),
      question           TEXT NOT NULL,
      expected_asset_ids INT[] NOT NULL DEFAULT ARRAY[]::INT[],
      comment            TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_case_dataset ON eval_case(dataset_id)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eval_run (
      id                 SERIAL PRIMARY KEY,
      dataset_id         INT NOT NULL REFERENCES eval_dataset(id) ON DELETE CASCADE,
      status             VARCHAR(16) NOT NULL DEFAULT 'pending',
      total              INT NOT NULL DEFAULT 0,
      finished           INT NOT NULL DEFAULT 0,
      errored            INT NOT NULL DEFAULT 0,
      recall_at_1        NUMERIC(6,4),
      recall_at_3        NUMERIC(6,4),
      recall_at_5        NUMERIC(6,4),
      avg_first_hit_rank NUMERIC(6,2),
      notes              TEXT,
      principal_email    VARCHAR(255),
      started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at        TIMESTAMPTZ
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_run_dataset ON eval_run(dataset_id)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eval_case_result (
      id                  SERIAL PRIMARY KEY,
      run_id              INT NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
      case_id             INT REFERENCES eval_case(id) ON DELETE SET NULL,
      ext_id              VARCHAR(64),
      question            TEXT NOT NULL,
      expected_asset_ids  INT[] NOT NULL DEFAULT ARRAY[]::INT[],
      retrieved_asset_ids INT[] NOT NULL DEFAULT ARRAY[]::INT[],
      recall_at_1         NUMERIC(6,4),
      recall_at_3         NUMERIC(6,4),
      recall_at_5         NUMERIC(6,4),
      first_hit_rank      INT,
      duration_ms         INT,
      error               TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_result_run ON eval_case_result(run_id)`)
  // ── LLM Judge 字段（V2，可选，老数据 NULL） ─────────────────────────────────
  await pool.query(`ALTER TABLE eval_case        ADD COLUMN IF NOT EXISTS expected_answer TEXT`)
  await pool.query(`ALTER TABLE eval_case_result ADD COLUMN IF NOT EXISTS expected_answer TEXT`)
  await pool.query(`ALTER TABLE eval_case_result ADD COLUMN IF NOT EXISTS system_answer   TEXT`)
  await pool.query(`ALTER TABLE eval_case_result ADD COLUMN IF NOT EXISTS judge_score     NUMERIC(4,3)`)
  await pool.query(`ALTER TABLE eval_case_result ADD COLUMN IF NOT EXISTS judge_reasoning TEXT`)
  await pool.query(`ALTER TABLE eval_run         ADD COLUMN IF NOT EXISTS avg_judge_score NUMERIC(6,4)`)
  await pool.query(`ALTER TABLE eval_run         ADD COLUMN IF NOT EXISTS judged_count    INT DEFAULT 0`)

  // ─── Notebooks V1（NotebookLM 风格私有工作集） ───────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notebook (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(256) NOT NULL,
      description TEXT,
      owner_email VARCHAR(255) NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notebook_owner ON notebook(owner_email)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notebook_source (
      notebook_id INT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      asset_id    INT NOT NULL REFERENCES metadata_asset(id) ON DELETE CASCADE,
      added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (notebook_id, asset_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notebook_source_asset ON notebook_source(asset_id)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notebook_chat_message (
      id          SERIAL PRIMARY KEY,
      notebook_id INT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      role        VARCHAR(16) NOT NULL,
      content     TEXT NOT NULL,
      citations   JSONB,
      trace       JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notebook_msg_notebook ON notebook_chat_message(notebook_id, id)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notebook_artifact (
      id          SERIAL PRIMARY KEY,
      notebook_id INT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      kind        VARCHAR(32) NOT NULL,
      status      VARCHAR(16) NOT NULL DEFAULT 'pending',
      content     TEXT,
      meta        JSONB,
      error       TEXT,
      created_by  VARCHAR(255),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notebook_artifact_notebook ON notebook_artifact(notebook_id, id DESC)`)

  // ─── Permissions V2: 团队 + 主体多元化 ─────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(128) NOT NULL UNIQUE,
      description TEXT,
      created_by  VARCHAR(255),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_name ON team(name)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_member (
      team_id    INT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
      user_email VARCHAR(255) NOT NULL,
      role       VARCHAR(16) NOT NULL DEFAULT 'member',
      joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      added_by   VARCHAR(255),
      PRIMARY KEY (team_id, user_email)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_member_user ON team_member(user_email)`)

  // metadata_acl_rule 加 subject_type / subject_id / effect / expires_at
  await pool.query(`ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS subject_type VARCHAR(16)`)
  await pool.query(`ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS subject_id   VARCHAR(255)`)
  await pool.query(`ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS effect       VARCHAR(8) DEFAULT 'allow'`)
  await pool.query(`ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ`)
  // 旧规则 backfill：role 非空 → subject_type='role', subject_id=role
  await pool.query(
    `UPDATE metadata_acl_rule
     SET subject_type = 'role', subject_id = role
     WHERE subject_type IS NULL AND role IS NOT NULL`,
  )
  // 全局 NULL role 规则 backfill：subject_type='role', subject_id='*'
  await pool.query(
    `UPDATE metadata_acl_rule
     SET subject_type = 'role', subject_id = '*'
     WHERE subject_type IS NULL AND role IS NULL`,
  )
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acl_subject ON metadata_acl_rule(subject_type, subject_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acl_source  ON metadata_acl_rule(source_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acl_asset   ON metadata_acl_rule(asset_id)`)

  // notebook 共享
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notebook_member (
      notebook_id  INT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
      subject_type VARCHAR(16)  NOT NULL,
      subject_id   VARCHAR(255) NOT NULL,
      role         VARCHAR(16)  NOT NULL DEFAULT 'reader',
      added_by     VARCHAR(255),
      added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (notebook_id, subject_type, subject_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notebook_member_subject ON notebook_member(subject_type, subject_id)`)

  // Permissions V2 · F-3：ACL 规则审计（与既有 audit_log 并行）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS acl_rule_audit (
      id             SERIAL PRIMARY KEY,
      rule_id        INT,
      actor_user_id  INT,
      actor_email    VARCHAR(255),
      op             VARCHAR(8) NOT NULL,
      before_json    JSONB,
      after_json     JSONB,
      at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acl_rule_audit_rule ON acl_rule_audit(rule_id)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acl_rule_audit_at   ON acl_rule_audit(at DESC)`)

  // file-source-integration · 外部文件服务器接入
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_file_source (
      id                    SERIAL PRIMARY KEY,
      type                  VARCHAR(16) NOT NULL CHECK (type IN ('smb','s3','webdav','sftp')),
      name                  VARCHAR(255) NOT NULL,
      config_json           JSONB NOT NULL,
      cron                  VARCHAR(128) NOT NULL DEFAULT '@manual',
      last_cursor           JSONB,
      last_scan_status      VARCHAR(16) CHECK (last_scan_status IN ('ok','partial','error') OR last_scan_status IS NULL),
      last_scan_error       TEXT,
      last_scan_at          TIMESTAMPTZ,
      permission_source_id  INTEGER REFERENCES metadata_source(id) ON DELETE SET NULL,
      enabled               BOOLEAN NOT NULL DEFAULT true,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_file_source_enabled_cron
       ON metadata_file_source(enabled, cron)`,
  )

  await pool.query(`
    CREATE TABLE IF NOT EXISTS file_source_scan_log (
      id            SERIAL PRIMARY KEY,
      source_id     INTEGER NOT NULL REFERENCES metadata_file_source(id) ON DELETE CASCADE,
      started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at   TIMESTAMPTZ,
      status        VARCHAR(16) NOT NULL CHECK (status IN ('running','ok','partial','error')),
      added_count   INT NOT NULL DEFAULT 0,
      updated_count INT NOT NULL DEFAULT 0,
      removed_count INT NOT NULL DEFAULT 0,
      failed_items  JSONB,
      error_message TEXT
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_file_source_scan_log_src_started
       ON file_source_scan_log(source_id, started_at DESC)`,
  )

  // metadata_asset 扩列（external_id 已有；新增 external_path / source_mtime / offline / file_source_id）
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS external_path   TEXT`)
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS source_mtime    TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS offline         BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS file_source_id  INTEGER`)

  // ADR-32 · 2026-04-24 · 提取诊断可见性
  //   extractor_id —— 本次 ingest 用的是哪个 extractor（xlsx / pdf / docx / plaintext / ...）
  //   ingest_warnings —— warnings[] 的 JSON 字符串；若为空数组则 NULL
  //   ingest_chunks_by_kind —— { heading: n, paragraph: n, image_caption: n, ... } 的 JSON
  //                            让 UI 不用 COUNT 聚合就能显示分类切片数
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS extractor_id          VARCHAR(32)`)
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS ingest_warnings       TEXT`)
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS ingest_chunks_by_kind JSONB`)
  // file_source_id FK 分开加，避免重复运行报错
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'metadata_asset_file_source_fk'
      ) THEN
        ALTER TABLE metadata_asset
          ADD CONSTRAINT metadata_asset_file_source_fk
          FOREIGN KEY (file_source_id) REFERENCES metadata_file_source(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `)
  // UPSERT 冲突键（部分唯一索引，只对 file-source 来源生效）
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS metadata_asset_file_source_ext_uniq
      ON metadata_asset (file_source_id, external_id)
      WHERE file_source_id IS NOT NULL
  `)

  // ─── ingest-async-pipeline · 异步 ingest 状态机 ─────────────────────────────
  // design: openspec/changes/ingest-async-pipeline/design.md
  //
  // 1) metadata_asset.ingest_status 粗粒度枚举（queued / in_progress / indexed / failed / cancelled）
  //    已存历史行默认 'indexed'，不破坏 eval / 前端筛选
  // 2) metadata_asset.ingest_error 最近一次失败的错误文本
  // 3) ingest_job 表 —— 异步任务持久化；worker 用 FOR UPDATE SKIP LOCKED 认领
  await pool.query(`
    ALTER TABLE metadata_asset
      ADD COLUMN IF NOT EXISTS ingest_status VARCHAR(16) NOT NULL DEFAULT 'indexed'
  `)
  await pool.query(`ALTER TABLE metadata_asset ADD COLUMN IF NOT EXISTS ingest_error TEXT`)
  // 部分索引：只在未就绪时占用空间（绝大多数 asset 都是 indexed）
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_metadata_asset_ingest_status
      ON metadata_asset(ingest_status)
      WHERE ingest_status <> 'indexed'
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingest_job (
      id                 UUID         PRIMARY KEY,
      asset_id           INTEGER      NULL REFERENCES metadata_asset(id) ON DELETE SET NULL,
      kind               VARCHAR(32)  NOT NULL,
      source_id          INTEGER      NULL,
      name               TEXT         NOT NULL,
      input_payload      JSONB        NOT NULL DEFAULT '{}'::jsonb,
      bytes_ref          TEXT         NULL,
      status             VARCHAR(16)  NOT NULL DEFAULT 'queued',
      progress           SMALLINT     NOT NULL DEFAULT 0,
      phase              VARCHAR(16)  NOT NULL DEFAULT 'pending',
      phase_started_at   TIMESTAMPTZ  NULL,
      error              TEXT         NULL,
      log                JSONB        NOT NULL DEFAULT '[]'::jsonb,
      preview            JSONB        NOT NULL DEFAULT '{}'::jsonb,
      created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      finished_at        TIMESTAMPTZ  NULL,
      created_by         VARCHAR(255) NOT NULL
    )
  `)
  // 部分索引：只在"活跃"状态的行占用空间，worker 认领走 (status, created_at)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ingest_job_status_created
      ON ingest_job(status, created_at)
      WHERE status IN ('queued', 'in_progress')
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ingest_job_created_by
      ON ingest_job(created_by)
  `)

  // ─── space-permissions (ADR 2026-04-23-26) · Space 一级实体 + 成员 + 投影 ACL ───
  await pool.query(`
    CREATE TABLE IF NOT EXISTS space (
      id          SERIAL PRIMARY KEY,
      slug        VARCHAR(128) NOT NULL UNIQUE,
      name        VARCHAR(256) NOT NULL,
      description TEXT,
      visibility  VARCHAR(16) NOT NULL DEFAULT 'org'
                  CHECK (visibility IN ('org','private')),
      owner_email VARCHAR(255) NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_space_owner ON space(owner_email)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS space_member (
      space_id     INT NOT NULL REFERENCES space(id) ON DELETE CASCADE,
      subject_type VARCHAR(16) NOT NULL CHECK (subject_type IN ('user','team')),
      subject_id   VARCHAR(255) NOT NULL,
      role         VARCHAR(16) NOT NULL
                   CHECK (role IN ('owner','admin','editor','viewer')),
      added_by     VARCHAR(255),
      added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (space_id, subject_type, subject_id)
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_space_member_subject
       ON space_member(subject_type, subject_id)`,
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS space_source (
      space_id  INT NOT NULL REFERENCES space(id) ON DELETE CASCADE,
      source_id INT NOT NULL REFERENCES metadata_source(id) ON DELETE CASCADE,
      added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (space_id, source_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_space_source_source ON space_source(source_id)`)
  await pool.query(
    `ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS space_id INT NULL`,
  )
  // space_id FK 分开加（与 file_source_id 同模式，避免重复运行报错）
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'metadata_acl_rule_space_fk'
      ) THEN
        ALTER TABLE metadata_acl_rule
          ADD CONSTRAINT metadata_acl_rule_space_fk
          FOREIGN KEY (space_id) REFERENCES space(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_acl_space ON metadata_acl_rule(space_id)`)

  // action-framework: state machine + audit tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS action_definition (
      name            VARCHAR(64) PRIMARY KEY,
      description     TEXT NOT NULL,
      input_schema    JSONB NOT NULL,
      output_schema   JSONB NOT NULL,
      risk_level      VARCHAR(8) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
      preconditions   JSONB,
      approval_policy JSONB NOT NULL DEFAULT '{"required": false, "approver_roles": ["admin"]}',
      webhook         JSONB,
      enabled         BOOLEAN DEFAULT true,
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS action_run (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_name      VARCHAR(64) NOT NULL REFERENCES action_definition(name),
      actor_id         VARCHAR(64) NOT NULL,
      actor_role       VARCHAR(16) NOT NULL,
      args             JSONB NOT NULL,
      reason           TEXT,
      state            VARCHAR(16) NOT NULL CHECK (state IN ('draft', 'pending', 'approved', 'executing', 'succeeded', 'failed', 'cancelled', 'rejected')),
      attempts         INT DEFAULT 0,
      result           JSONB,
      error            JSONB,
      approver_id      VARCHAR(64),
      approval_note    TEXT,
      cancel_requested BOOLEAN DEFAULT false,
      created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at     TIMESTAMP WITH TIME ZONE
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_action_run_state_time ON action_run(state, created_at DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_action_run_actor_time ON action_run(actor_id, created_at DESC)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS action_audit (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id      UUID NOT NULL REFERENCES action_run(id) ON DELETE CASCADE,
      event       VARCHAR(24) NOT NULL CHECK (event IN ('state_change', 'webhook_sent', 'webhook_failed')),
      before_json JSONB,
      after_json  JSONB,
      actor_id    VARCHAR(64) NOT NULL,
      extra       JSONB,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_action_audit_run_time ON action_audit(run_id, created_at)`)

  // ─── graph-insights · 图谱洞察缓存 + dismiss 状态 ──────────────────────────
  // design: openspec/changes/graph-insights/design.md
  //
  // 1) metadata_graph_insight_cache：按 space 分片的按需计算结果 + TTL/signature 双失效
  // 2) metadata_graph_insight_dismissed：用户关闭洞察跨会话持久化
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_graph_insight_cache (
      space_id         INT         NOT NULL,
      computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ttl_sec          INT         NOT NULL DEFAULT 1800,
      graph_signature  TEXT        NOT NULL,
      payload          JSONB       NOT NULL,
      PRIMARY KEY (space_id)
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mgic_computed_at
      ON metadata_graph_insight_cache(computed_at)
  `)
  // space FK 分开加（与 file_source_id / space_permissions 同模式，避免重复运行报错）
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'metadata_graph_insight_cache_space_fk'
      ) THEN
        ALTER TABLE metadata_graph_insight_cache
          ADD CONSTRAINT metadata_graph_insight_cache_space_fk
          FOREIGN KEY (space_id) REFERENCES space(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata_graph_insight_dismissed (
      user_email   VARCHAR(255) NOT NULL,
      space_id     INT          NOT NULL,
      insight_key  CHAR(64)     NOT NULL,
      dismissed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_email, space_id, insight_key)
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mgid_user_space
      ON metadata_graph_insight_dismissed(user_email, space_id)
  `)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'metadata_graph_insight_dismissed_space_fk'
      ) THEN
        ALTER TABLE metadata_graph_insight_dismissed
          ADD CONSTRAINT metadata_graph_insight_dismissed_space_fk
          FOREIGN KEY (space_id) REFERENCES space(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `)

  // ─── ingest-l0-abstract (ADR-32 候选 · 2026-04-26) ─────────────────────────
  // chunk 级 L0/L1 摘要旁路表，给 RAG 加一层粗筛
  // 只读表的 ANN 检索不会触发写放大；vector 维度跟 metadata_field.embedding 对齐 4096
  // 三个 flag 全关时本表存在但完全不读写（无副作用）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunk_abstract (
      id                SERIAL PRIMARY KEY,
      chunk_id          INT NOT NULL REFERENCES metadata_field(id) ON DELETE CASCADE,
      asset_id          INT NOT NULL REFERENCES metadata_asset(id) ON DELETE CASCADE,
      l0_text           TEXT NOT NULL,
      l0_embedding      vector(4096),
      l1_text           TEXT,
      generator_version VARCHAR(32) NOT NULL DEFAULT 'v1',
      generated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (chunk_id)
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_chunk_abstract_asset ON chunk_abstract(asset_id)`,
  )
  // IVFFLAT 与现有 idx_field_embedding 同型；不用 HNSW 是为了和现有索引保持一致
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunk_abstract_l0_embedding
      ON chunk_abstract USING ivfflat (l0_embedding vector_cosine_ops)
      WITH (lists = 100)
  `).catch(() => {})
  // asset 级聚合视图（调试 / follow-up；本 change 的 RAG 粗筛不依赖此视图）
  await pool.query(`
    CREATE OR REPLACE VIEW asset_abstract AS
    SELECT
      ca.asset_id,
      string_agg(ca.l0_text, ' / ' ORDER BY ca.id) AS l0_summary,
      count(*)::int AS l0_chunk_count,
      max(ca.generated_at) AS latest_generated_at
    FROM chunk_abstract ca
    GROUP BY ca.asset_id
  `)

  // asset-vector-coloc · halfvec 列类型迁移（pgvector ≥ 0.7 解锁；4096-d 存储 −50%）
  // 幂等：已是 halfvec 跳过；版本不足跳过；env PGVECTOR_HALF_PRECISION=false 跳过。
  await migrateToHalfvec(pool)

  await ensureDefaultSource(pool)
  await ensureDefaultAdmin(pool)
  await ensureDefaultAclRules(pool)
}

/**
 * asset-vector-coloc · halfvec 迁移
 *
 * 把 metadata_field.embedding 与 chunk_abstract.l0_embedding 从 vector(4096)
 * 迁到 halfvec(4096)。索引同步从 vector_cosine_ops 重建到 halfvec_cosine_ops。
 *
 * 三层兜底跳过：
 *   1. env `PGVECTOR_HALF_PRECISION` 显式关 → 跳过（兼容老 pgvector 容器）
 *   2. pgvector < 0.7 → halfvec 不可用 → 跳过
 *   3. 列已是 halfvec → 跳过（多次运行幂等）
 *
 * 失败兜底：索引重建失败只 warn，不抛——保证 runPgMigrations() 不被一条迁移卡住启动。
 *
 * 导出供单测断言（halfvecMigration.test.ts）。
 */
export async function migrateToHalfvec(pool: pg.Pool): Promise<void> {
  // 2026-04-27 ADR-44 锁定：默认关。原因——halfvec 在 GM-LIFTGATE32 上实测推 5 题
  // 跌出 top-5（recall@5 1.000 → 0.865，fp16 精度损失把 borderline 分数压下 MIN_SCORE）。
  // 重启前必读 OQ-VEC-QUANT-V2 触发条件；显式 `PGVECTOR_HALF_PRECISION=true` 才生效。
  const flagRaw = (process.env.PGVECTOR_HALF_PRECISION ?? 'false').toLowerCase().trim()
  const flagOn = flagRaw === 'true' || flagRaw === '1' || flagRaw === 'on' || flagRaw === 'yes'
  if (!flagOn) {
    // 默认路径：不打印 warn，避免每次启动刷日志（这是默认期望行为，不是异常）
    return
  }

  // 1. pgvector 版本探测
  const { rows: vrows } = await pool.query(
    `SELECT extversion FROM pg_extension WHERE extname='vector'`,
  )
  const ver = String(vrows[0]?.extversion ?? '0.0.0')
  const [maj, min] = ver.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const okVersion = maj > 0 || (maj === 0 && min >= 7)
  if (!okVersion) {
    // eslint-disable-next-line no-console
    console.warn(`[pgDb] pgvector ${ver} < 0.7 → halfvec 不可用，跳过迁移`)
    return
  }

  // 2. 列类型探测（format_type 返回 'vector(4096)' / 'halfvec(4096)' 这类字面量）
  type ColInfo = { table: string; column: string; current: string }
  const { rows: probe } = await pool.query(
    `SELECT c.relname AS table_name,
            a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS type_text
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema()
       AND ((c.relname = 'metadata_field' AND a.attname = 'embedding')
         OR (c.relname = 'chunk_abstract' AND a.attname = 'l0_embedding'))
       AND a.attnum > 0`,
  )
  const targets: ColInfo[] = probe.map((r) => ({
    table: String(r.table_name),
    column: String(r.column_name),
    current: String(r.type_text),
  }))

  // 3. 逐列迁移（仅 vector → halfvec；其它类型一律跳过 + warn）
  for (const t of targets) {
    if (t.current.startsWith('halfvec')) continue
    if (!t.current.startsWith('vector')) {
      // eslint-disable-next-line no-console
      console.warn(`[pgDb] ${t.table}.${t.column} 类型 ${t.current} 非预期，跳过`)
      continue
    }
    // eslint-disable-next-line no-console
    console.log(`[pgDb] 迁移 ${t.table}.${t.column}: ${t.current} → halfvec(4096)`)
    await pool.query(
      `ALTER TABLE ${t.table}
         ALTER COLUMN ${t.column} TYPE halfvec(4096)
         USING ${t.column}::halfvec(4096)`,
    )
  }

  // 4. 索引重建：旧索引在 ALTER COLUMN 后 operator class 不匹配，必须 DROP 重建
  await pool.query(`DROP INDEX IF EXISTS idx_field_embedding`).catch(() => {})
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_field_embedding
      ON metadata_field USING ivfflat (embedding halfvec_cosine_ops)
      WITH (lists = 100)
  `).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn(`[pgDb] idx_field_embedding 重建失败：${(e as Error).message}`)
  })

  await pool.query(`DROP INDEX IF EXISTS idx_chunk_abstract_l0_embedding`).catch(() => {})
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunk_abstract_l0_embedding
      ON chunk_abstract USING ivfflat (l0_embedding halfvec_cosine_ops)
      WITH (lists = 100)
  `).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn(`[pgDb] idx_chunk_abstract_l0_embedding 重建失败：${(e as Error).message}`)
  })
}

async function ensureDefaultAdmin(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users`)
  if (Number(rows[0].n) > 0) return
  const email = 'admin@dsclaw.local'
  const pw = 'admin123'
  const hash = await hashPassword(pw)
  await pool.query(
    `INSERT INTO users (email, password_hash, roles) VALUES ($1, $2, $3::jsonb)`,
    [email, hash, JSON.stringify(['admin'])],
  )
  // eslint-disable-next-line no-console
  console.warn(
    `⚠ 默认管理员已创建: ${email} / ${pw}  —— 生产部署前请通过 POST /api/auth/password 修改`,
  )
}

/**
 * ensureDefaultAclRules —— 幂等 seed metadata_acl_rule 兜底规则
 *
 * 背景：evaluateAcl 在表为空时按 "no matching rule" deny，导致所有走
 * `enforceAcl({action:'READ'/'WRITE'})` 的端点（governance/qa/agent/ingest scan-folder 等）
 * 全员 403，包括 admin。
 *
 * Seed 策略（PRD §2.3 角色 → 权限映射的字段级镜像）：
 *   - viewer/editor/admin 全员 READ
 *   - editor/admin       WRITE
 *   - admin              ADMIN（超集）
 *
 * 通过 (role, permission) 唯一性判定是否已 seed；用户后续可在 IAM 面板覆盖。
 */
/**
 * V2 Seed（严格模式 B · R-1 双轨）：
 *   - 新装 DB（metadata_acl_rule 全空）：只下发 admin READ/WRITE/ADMIN；不再下发 `* READ`。
 *   - 升级 DB（已有老 `subject_id='*'` + `permission='READ'`）：
 *       * 保留老行不覆写（升级不炸业务）
 *       * 启动日志 WARN 一次，提醒 admin 去 /iam?tab=rules 手动收紧
 *   - 任何场景下：若 admin READ/WRITE/ADMIN 缺失则补齐（幂等）
 *
 * 见 openspec/changes/permissions-v2/specs/acl-v2-spec.md · R-1 双轨种子
 */

// 模块级 flag，保证 WARN 在同一进程生命周期内只打一次（幂等 + 不刷屏）
let _warnedLegacyStarRead = false
/** 测试辅助：重置 WARN 状态，便于多条测试覆盖 */
export function __resetSeedWarnForTest(): void {
  _warnedLegacyStarRead = false
}

export async function ensureDefaultAclRules(pool: pg.Pool): Promise<void> {
  const seeds: Array<{ permission: string }> = [
    { permission: 'READ' },
    { permission: 'WRITE' },
    { permission: 'ADMIN' },
  ]
  for (const s of seeds) {
    const { rows } = await pool.query(
      `SELECT 1 FROM metadata_acl_rule
       WHERE source_id IS NULL AND asset_id IS NULL
         AND subject_type = 'role' AND subject_id = 'admin'
         AND permission = $1
       LIMIT 1`,
      [s.permission],
    )
    if (rows.length > 0) continue
    await pool.query(
      `INSERT INTO metadata_acl_rule
         (source_id, asset_id, role, permission, subject_type, subject_id, effect)
       VALUES (NULL, NULL, 'admin', $1, 'role', 'admin', 'allow')`,
      [s.permission],
    )
    // eslint-disable-next-line no-console
    console.log(`✓ seed metadata_acl_rule: admin ${s.permission}`)
  }

  // R-1：升级 DB 检测 —— 只在发现老全局 READ 行时 WARN 一次
  if (!_warnedLegacyStarRead) {
    const { rows: legacy } = await pool.query(
      `SELECT id FROM metadata_acl_rule
       WHERE source_id IS NULL AND asset_id IS NULL
         AND subject_id = '*' AND permission = 'READ'
       LIMIT 1`,
    )
    if (legacy.length > 0) {
      _warnedLegacyStarRead = true
      // eslint-disable-next-line no-console
      console.warn(
        `[acl] 检测到旧全局 READ seed (rule id=${legacy[0].id})；` +
        `V2 严格种子默认不再下发 * READ。建议去 /iam?tab=rules 手动收紧。`,
      )
    }
  }
}

async function ensureDefaultSource(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id FROM metadata_source WHERE connector = 'bookstack' LIMIT 1`
  )
  if (rows.length > 0) return
  await pool.query(
    `INSERT INTO metadata_source (name, type, connector, status)
     VALUES ($1, $2, $3, $4)`,
    ['BookStack 知识库', 'document', 'bookstack', 'active']
  )
}
