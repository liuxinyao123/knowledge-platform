import { describe, it, expect } from 'vitest'
import { classifyByKeyword } from '../agent/intentFallback.ts'

describe('classifyByKeyword', () => {
  it('matches metadata_ops for CRUD-on-metadata questions', () => {
    const v = classifyByKeyword('帮我新建一个数据资产')
    expect(v.intent).toBe('metadata_ops')
    expect(v.fallback).toBe(true)
  })

  it('matches data_admin for analytics questions', () => {
    const v = classifyByKeyword('统计最近 7 天新增的用户数量')
    expect(v.intent).toBe('data_admin')
  })

  it('matches data_admin for @数据管理员 prefix', () => {
    const v = classifyByKeyword('@数据管理员 今天的审计报表')
    expect(v.intent).toBe('data_admin')
  })

  it('matches structured_query for SQL keywords', () => {
    const v = classifyByKeyword('SELECT name FROM asset WHERE id > 10')
    expect(v.intent).toBe('structured_query')
  })

  it('matches structured_query for schema terms', () => {
    const v = classifyByKeyword('这张表的 schema 是什么')
    expect(v.intent).toBe('structured_query')
  })

  it('defaults to knowledge_qa', () => {
    const v = classifyByKeyword('什么是知识图谱')
    expect(v.intent).toBe('knowledge_qa')
    expect(v.fallback).toBe(true)
    expect(v.confidence).toBe(0.5)
  })
})
