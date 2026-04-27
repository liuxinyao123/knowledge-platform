import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { walkFolder } from '../services/folderScan.ts'

let root = ''

function touch(rel: string, body = 'hello', dir = root): void {
  const abs = path.join(dir, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

async function collect(opts: Parameters<typeof walkFolder>[0]): Promise<string[]> {
  const out: string[] = []
  for await (const f of walkFolder(opts)) out.push(f.relPath.replace(/\\/g, '/'))
  return out.sort()
}

describe('walkFolder', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'scan-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('recursively yields regular files', async () => {
    touch('a.md')
    touch('sub/b.md')
    touch('sub/deep/c.md')
    expect(await collect({ root })).toEqual(['a.md', 'sub/b.md', 'sub/deep/c.md'])
  })

  it('skips hard-blacklisted directories', async () => {
    touch('keep.md')
    touch('node_modules/pkg/index.js')
    touch('.git/HEAD')
    touch('dist/main.js')
    expect(await collect({ root })).toEqual(['keep.md'])
  })

  it('skips lock files and .env', async () => {
    touch('.env')
    touch('.env.local')
    touch('pnpm-lock.yaml')
    touch('package-lock.json')
    touch('real.md')
    expect(await collect({ root })).toEqual(['real.md'])
  })

  it('respects includeGlob', async () => {
    touch('doc.md')
    touch('doc.txt')
    touch('image.png')
    const res = await collect({ root, includeGlob: ['*.md'] })
    expect(res).toEqual(['doc.md'])
  })

  it('respects excludeGlob', async () => {
    touch('keep.md')
    touch('draft/a.md')
    touch('draft/sub/b.md')
    const res = await collect({ root, excludeGlob: ['draft/**'] })
    expect(res).toEqual(['keep.md'])
  })

  it('respects recursive=false', async () => {
    touch('a.md')
    touch('sub/b.md')
    const res = await collect({ root, recursive: false })
    expect(res).toEqual(['a.md'])
  })

  it('skips files above maxFileMb', async () => {
    touch('small.md', 'x')
    touch('big.md', 'x'.repeat(2 * 1024 * 1024 + 10))      // 2MB+
    const res = await collect({ root, maxFileMb: 1 })
    expect(res).toEqual(['small.md'])
  })
})
