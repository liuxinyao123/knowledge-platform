# Spec: relevance-score-display（A + B）

## formatRelevanceScore 纯函数

**Scenario: 高相关分数用两位小数**
- Given `formatRelevanceScore(0.9996)`
- Then 返回 `'1.00'`（四舍五入）
- Given `formatRelevanceScore(0.75)`
- Then 返回 `'0.75'`

**Scenario: 中相关分数用三位小数**
- Given `formatRelevanceScore(0.049)`
- Then 返回 `'0.049'`
- Given `formatRelevanceScore(0.1)`
- Then 返回 `'0.100'`

**Scenario: 极低分数用科学记数**
- Given `formatRelevanceScore(0.0000166)`
- Then 返回 `'1.66e-5'`
- Given `formatRelevanceScore(0.009)`
- Then 返回 `'9.00e-3'`

**Scenario: 边界 0**
- Given `formatRelevanceScore(0)`
- Then 返回 `'0.00e+0'`（科学记数保留统一格式）

**Scenario: 非数字**
- Given `formatRelevanceScore(NaN)` / `formatRelevanceScore(undefined)` / `formatRelevanceScore(Infinity)`
- Then 返回 `'—'`

## Reranker rag_step label（A）

**Scenario: label 带 top-5 分桶分数**
- Given rerank 返回 [0.99, 0.5, 0.08, 0.003, 1e-6]
- Then emit 的 label 包含 `'1.00 / 0.50 / 0.080 / 3.00e-3 / 1.00e-6'`

**Scenario: label 仍是 rag_step 结构**
- emit 的事件 `{ type: 'rag_step', icon: '✨', label: '...' }` 结构不变
- 前端不改代码也能正常渲染（只是显示字符换了）

## 相关性阈值 WARN（B）

**Scenario: top-1 < 0.1 触发 WARN**
- Given rerank 返回 top-1 = 0.049
- Then emit 一个额外 `rag_step`：`{ icon: '⚠️', label: '检索结果相关性极低（top-1 = 0.049）...' }`
- And 主流程继续（不打断 content / done）

**Scenario: top-1 ≥ 0.1 不触发**
- Given rerank 返回 top-1 = 0.15
- Then 不 emit WARN

**Scenario: 阈值可被环境变量覆盖**
- Given `RAG_RELEVANCE_WARN_THRESHOLD=0.3`
- And top-1 = 0.2
- Then 触发 WARN

**Scenario: 阈值环境变量非法时 fallback 到 0.1**
- Given `RAG_RELEVANCE_WARN_THRESHOLD=abc`
- Then 使用默认 0.1
