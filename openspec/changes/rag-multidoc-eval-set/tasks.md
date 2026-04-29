# Tasks: D-003 RAG 多文档类型评估集

> 工作流：B `superpowers-openspec-execution-workflow`
> 状态：B-2 OpenSpec Lock 完成；等用户 review proposal + 4 份 spec freeze 后进 B-3

## 后端（apps/qa-service / scripts / eval）

### eval 数据
- [ ] DATA-1：把 V-3 期间手测的 7 case + case2a 转 jsonl（含新字段），形成
      `eval/multidoc-set.jsonl` 起步 8 case（其中 must_pass: V3B / V3E / case2a）
- [ ] DATA-2：补 classical_chinese 类（道德经 #20）共 8 case：
      事实查询 ×3 / language_op 翻译释义 ×3 / multi_doc_compare ×1 / out_of_scope ×1
- [ ] DATA-3：补 industrial_sop_en 类（LFTGATE / Bumper PDFs）共 12 case：
      数值 verbatim ×6 / 中英翻译 ×3 / 找不到 ×2 / 多对象对比 ×1
- [ ] DATA-4：补 cn_product_doc 类（知识中台 #18）共 8 case：
      事实查询 ×3 / 总结 ×3 / multi_doc_compare ×1 / kb_meta ×1
- [ ] DATA-5：补 table_xlsx 类（GM 评测集 ×4）共 10 case：
      跨行查询 ×4 / kb_meta 列表 ×3 / 找不到 ×3
- [ ] DATA-6：补 presentation_pptx（报价汇总 #13）共 6 case：
      数字 verbatim ×3 / 总结 ×2 / out_of_scope ×1
- [ ] DATA-7：补 short_news_md（今日头条 #4）共 6 case：
      数据弱场景的 language_op 退化 ×4 / out_of_scope ×2

### runner 实现
- [ ] BE-1：新建 `scripts/eval-multidoc-lib.mjs` —— 内部库
      - parseJsonl（兼容 // 注释）
      - login（自动拿 admin token）
      - dispatchSse（POST + SSE 解析 + Observed 构造）
      - 7 个 assertion fn（assertIntent / assertPatternType / assertKeywords /
        assertMustNotContain / assertRecallTopK / assertTransparencyDeclaration /
        assertNonRefusalForLangOp）
      - aggregateReport（按维度 / 按 doc_type / 按 intent 分组）
- [ ] BE-2：新建 `scripts/eval-multidoc.mjs` —— CLI 入口
      - flag 解析（--sample / --doc-type / --intent / --strict / --output / --verbose）
      - env 读取（EVAL_API / EVAL_ADMIN_EMAIL / EVAL_ADMIN_PASSWORD / 等）
      - preflight（service 可达 / 登录成功 / jsonl 存在 / schema 合法）
      - 主循环（per case: dispatch → assert → 汇总）
      - 报告输出（stdout 或 --output 文件）
      - 退出码（0 / 1 按 strict + must_pass）
- [ ] BE-3：单元测试 `scripts/__tests__/eval-multidoc-lib.test.mjs` —— vitest
      - 注释行解析跳过
      - 必填字段缺失报错
      - 枚举非法报错
      - 7 个 assertion fn 各 ≥ 3 case（pass / fail / skip）
      - SSE 事件解析（各类 icon 正确抽取）
      - 报告聚合按 dim / doc_type / intent

### 文档
- [ ] DOC-1：`eval/README.md` 新增 "D-003 多维度评测" 段落：
      - 跑法（`node scripts/eval-multidoc.mjs`）
      - 数据 schema 简介（指 OpenSpec spec）
      - 报告示例
      - --sample / --strict 等 flag 用法
      - V-3 已知 limitation 在 D-003 中怎么标（must_pass=false + comment）
- [ ] DOC-2：`eval/multidoc-set.jsonl` 文件头加注释（schema link / data_version 含义）

### 验证（B 工作流第 4 步前置）
- [ ] V-1：`node scripts/eval-multidoc.mjs --sample 5` 跑通（不崩 + 报告格式对）
- [ ] V-2：`node scripts/eval-multidoc.mjs` 全集 ~3 分钟跑完，报告输出符合 design.md
      格式
- [ ] V-3：`--strict` 模式下 must_pass case 全过（V3B / V3E / case2a）
- [ ] V-4：`--doc-type classical_chinese` 仅跑古文 8 case，验证 filter 生效
- [ ] V-5：手动篡改一条 must_pass case 让其 fail，验证 --strict 退 1
- [ ] V-6：vitest 跑 `scripts/__tests__/eval-multidoc-lib.test.mjs` 全绿

## Archive（B 工作流第 4 步 · 验证通过后）
- [ ] AR-1：把 `docs/superpowers/specs/rag-multidoc-eval-set/` 移到
      `docs/superpowers/archive/rag-multidoc-eval-set/`
- [ ] AR-2：在看板把本 change 状态标 Done
- [ ] AR-3：合并 PR 到 main，OpenSpec 契约 freeze 生效
- [ ] AR-4：通知下游：D-002.2 / D-002.3 现在可以用 `eval-multidoc.mjs` 做回归基线
