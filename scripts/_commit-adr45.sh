#!/usr/bin/env bash
# scripts/_commit-adr45.sh
#
# 一次性工具：commit ADR-45 + push。
# 走 git commit -F 从临时文件读 message，绕开 zsh 把 ! 当历史展开的坑。
# 用完可删。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# 残留 lock 兜底（如果上次操作没清干净）
find .git -name "*.lock" -delete 2>/dev/null || true

# message 写到临时文件（git 不会跟踪，只在本进程用）
MSG_FILE="$(mktemp -t adr45-msg.XXXXXX)"
trap 'rm -f "$MSG_FILE"' EXIT

cat > "$MSG_FILE" <<'COMMIT_MSG_EOF'
ADR-45: answer-inline-image · LLM 答案气泡内嵌图片

OQ-ANSWER-INLINE-IMAGE 关闭。在 ADR-44 (Citation 透图) 基础上补齐用户体感
诉求：答案气泡（左侧主对话）正文里直接嵌图，不只是右侧引用区。

C 类工作流（superpowers-feature-workflow）落地：

后端（apps/qa-service/src/services/ragPipeline.ts）:
- docContext 拼接：image_caption chunk 多吐一行 IMAGE: /api/assets/images/<id>
- defaultSystem 加规则 6（条件加，仅在 inline image enabled + 有图候选时）：
  "如果某 [N] 文档片段紧跟有 IMAGE: 行，可以在引用 [N] 后紧跟一行
   markdown ![alt](url)；URL 必须照抄、禁止编造 image_id"
- 新 env INLINE_IMAGE_IN_ANSWER_ENABLED=true 默认；与 CITATION_IMAGE_URL_ENABLED
  完全独立

前端（apps/web/src/knowledge/QA/）:
- 新组件 AnswerContent.tsx 切分 (text|img) 段
- 严格 URL allow-list ^/api/assets/images/\d+$，外部 URL / data: /
  javascript: / 非数字 id / query / fragment / path traversal 一律退化为
  纯文本字面量（防 XSS + 防 LLM 幻觉）
- 流式兼容：未闭合 markdown regex 不抢解析；token 到齐再 re-render
- 相邻 text 段自动合并（fix XSS test 边界）
- AiBubble 用 <AnswerContent /> 替换 {msg.content} 纯文本渲染

测试:
- inlineImagePrompt.test.ts: 5 case env 解析 + 与 CITATION_IMAGE_URL_ENABLED 独立性
- AnswerContent.test.tsx: 15 case parse 切分 + XSS 防御全套（含 path traversal、
  query/fragment、外部 URL、javascript:、data: 等退化场景）

不在 scope:
- Notebooks/ChatPanel + Agent/index.tsx 两个面板的复用（用户后续提需再起 C 类）
- 后端 post-stream 校验（流式破坏体验；前端 allow-list 兜底足够；若日志显示
  LLM 大量幻觉 URL 再启 OQ-ANSWER-INLINE-IMAGE-MONITOR）

ADR: .superpowers-memory/decisions/2026-04-27-45-answer-inline-image.md
关闭的 OQ: open-questions.md#OQ-ANSWER-INLINE-IMAGE
COMMIT_MSG_EOF

echo "═══════════════════════════════════════════════════════"
echo "  Stage all + commit + push"
echo "═══════════════════════════════════════════════════════"

git add -A
git status --short
echo ""
echo "  → git commit -F $MSG_FILE"
git commit -F "$MSG_FILE"

echo ""
echo "  → git push origin main"
git push origin main

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ ADR-45 上线。最新 3 条 commit:"
git log --oneline -3
echo ""
echo "  脚本一次性工具，可删:"
echo "    rm scripts/_commit-adr45.sh scripts/_split-and-push.sh"
echo "═══════════════════════════════════════════════════════"
