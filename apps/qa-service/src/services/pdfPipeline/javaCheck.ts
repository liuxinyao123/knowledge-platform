/**
 * pdfPipeline/javaCheck.ts —— 启动时 java -version 探测
 * 不阻断启动；缺失则后续 ODL 调用降级到 officeparser。
 */
import { spawnSync } from 'node:child_process'

let _javaAvailable: boolean | null = null
let _javaVersion = ''

export function checkJava(): { ok: boolean; version: string } {
  if (_javaAvailable !== null) return { ok: _javaAvailable, version: _javaVersion }
  try {
    const r = spawnSync('java', ['-version'], { encoding: 'utf8' })
    if (r.error || r.status !== 0) {
      _javaAvailable = false
      _javaVersion = ''
      return { ok: false, version: '' }
    }
    // java -version 输出在 stderr，第一行类似 'openjdk version "17.0.10" ...'
    const firstLine = (r.stderr || r.stdout || '').split('\n')[0].trim()
    _javaAvailable = true
    _javaVersion = firstLine
    return { ok: true, version: firstLine }
  } catch {
    _javaAvailable = false
    return { ok: false, version: '' }
  }
}

/** 强制重检（测试 / 显式刷新） */
export function resetJavaCheck(): void {
  _javaAvailable = null
  _javaVersion = ''
}

export function isJavaAvailable(): boolean {
  if (_javaAvailable === null) checkJava()
  return _javaAvailable === true
}
