# Proposal: 数据资产目录 + pgvector 向量检索

**日期**: 2026-04-20  
**状态**: 已批准

## 问题

当前向量检索为 MySQL 全表扫描 + 内存余弦计算，无 ANN 索引，数据量增长后性能不可接受。资产元数据散落在 asset_source / asset_item / knowledge_chunks 三张结构零散的 MySQL 表中。

## 方案

引入 PostgreSQL + pgvector，建立 4 张规范化 metadata_* 表替换现有 MySQL 资产表，实现 IVFFlat ANN 向量检索 + 三级切片文档入库 + BookStack 同步脚本。

## 决策

- 采用双数据库（MySQL 保留 BookStack 应用表，PostgreSQL 承接所有资产/向量表）
- 嵌入模型继续使用 SiliconFlow Qwen/Qwen3-Embedding-8B（1024 维）
- 旧 MySQL 资产表暂保留不 DROP，路由切换后下版本清理
