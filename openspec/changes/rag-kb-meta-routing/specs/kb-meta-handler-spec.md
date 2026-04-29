# Spec · kbMetaHandler

> 模块：`apps/qa-service/src/services/kbMetaHandler.ts`
> 上游：D-002 答案意图分类（kb_meta 枚举）+ D-003 评测集
> 下游：D-002.4 资产细粒度 filter（按 asset_type / ingest_status）

## ADDED Requirements

### isObviousKbMeta

```ts
export function isObviousKbMeta(question: string): boolean
```

**输入**：用户原始问题（不做归一化由调用方负责）。

**输出**：boolean。`true` 表示问题强烈指向"问目录"语义，应当绕过 retrieval 直接走 kbMetaHandler。

**判定规则**（满足任一）：

1. 中文目录前缀 + 文档名词同时出现，例：
   - "库里有 X 吗" / "知识库里有没有 X" / "我这库里包含 X 吗"
   - "有哪些 [doc 词] 资料" / "列出 X 文档" / "找一下 X 文件"
2. 英文：`(list|find|search|show me) ... (documents?|files?|assets?)` / `(do you have|is there|are there) ... (documents?|files?) (on|about) X`

**禁止误判**：
- "X 的核心模块有哪些" → false（问对象属性，不是问目录）
- "X 是谁" / "X 在哪" / "X 的作者" → false（factual_lookup）
- "翻译这段" / "总结一下" → false（language_op）

**实现要求**：
- 双锚定正则（目录前缀 + 文档名词），不能单锚定
- bias to false：宁可漏判也不抢正常 RAG case
- 单元测试 ≥ 14 case（≥ 8 命中 + ≥ 6 不误伤）

### extractKbMetaKeywords

```ts
export function extractKbMetaKeywords(question: string): string[]
```

**输入**：已经 isObviousKbMeta=true 的问题。

**输出**：1-3 个关键词字符串数组（用于 SQL `name ILIKE '%kw%'`）。空数组表示"列全部"（如"列出所有文档"）。

**抽取规则**：
- 去掉目录前缀词："库里有"/"知识库"/"列出"/"找一下"/"有哪些"
- 去掉句末助词："吗"/"？"/"\?"/"的资料"/"的文档"
- 去掉常见停用词："的"/"是"/"个"/"些"
- 剩余词按"长度倒序" + 长度 ≥ 2 → top 3

### queryAssetCatalog

```ts
export interface AssetCatalogRow {
  id: number
  name: string
  type: string | null
  indexed_at: string | null
  tags: unknown
}

export async function queryAssetCatalog(opts: {
  keywords: string[]
  sourceIds?: number[]   // ACL filter
  limit?: number          // 默认 50
}): Promise<AssetCatalogRow[]>
```

**SQL 形状**（PostgreSQL）：

```sql
SELECT id, name, type, indexed_at, tags
FROM metadata_asset
WHERE
  ($keywords::text[] IS NULL OR (
    name ILIKE ANY (SELECT '%' || k || '%' FROM unnest($keywords::text[]) AS k)
  ))
  AND ($sourceIds::int[] IS NULL OR source_id = ANY($sourceIds::int[]))
ORDER BY indexed_at DESC NULLS LAST, id DESC
LIMIT $limit
```

**行为**：
- `keywords` 为空 → 不加 name 过滤，返回全部（按时间倒序）
- `sourceIds` 为空 → 不加 ACL 过滤
- 永远不抛异常：DB 错抓后返回 `[]` + 由调用方 emit warn

### renderKbMetaAnswer

```ts
export async function renderKbMetaAnswer(opts: {
  question: string
  candidates: AssetCatalogRow[]
  signal: AbortSignal
}): Promise<string>
```

**行为**：
- `candidates.length === 0` → 直接返回 "知识库里似乎没有相关的资料。建议在「资产目录」里用关键词搜索，或上传相关文档。"
- `candidates.length ≤ 10` → fast LLM 包装："找到以下 N 个相关文档：\n· [name1.ext]（type · 上次入库 YYYY-MM-DD）\n· ..." + 引导语
- `candidates.length > 10` → 先 fast LLM 在 candidates 上做语义筛（输出 ≤ 8 条），再包装

**LLM 失败 / abort 兜底**：直接拼 markdown 列表，不阻塞。

**输出格式硬性要求**：
- 必须出现 `(\.pdf|\.xlsx|\.md|\.pptx|\.docx)` 后缀（D-003 评测器要）
- 必须含"找到以下"/"以下文档"/"建议查阅" 之一引导词

### runKbMetaHandler

```ts
export async function runKbMetaHandler(
  question: string,
  emit: EmitFn,
  signal: AbortSignal,
  opts?: { sourceIds?: number[]; trace?: RagTrace },
): Promise<void>
```

**编排**：
1. emit `{type:'rag_step', icon:'📚', label:'kb_meta · 直查 metadata_asset 目录'}`
2. extractKbMetaKeywords → emit `{type:'rag_step', icon:'🔑', label:'关键词: ...'}`（VERBOSE）
3. queryAssetCatalog → emit `{type:'rag_step', icon:'📋', label:'命中 N 个候选'}`
4. renderKbMetaAnswer → emit `{type:'rag_step', icon:'🎭', label:'答案意图分类 → kb_meta（rule:short-circuit / handler:catalog）'}`（保持评测器兼容）
5. emit content（一次性整段输出，不分块）
6. emit `{type:'trace', data: trace}` —— citations 留空数组
7. emit `{type:'done'}`

**失败处理**：
- DB / LLM 失败 → emit error + done，不让用户看空白
- abort signal → 立即停，不 emit done

### Env: KB_META_HANDLER_ENABLED

- 默认 `true`
- `false` → `isObviousKbMeta` 永返 false（顶层不短路）+ generateAnswer 内 kb_meta 路径回退到 buildKbMetaPrompt + 普通 LLM 流
- 用于回滚 / A/B 对比

### ragPipeline 接入点

- **runRagPipeline** 第 658-682 行之间（数据管理员检测后，condenseQuestion 之前）：
  ```ts
  if (isKbMetaHandlerEnabled() && isObviousKbMeta(question)) {
    await runKbMetaHandler(question, emit, signal, { sourceIds: opts.sourceIds })
    return
  }
  ```
- **generateAnswer** 第 514-528 行之后，buildSystemPromptByIntent 之前：
  ```ts
  if (isKbMetaHandlerEnabled() && intent === 'kb_meta') {
    await runKbMetaHandler(question, emit, signal, { sourceIds: opts.sourceIds, docs })
    return  // 跳过 chatStream
  }
  ```

## Test coverage minimum

| Test name | Assertions |
|---|---|
| isObviousKbMeta · 命中 | "我这库里有道德经吗" / "库里有 LFTGATE 吗" / "列出所有 pdf" / "find documents about cars" / "有哪些汽车工程相关的资料" + 3 more = 8 case 全 true |
| isObviousKbMeta · 不误伤 | "知识中台的核心模块有哪些" / "道德经的作者是谁" / "LFTGATE 的间隙参数" / "翻译第一章" / "总结要点" / "为什么作者这么写" = 6 case 全 false |
| extractKbMetaKeywords · 提取 | "我这库里有道德经吗" → ["道德经"]；"列出汽车工程相关的资料" → ["汽车工程"]；"列出所有 pdf" → []（无关键词只剩类型） |
| queryAssetCatalog · 关键词为空 | 不加 name filter，按 indexed_at DESC 返回 |
| queryAssetCatalog · 关键词非空 | 生成 ILIKE ANY (SELECT '%' \|\| k \|\| '%' FROM unnest(...) ...) |
| renderKbMetaAnswer · 0 候选 | "似乎没有相关的资料" + "建议在「资产目录」" |
| renderKbMetaAnswer · ≤ 10 候选 | 含 ".pdf"/".md" 后缀 + "找到以下" 引导 + bullet 列表 |
| renderKbMetaAnswer · LLM 失败兜底 | LLM throw → 退化纯 markdown 列表，仍含后缀 + 引导 |
