# ARCHIVED — ontology-oag-retrieval

- **Archived at**: 2026-04-24
- **ADR**: `.superpowers-memory/decisions/2026-04-24-33-ontology-oag-retrieval.md`
- **Verification**:
  - `npx tsc --noEmit` clean in `apps/qa-service`, `apps/mcp-service`, `apps/web`
  - `pnpm -r test`: qa-service 308/308 · mcp-service 42/42 · all GREEN
  - 用户本机 macOS 验证（2026-04-24 11:21）
- **Live contract** (frozen, still consumed by `ontology-declarative-skills`): `openspec/changes/ontology-oag-retrieval/`
