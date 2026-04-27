# 召回率评测 · 资产级 recall@K

跑一份 golden set（问题 + 期望命中的文档），看 RAG 检索能不能把对的文档放进 top-K 引用里。

## 5 分钟跑一圈

### 1. 把 PDF 入库

通过 /ingest「文件上传」Tab 把 3 个 PDF 拖进去（任选一个空间，例如「研发文库」）。
等 4 个 job 全部 phase=done。

### 2. 拿到 asset_id

打开 /assets 或 /spaces，记下三个文件对应的 asset_id：

```
Bumper Integration BP rev 11.pdf                 → asset_id = ?
LFTGATE-3 Liftgate_Liftglass gas strut...pdf     → asset_id = ?
LFTGATE-32 Liftgate Swing and Tool...pdf         → asset_id = ?
```

也可以走 PG：
```sql
SELECT id, name FROM metadata_asset WHERE name ILIKE 'bumper%' OR name ILIKE 'lftgate%';
```

### 3. 复制模板 + 填 expected_asset_ids

```bash
cd /Users/xinyao/Git/knowledge-platform
cp eval/golden-set.template.jsonl eval/golden-set.jsonl
# 编辑 eval/golden-set.jsonl
# 把每行的 expected_asset_ids 里的 1/2/3 替换成你刚记下来的真实 asset_id
```

如果不想用模板的 10 题，可以把它当格式参考，自己写问题。一行一条 JSON，至少要有 question 和 expected_asset_ids[]。

### 4. 跑

```bash
node scripts/eval-recall.mjs
# 或：
# node scripts/eval-recall.mjs eval/some-other.jsonl
```

### 5. 看输出

```
  ID    R@1     R@3     R@5     首命中  召回前 5 (asset_id)        问题
  ──────────────────────────────────────────────────────────────────
  Q01   1.00    1.00    1.00    #1     27,28,29,30,31              What are the key bumper...
  Q02   0.00    1.00    1.00    #2     28,27,29,30,31              保险杠系统在低速碰撞...
  ...
  ──────────────────────────────────────────────────────────────────

汇总  10/10 有效
  平均 recall@1: 0.700
  平均 recall@3: 0.900
  平均 recall@5: 0.950
  平均首命中 rank: 1.4（仅算命中过的题）
  top-5 没命中: 0 题
```

颜色：
- 🟢 绿 = 1.00（满分）
- 🟡 黄 = 0.5 ~ 0.99（部分命中）
- 🔴 红 = 0（完全没命中）

退出码：
- `0` = 全部题至少 top-5 命中
- `1` = 有题 top-5 没命中（脚本会列出哪几题）
- `2` = 错误（登录失败 / golden set 解析失败 / 单题超时）

## 怎么看结果 / 怎么调

| 现象 | 可能原因 | 试试 |
|---|---|---|
| `recall@1 = 0`、`recall@5 = 1` | 召回到了但排序差 | 升级 reranker；或 fine-tune embedding 模型 |
| 中文问题召回差，英文好 | embedding 模型对中文支持弱 | 换 BGE-M3 或多语言模型 |
| `top-5 全空` | embedding 服务挂了或 chunk 没向量化 | 检查 embedding 服务；看 metadata_field WHERE embedding IS NOT NULL 的 count |
| 同一题每次结果不一样 | 检索是确定性的，要是不一样肯定是 LLM 生成阶段抖动 | 召回率指标只看 trace.citations，跟 LLM 无关，应该稳定 |

## 多次跑做 A/B

```bash
# baseline
node scripts/eval-recall.mjs > eval/results-baseline.txt

# 调完 chunk 大小 / prompt / 模型再跑
node scripts/eval-recall.mjs > eval/results-after-tuning.txt

# 对比
diff eval/results-baseline.txt eval/results-after-tuning.txt
```

未来引入 Ragas（Roadmap-2）后，会扩展成：
- 答案 Faithfulness（生成内容是否被 chunk 支撑）
- Answer Relevancy（答案是否切题）
- Context Precision / Recall（chunk 维度，更细）

当前这个脚本只测 **资产级 recall**（够用 80% 场景）。

## Golden set 写作小贴士

- **每题至少 3 个文档来源类型**：完整匹配（明确指向 1 个文档）/ 跨文档（多个 expected_ids）/ 边界（题目歧义但应能猜对）
- **中英文都试**：embedding 双语能力差距大
- **避免直接复制原文当问题**：那不是真实场景；要用业务方语言提问
- **同义改写也算一题**：「液压撑杆温度补偿」vs「gas strut temp comp」会暴露语义检索的弱点
- **保持 ≥ 30 题**：题数太少结果方差大；30+ 题指标才稳定
