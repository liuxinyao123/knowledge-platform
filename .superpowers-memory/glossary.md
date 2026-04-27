# Glossary — 业务名词统一

> 避免同义异名。新词加到表格，不覆盖旧词；语义变化用 ADR 处理。

| 术语 | 含义 | 别名（禁用） |
|------|------|--------------|
| Space | 一组 `metadata_source` + 一组成员（Owner/Admin/Editor/Viewer）+ 该集合内的 scoped ACL。定义见 ADR-26（2026-04-23） | Shelf（BookStack 历史 alias，已失效）、书架 |
| QA Service | Node 侧问答服务 `apps/qa-service` | qa-svc、问答服务端 |
| MCP Service | 内部 MCP 工具服务 `apps/mcp-service` | mcp、mcp 网关 |
| Governance | 权限治理模块（角色、空间可见性） | RBAC 页、权限中心 |
| Metadata Catalog | 资产元数据目录（pgvector 支撑） | catalog、资产库 |
| OpenSpec Change | 锁定的行为契约单元 `openspec/changes/<feature>/` | spec 变更、change set |
| Knowledge Graph | Apache AGE 跑在独立 `kg_db` sidecar 的图谱；节点 Asset/Source/Space/Tag/Question，边 CONTAINS/SCOPES/HAS_TAG/CITED/CO_CITED；定义见 ADR-27（2026-04-23） | KG、图谱、DetailGraph（前端渲染，不是存储） |

> 补充请以 PR 形式提交并更新本文件；同步修改使用者代码中的注释。
