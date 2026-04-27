# LFTGATE-32 评测集审计 · 2026-04-22

> 目的：在跑 eval 前先核对每题的"参考答案"是否真在 PDF 里，避免把"参考答案不在文档里"的题当作系统 bug。
>
> 方法：逐题提取必须命中信号（数字+单位 / 英文术语 / 项目代号），对照 PDF 全文搜索；NO_SIGNAL 类（纯中文释义）人工抽检。

## 一、最终结论

37 题 LFTGATE-32 评测集分类：

| 类别 | 题数 | 含义 | 说明 |
|---|---|---|---|
| **IN_PDF** | 34 | 参考答案在 PDF 里能找到 | RAG 系统理论上都能答对 |
| **PARTIAL** | 1 | 参考答案部分在 PDF | Q68 `DTS / VSM` —— DTS 能答，VSM 全称不在 |
| **OUT_OF_DOC** | 2 | 参考答案完全不在 PDF | Q69 (COF) / Q70 (SSTS) 缩写定义不在文档 |

## 二、OUT_OF_DOC 详情

### Q69 `COF 代表什么？`
- 期望答案：**Crimp-On-Flange**（翻边折边，B&R 法兰折边工具）
- PDF 里出现 "COF" 的位置：
  - "B&R Flange COF tool clearance zone"（标题）
  - "Video of Decklid COF Tool"（图说明）
  - "decklid seal coff tool.wmv"（视频文件名，typo）
- **完全没有"COF = Crimp-On-Flange"或类似定义**
- 性质：**域外行业知识**（GM 内部默认大家都懂）
- 处理：**标 out_of_doc_knowledge，eval 排除**

### Q70 `SSTS 代表什么？`
- 期望答案：**Subsystem Technical Specification**（子系统技术规范）
- PDF 全文搜 "Subsystem Technical Specification" → **0 次命中**
- "SSTS" 在 PDF 里仅作为 acronym 出现，没展开
- 同 Q69 性质
- 处理：**标 out_of_doc_knowledge，eval 排除**

## 三、PARTIAL 详情

### Q68 `DTS 和 VSM 分别代表什么？`
- 期望答案：DTS=Dimensional Technical Specifications；VSM=Variation Simulation Model
- PDF 里 `Dimensional` 出现 1 次（"Work with dimensional engineering"），但**没有 "Dimensional Technical Specifications" 完整短语**
- `Variation Simulation` 完全没找到
- 处理：**部分可答**；评测时如果 LLM 答对 DTS 算 50%，全错算 0

## 四、为什么之前 Run #2 显示 SSTS (Q70) 答对了？

之前 Run #2 截图显示 Q70 `SSTS 代表什么?` 召回 [3, 35] R@1=1.00。

原因：评测度量的是 **资产级 recall@K** —— 期望文档（asset_id=3）出现在引用列表里 = 算对。**它不评估 LLM 输出是否真的回答对了**。

所以 Q70 的 R@1=1.00 仅意味着 retrieve 拿到了 LFTGATE-32 的某些 chunk —— 但 chunk 里没"SSTS = Subsystem Technical Specification"，LLM 大概率也答不出（除非靠预训练知识猜）。

→ **资产级 recall@K 只反映检索能力，不反映答案准确性**。要测答案准确性需要：
- LLM judge（让另一个 LLM 评分系统答案 vs 参考答案的语义相似度）
- 或人工抽样

这是 Roadmap-2 Ragas 评测体系真正要解决的事；当前我们只做到了第一层。

## 五、对评测体系的建议

### V1（当前可做）

- 给 jsonl 加 `out_of_doc_knowledge: true` 标注 Q69 / Q70
- evalRunner 跑 eval 时跳过这些题，或者单独算"OOD 题召回率"
- 这样汇总的 R@K 不被假阳性 / 假阴性污染

### V2（Roadmap-2 Ragas）

- 接 Ragas faithfulness / answer_relevancy
- 用第二个 LLM 评估每题的答案质量（不只看是否召回到对的文档）
- 对于 OUT_OF_DOC 题，期待系统说"知识库中没有相关内容"也算正确行为

## 六、IN_PDF 列表（清单，34 题）

跑 eval 时这些是"系统应该答对"的硬指标：

| 类别 | 题号 |
|---|---|
| basic_fact (easy) | Q16, Q17, Q18, Q19, Q20, Q21, Q22, Q23, Q26, Q30, Q31, Q32, Q33 |
| basic_fact (medium) | Q15, Q24, Q25, Q27, Q28, Q29, Q34, Q35 |
| lessons_learned | Q44, Q45, Q46, Q47, Q48, Q50 |
| concept_reasoning | Q56, Q57, Q58, Q59, Q60 |
| comprehensive_application | Q62, Q63 |

PARTIAL: Q68（半算）  
OUT_OF_DOC: Q69, Q70（应排除或单列）

## 七、下一步

1. 用修订后的 jsonl v3 跑 eval（标注了 OOD 题），对应文件 `eval/gm-liftgate32-v3-annotated.jsonl`
2. 期望 R@1 在排除 OOD 后 ≥ 0.95（即 IN_PDF + PARTIAL 这 35 题里 ≥ 33 题应该 hit asset_id=3）
3. 等 LFTGATE-27 上传后做完整 70 题审计
