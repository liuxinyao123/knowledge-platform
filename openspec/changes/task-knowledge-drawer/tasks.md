# Tasks: task-knowledge-drawer (G8) —— 🅿 PARKED

## 状态

**本 change 仅 proposal/design/spec 存在，代码未实现；暂存待真 PRD §16 原文确认后再开工。**

Claude 一开始按"DSClaw task knowledge drawer"名字推测了设计，未逐字核对 `uploads/知识中台产品需求文档.md` 的 §16 章节。
用户反馈后：半截后端（`routes/knowledgeTask.ts`）已 revert，index.ts 的 import 也已回滚，TS 保持双 0。

## Re-start 前的 checklist

- [ ] 打开 `/sessions/hopeful-clever-planck/mnt/uploads/知识中台产品需求文档.md` 读完 §16 整节
- [ ] 对齐：这是"DSClaw 任务详情页内嵌抽屉"，还是"知识中台侧的 Task 视图"？两种接入方向的设计完全不一样
- [ ] 与 `uploads/dsclaw-knowledge-prototype.html` 里的 DSClaw 原型图对照，理解抽屉触发位置
- [ ] 如果相关性检索要用 LLM 摘要/重排，确认模型可用性
- [ ] 如果 DSClaw 用 iframe 嵌入，需额外做 CORS / postMessage 协议

## 原设计（仅供 re-start 时参考）

proposal.md / design.md / specs/task-knowledge-drawer-spec.md 里有一版猜测设计：
- `POST /api/knowledge/task-context` —— title+description 语义检索 + audit_log 关键字匹配
- `<TaskKnowledgeDrawer>` 组件 + `/task-demo` 页

Re-start 时如果发现 PRD §16 与此猜测方向一致，这些文档可直接复用；否则推倒重写。
