# Tasks: RAG Intent Routing（档 B 第 2 步 · OpenSpec Lock 同步任务清单）

> 倒推说明：本 tasks.md 在代码已实施后倒推记录；所有 ✅ 任务的实际产物都已存在仓库
> （详见 `docs/superpowers/plans/rag-intent-routing-impl-plan.md` 的 commit/path
> 对照表）。Archive 阶段（B-4）等用户实测验证通过后再做。

## 后端（apps/qa-service）

### 类型与接口
- [x] BE-1：新建 `src/services/answerIntent.ts` —— `AnswerIntent` 枚举（5 类）/
      `ANSWER_INTENTS` / `isAnswerIntent` / `IntentClassification` interface /
      `isHandlerRoutingEnabled` env 探测 / `classifyAnswerIntent` 主函数
- [x] BE-2：classifier 用 fast LLM + tool calling 强制结构化输出
      （`tool_choice = {type:'function', function:{name:'classify_answer_intent'}}`）
- [x] BE-3：classifier 任何失败回落 `factual_lookup` + `fallback=true`：
      env 关 / LLM 未配置 / 空问题 / tool 无返回 / 非法 intent / LLM 异常 / 1.5s 超时

### Prompt 模板
- [x] BE-4：新建 `src/services/answerPrompts.ts` —— `buildSystemPromptByIntent(intent, context, inlineImageRule?)` 主函数 + 5 个内部模板
- [x] BE-5：5 模板共享 `COMMON_OUTPUT_FORMAT` 常量（verbatim 数字 + 引用 [N] +
      不写"以上信息来源于"）
- [x] BE-6：inline image 规则（ADR-45）按需拼到 factual_lookup / language_op /
      multi_doc_compare；kb_meta / out_of_scope 不拼
- [x] BE-7：5 模板首句声明 `'你是知识库助手 · **<模式名>**'`，便于 LLM 一眼锁定
- [x] BE-8：language_op 模板含"必须执行"+ "不能拒答"+ "透明度声明"三条关键约束
- [x] BE-9：multi_doc_compare 模板含"结构化分项"+ "不漏组件"+ "同维度对齐"
- [x] BE-10：kb_meta 模板含"只列 asset_name"+ "不进文档内容"+ "不加 [N] 引用"
- [x] BE-11：out_of_scope 模板含"知识库中没有"+ "不要凭外部知识回答"+ "不要发挥"

### 顶层 agent classifier 边界修正（V-3 实测追加）
- [x] BE-A1：`agent/intentClassifier.ts` SYSTEM_PROMPT 修订：
      knowledge_qa **包含**翻译/解释/总结/释义/改写/提炼/白话/列表化等元指令；
      metadata_ops **仅限**元数据 CRUD（删除资产/修改 ACL/重命名等）
- [x] BE-A2：加 5 条边界对比例子（翻译 → knowledge_qa / 删除资产 → metadata_ops 等）

### ragPipeline 接入
- [x] BE-12：`services/ragPipeline.ts` import 新模块（`classifyAnswerIntent /
      isHandlerRoutingEnabled / buildSystemPromptByIntent`）
- [x] BE-13：`generateAnswer` 在 `inlineImageRule` 之后、`chatStream` 之前加意图
      分类 + 模板选择
- [x] BE-14：`generateAnswer` 仅在 `hasWeb = false` 时调 classifier；hasWeb=true
      保留原有 web prompt 不动
- [x] BE-15：emit `rag_step` icon=`🎭` label=`'答案意图分类 → <intent>（<reason>）'`
      （仅 fallback=false 时 emit）
- [x] BE-16：`systemPromptOverride` 优先级最高，传入时跳过 classifier（向后兼容）
- [x] BE-17：删除 `generateAnswer` 的 monolithic `defaultSystem` 常量 + 旧示例 1-3
      + 旧"作答步骤"段（被新模板取代）
- [x] BE-18：删除上一版 D 加的"语言层例外"条款（语义已被 language_op 模板内化）

### 配置
- [x] BE-19：`apps/qa-service/.env.example` 加 `B_HANDLER_ROUTING_ENABLED=true`
      段落，含中文说明 + 默认值 + 关闭值

### 测试
- [x] BE-20：`src/__tests__/answerIntent.test.ts` —— 17 个 vitest 用例覆盖：
      isAnswerIntent / isHandlerRoutingEnabled / classifyAnswerIntent 全部场景
      （env / LLM 未配 / 空问题 / tool 无返回 / 非法 intent / 异常 / 5 类正确返回 /
       prompt 含 question + 前 3 段 preview）
- [x] BE-21：`src/__tests__/answerPrompts.test.ts` —— 7 个 vitest 用例覆盖：
      5 模板含 context、模式名、关键约束词；inline image 按需拼；禁词检查
      （不含古典 + 工业制造 hardcoded 文档形态词）；inlineImageRule 默认值
- [x] BE-22：`tsc --noEmit` 干净
- [x] BE-23：tsx smoke：26 断言全过（`enum / 守卫 / env / 5 模板 / 禁词 / 关键约束`）

## 文档与 ADR
- [x] DOC-1：`.superpowers-memory/decisions/2026-04-28-46-rag-intent-routing.md`
      —— 本 change 的母 ADR，记录"纯 prompt 调优是末梢治理"洞察 + D-001/D-002/
      D-003/D-004 路径
- [x] DOC-2：`docs/superpowers/specs/rag-intent-routing/design.md` —— Explore
      阶段设计草稿（B 工作流第 1 步产物）
- [x] DOC-3：`openspec/changes/rag-intent-routing/{proposal,design,specs/*-spec,tasks}.md`
      —— OpenSpec Lock（B 工作流第 2 步产物）
- [x] DOC-4：`docs/superpowers/plans/rag-intent-routing-impl-plan.md` —— 实施计划
      倒推（B 工作流第 3 步产物）

## 验证（B 工作流第 4 步前置）
- [x] V-1：`pnpm -C apps/qa-service test` 79 用例全绿（含 isObviousLanguageOp 新增 18 用例）；
      31 个 failed 均为 pre-existing（PG 连接 + 上游 test bug，跟本 change 无关）
- [x] V-2：case1a/2a/2b 全部 emit `🎭 → <intent>`；case2a 输出逐句白话 + 透明度声明；
      case2b emit `⚙️ K=8（中文短查询）`（C 调优同步生效）
- [x] V-3：跨文档实测 7 case：
      - V3A 中文产品文档总结 → language_op ✓
      - V3B 英→中翻译 → language_op ✓（修了 3 次：顶层 prompt + 档 B prompt + 规则前置）
      - V3B' 中→英翻译 → language_op ✓
      - V3B'' 总结今日头条 → language_op ✓
      - V3C "what is over slam" → factual_lookup（拒答）⚠️ 接受 limitation
      - V3D 库里有哪些汽车资料 → short-circuit 兜底 ⚠️ 接受 limitation（待 D-002.2）
      - V3E 为什么 GM 写 → out_of_scope ✓
      - case2a 回归 → language_op ✓
- [x] V-4：env `B_HANDLER_ROUTING_ENABLED=false` + `RAG_CONDENSE_QUESTION_ENABLED=false`
      回滚通道实测：case1a → ⛔ short-circuit + 0.028 兜底文案；case2a → LLM 拒答
      "知识库中没有"；三 case 全无 `🪄`/`🎭`；行为完全等价 main

## Archive（B 工作流第 4 步 · 验证通过后）
- [ ] AR-1：把 `docs/superpowers/specs/rag-intent-routing/` 移到
      `docs/superpowers/archive/rag-intent-routing/`
- [ ] AR-2：在看板把本 change 状态标 Done，更新负责人周报
- [ ] AR-3：合并 PR 到 main，OpenSpec 契约 freeze 生效
- [ ] AR-4：通知下游负责人（`AnswerIntent` enum 可消费；future intent 标签 UI /
      子 handler 实施可启动）
