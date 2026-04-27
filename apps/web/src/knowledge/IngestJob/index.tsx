/**
 * /ingest/jobs/:id —— 数据预处理模块详情页
 *
 * 主体复用 Ingest/PreprocessingModule（variant="full"），本组件只负责页面外壳：
 * 顶部 page-title + 返回按钮。
 */
import { useNavigate, useParams } from 'react-router-dom'
import PreprocessingModule from '@/knowledge/Ingest/PreprocessingModule'

export default function IngestJobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  return (
    <div className="page-body" data-testid="ingest-job-detail">
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">数据预处理模块</div>
          <div className="page-sub">实时跟踪单个入库任务的 6 步流水线 + 切片预览 + 运行日志</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => navigate('/ingest')}>← 返回入库</button>
          <button className="btn primary" onClick={() => navigate('/assets')}>查看资产目录</button>
        </div>
      </div>

      <PreprocessingModule jobId={id} variant="full" />
    </div>
  )
}
