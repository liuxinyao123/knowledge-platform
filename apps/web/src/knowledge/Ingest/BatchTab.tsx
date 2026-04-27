/**
 * BatchTab —— 批量任务 Tab：ZIP 导入 + 文件服务器（SMB 等）接入
 */
import { useState } from 'react'
import ZipImporter from './ZipImporter'
import FileSourceList from './FileSourceList'

export default function BatchTab() {
  const [showFileSources, setShowFileSources] = useState(false)

  return (
    <div data-testid="batch-tab">
      {/* ZIP 导入 */}
      <div className="surface-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>BookStack ZIP 批量导入</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          上传 BookStack ZIP 包，按结构整书入库。
        </div>
        <ZipImporter />
      </div>

      {/* 文件服务器接入 */}
      <div className="surface-card" style={{ padding: 14 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowFileSources(!showFileSources)}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {showFileSources ? '▾' : '▸'} 文件服务器
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              定时从 SMB / NAS 等文件服务器拉文件入库（支持后续扩 S3 / WebDAV / SFTP）
            </div>
          </div>
        </div>
        {showFileSources && (
          <div style={{ marginTop: 14 }}>
            <FileSourceList />
          </div>
        )}
      </div>
    </div>
  )
}
