#!/usr/bin/env node
/**
 * regen-tags.mjs
 *
 * 把数据库里所有 metadata_asset 的 tags 用最新版 tagExtract 重新生成一遍。
 * 用于清理之前因 sanitize bug 留下的脏标签（"Body Side C / [Liftgate"] / limp alpha $ 等）。
 *
 * 用法：
 *   node scripts/regen-tags.mjs              # dry-run，只打印将做什么
 *   node scripts/regen-tags.mjs --confirm    # 真跑
 *
 * 怎么工作：
 *   1. 走后端 /api/asset-directory/pg-assets 列出所有 asset_id
 *   2. 对每个 asset，从 metadata_field（chunk_level=3）拼前 4000 字
 *   3. 调内部 LLM extract（这里直接 SQL 不行，借用一个新的小端点）—
 *      （所以脚本本身不能直接用，需要新加 admin 端点；保留为模板，后面接 API 即可）
 *
 * 实际：要么走 admin 端点重新触发 ingest/index 任务；要么 SQL 直接清空旧 tags 让 search 不被脏值污染。
 *
 * 当前最实用的做法 —— 直接跑下面的 SQL 把脏 tags 清空（reset 为空数组）：
 */

console.log(`
要把已入库 asset 的旧脏 tags 清空，最快的办法是直接跑 SQL：

  docker exec -i pg_db psql -U knowledge -d knowledge -c \\
    "UPDATE metadata_asset SET tags = '{}'::text[] WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;"

  这样 /governance 标签体系页会变空（暂时），但 hover 资产卡的"标签"也会消失。

要让标签重新生成，目前最干净的办法是：
  1. 用 cleanup-data.sh 删掉所有 asset
  2. 重新通过 /ingest 上传 PDF
  这次 tagExtract 用的是修过的 sanitize，标签会正常。

未来 V1.1 加一个 admin 端点 POST /api/asset-directory/pg-assets/:id/regen-tags
触发单 asset 重提取，就不用全删重传了。
`)
