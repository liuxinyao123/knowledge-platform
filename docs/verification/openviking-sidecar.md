# OpenViking Sidecar — 验收手册

> 配套 `docs/superpowers/specs/openviking-sidecar/` 与 `docs/superpowers/plans/openviking-sidecar-impl-plan.md`。
> 目的：手动跑过这 6 个用例，给"方案 A 是否可用"打一个 PASS/FAIL。

---

## 准备

```bash
# 确保 infra/.env 里有硅基 key
grep EMBEDDING_API_KEY infra/.env

# 启用 viking profile（compose 用 profiles 控制是否拉这个容器）
export VIKING_ENABLED=1
docker compose -f infra/docker-compose.yml --profile viking up -d openviking
docker compose -f infra/docker-compose.yml ps openviking
```

预期：openviking 容器 status 应在 30s 内变成 `healthy`。

如果一直是 `starting` 或 `unhealthy`：
```bash
docker logs openviking --tail 80
```
常见原因：`pip install openviking` 镜像内没装好（重新 build）；或硅基 key 没注入（检查 `OPENAI_API_KEY` 环境变量打印）。

---

## 用例 1 · 健康检查

```bash
curl -fsS http://localhost:1933/healthz
```

预期：`{"ok": true, ...}` 或 200。

## 用例 2 · 5 步烟测脚本

```bash
node scripts/verify-viking.mjs
```

预期输出末行：
```
=== all 5 checks passed ===
```

任一步失败：
- health 失败 → 容器没起好，回去看 `docker logs openviking`
- write 失败 → 看响应体，多半是 LLM key 不通（OpenViking 写入会调 LLM 生成 L0/L1）
- find 失败 → write 成功但向量检索没召回，可能是嵌入模型参数没生效
- read 失败 → 写入时实际没落盘，看挂卷权限（`./openviking_data` 是不是 1933 用户可写）

## 用例 3 · qa-service 集成（disabled）

```bash
# 关掉 viking
unset VIKING_ENABLED

pnpm dev:up
# 前端打开 http://localhost:5173，发起一次 QA
```

预期：
- `pnpm dev:logs | grep viking` 几乎无输出（最多一行 startup health check）
- SSE 流里**没有** `viking_step` 事件
- RAG 召回 / 答案 与未引入 viking 时**完全一致**

## 用例 4 · qa-service 集成（enabled）

```bash
export VIKING_ENABLED=1
docker compose -f infra/docker-compose.yml --profile viking up -d openviking
pnpm dev:down && pnpm dev:up

# 同一 session 连问 3 次相关问题，例如：
#   1) "什么是 BookStack 的 Shelf？"
#   2) "Shelf 和 Book 是什么关系？"
#   3) "刚才说的那个层级关系，对应数据库里哪张表？"
```

预期：
- 每次 QA 的 SSE 流里至少有 1 个 `viking_step` 事件 (`stage: 'recall'`)
- 第 2、3 次的 recall `count` ≥ 1（前面的 QA 已经写进 viking 里了）
- 第 3 次回答里能体现"刚才说的那个"指代正确——证明 recall 注入起了作用
- save 阶段：每次结束前看到 `viking_step stage: 'save', count: 1, uri: viking://user/.../...`

## 用例 5 · 降级（容器关掉，flag 仍开）

```bash
# 模拟 viking 挂了
docker compose -f infra/docker-compose.yml stop openviking

# qa-service 仍开着 VIKING_ENABLED=1，再发一次 QA
```

预期：
- QA 仍能正常返回答案
- qa-service 日志里看到一条 `[viking]` warn（每分钟最多一次，不刷屏）
- SSE 流里 `viking_step recall count=0`（命中 0 不抛）
- 没有 `viking_step save`（写入失败被吞）

## 用例 6 · 召回率回归（不退化）

```bash
# 先在 disabled 下跑一次 baseline
unset VIKING_ENABLED
node scripts/eval-recall.mjs --dataset eval/gm-liftgate32-v2.jsonl --out /tmp/eval-baseline.json

# 再在 enabled 下跑一次（principal 用脚本默认）
export VIKING_ENABLED=1
node scripts/eval-recall.mjs --dataset eval/gm-liftgate32-v2.jsonl --out /tmp/eval-viking.json

# 对比
diff <(jq '.summary' /tmp/eval-baseline.json) <(jq '.summary' /tmp/eval-viking.json)
```

预期：
- recall@10 / mrr / ndcg 不退化超过 5 个百分点
- 如果**显著退化**，说明 recall 注入污染了 RAG context → 立刻关 flag，方案 A 阶段性不通过

---

## 验收结论模板

```
date: 2026-04-XX
operator: <name>

[PASS/FAIL] 用例 1 健康检查
[PASS/FAIL] 用例 2 五步烟测
[PASS/FAIL] 用例 3 disabled 行为不变
[PASS/FAIL] 用例 4 enabled 跨问指代命中
[PASS/FAIL] 用例 5 容器挂掉降级
[PASS/FAIL] 用例 6 召回率不退化（baseline=X, viking=Y）

最终：[PASS/FAIL]
后续动作：[继续推方案 B / 维持现状不上 main / ...]
```

把这份结论贴到 `.superpowers-memory/decisions/2026-04-26-31-openviking-sidecar-experiment.md` 末尾即可。

---
