# Spec: chunk-hygiene（C + D · 共享 textHygiene）

## services/textHygiene.ts（新文件）

**Scenario: looksLikeOcrFragment 识别 emoji**
- Given `looksLikeOcrFragment('🎯 foo')` → `true`
- Given `looksLikeOcrFragment('foo bar baz')` → `false`

**Scenario: 识别裸引号**
- Given `looksLikeOcrFragment('alpha " beta')` → `true`
- Given `looksLikeOcrFragment('"quoted all"')` → `true`（含裸引号也判为碎片）

**Scenario: 识别单字符堆叠（"g g g" 型）**
- Given `looksLikeOcrFragment('g g g')` → `true`
- Given `looksLikeOcrFragment('G G G D')` → `true`
- Given `looksLikeOcrFragment('GG DD FF')` → `false`（两字符 token 不算单字符）

**Scenario: 正常短语不误杀**
- Given `looksLikeOcrFragment('知识图谱')` → `false`
- Given `looksLikeOcrFragment('machine learning')` → `false`
- Given `looksLikeOcrFragment('RAG pipeline')` → `false`

## looksLikeErrorJsonBlob

**Scenario: 识别 type error**
- Given `looksLikeErrorJsonBlob('{"type":"error","error":{"message":"boom"}}')` → `true`

**Scenario: 识别 not_found_error / File not found**
- Given `looksLikeErrorJsonBlob('some prefix {"error":{"type":"not_found_error"}}')` — 但不以 `{` 开头 → `false`（**严格只看顶层 JSON**）
- Given `looksLikeErrorJsonBlob('{"error":{"type":"not_found_error"}}')` → `true`
- Given `looksLikeErrorJsonBlob('{"msg":"File not found in container: /tmp/foo"}')` → `true`

**Scenario: 正常 JSON 不误伤**
- Given `looksLikeErrorJsonBlob('{"status":"ok","data":[]}')` → `false`
- Given `looksLikeErrorJsonBlob('{"error":"validation_failed"}')` → `false`（string 类型 error 不算；只抓 error:{} object）

**Scenario: 空 / 非对象**
- Given `looksLikeErrorJsonBlob('')` / `looksLikeErrorJsonBlob('plain text')` → `false`

## isBadChunk

**Scenario: 太短 → bad**
- Given `isBadChunk('abc')` → `{ bad: true, reason: 'too_short' }`
- Given `isBadChunk('   abc   ')` → `{ bad: true, reason: 'too_short' }`（trim 后看长度）

**Scenario: error JSON → bad**
- Given `isBadChunk('{"type":"error","error":{"message":"File not found in container: /mnt/..."}}')` → `{ bad: true, reason: 'error_json_blob' }`

**Scenario: OCR 碎片 → bad**
- Given `isBadChunk('BumperOrallyD G G G')` → `{ bad: true, reason: 'ocr_fragment' }`

**Scenario: 正常正文 → ok**
- Given `isBadChunk('知识图谱是一种语义网络，用节点表示实体...')` → `{ bad: false }`

**Scenario: 优先级 — too_short 最先判**
- Given `isBadChunk('🎯')` —— 含 emoji 且 < 20 字符
- Then 返 `{ bad: true, reason: 'too_short' }`（短的先判；若长度 ≥20 才检查 OCR）

## ingest pipeline · chunk gate（C）

**Scenario: L3 短 chunk 被过滤**
- Given ingest 产生一个 L3 chunk content = "OK"（长度 2）
- When 写 metadata_field
- Then 这条不 INSERT；日志含 `filtered ... too_short: 1`

**Scenario: L3 OCR 碎片被过滤**
- Given ingest 产生 L3 chunk content = "g g g g g"
- Then 不 INSERT；reason='ocr_fragment'

**Scenario: L3 error JSON 被过滤**
- Given chunk content = `{"type":"error", ...}`
- Then 不 INSERT；reason='error_json_blob'

**Scenario: L1 顶层 chunk 不过滤**
- Given L1 chunk content = "目录"（短）
- Then 仍 INSERT（L1 不过 gate）

**Scenario: 正常 L3 chunk 不受影响**
- Given L3 chunk content = 正常长正文段
- Then 照常 embed + INSERT

## tagExtract 兼容性（不能回归 BUG-14）

**Scenario: tagExtract 依赖 textHygiene 的同一个 looksLikeOcrFragment**
- Given `tagExtract.ts` import 自 `textHygiene.ts`
- Then `looksLikeOcrFragment` 在 `tagExtract.cleanOne` 里的行为与批 D 修复后一致
- And 老的 tagExtract 单测（pgDb seed 路径的 BUG-14 覆盖）仍然绿

## 一次性清库脚本（D）

**Scenario: dry-run 默认不删**
- When `bash scripts/cleanup-bad-chunks.sh`
- Then 只输出 SELECT 报告：`reason | rows | assets`
- And `metadata_field` 行数不变

**Scenario: --confirm 才 DELETE**
- When `bash scripts/cleanup-bad-chunks.sh --confirm`
- Then 删除 `chunk_level=3` 且满足"太短 / error JSON"的行
- And 终端输出 `'done'`

**Scenario: OCR 碎片需要 Node 辅助脚本**
- Given `scripts/cleanup-bad-chunks-ocr.mjs`
- When 默认 dry-run
- Then 连 PG → for each chunk 跑 `isBadChunk` → 只打印命中报告
- And `--confirm` 才 DELETE；和 bash 脚本共享同一个 `isBadChunk` 逻辑

**Scenario: 脚本不自动重 embed**
- 删除后 embedding 列同步消失；受影响 asset 需手工 `POST /api/ingest/upload-full` 重入或后续批处理
- 脚本只输出"删除了 X 行，涉及 Y 个 asset，请重新入库"提示，不代理触发
