-- N-007 公共模板池：把 N-006 硬编码的 6 个内置模板从 services/notebookTemplates.ts
-- 常量迁到 DB 表 notebook_template。加 source 字段（system / community / user）作为
-- N-008 用户自定义模板的 schema 基座。
--
-- 注意：本仓库实际 schema bootstrap 走 services/pgDb.ts 的 runPgMigrations()
-- inline DDL，本 SQL 文件用作设计审查与人工 SQL 备份；inline 版本必须与本文件保持
-- 一致（见 services/pgDb.ts notebook_template 段）。

CREATE TABLE IF NOT EXISTS notebook_template (
  id                          SERIAL PRIMARY KEY,
  template_key                TEXT NOT NULL UNIQUE,
  source                      TEXT NOT NULL CHECK (source IN ('system', 'community', 'user')),
  owner_user_id               INT REFERENCES users(id) ON DELETE CASCADE,
  label                       TEXT NOT NULL,
  icon                        TEXT NOT NULL,
  description                 TEXT NOT NULL,
  recommended_source_hint     TEXT NOT NULL,
  recommended_artifact_kinds  JSONB NOT NULL DEFAULT '[]'::jsonb,
  starter_questions           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 列出可见模板时按 source / owner 过滤
CREATE INDEX IF NOT EXISTS idx_notebook_template_source_owner
  ON notebook_template (source, owner_user_id);

-- user 模板必须有 owner_user_id；system / community 不能有 owner（避免脏数据）
ALTER TABLE notebook_template DROP CONSTRAINT IF EXISTS chk_notebook_template_owner;
ALTER TABLE notebook_template ADD CONSTRAINT chk_notebook_template_owner
  CHECK ((source = 'user' AND owner_user_id IS NOT NULL)
       OR (source IN ('system','community') AND owner_user_id IS NULL));
