/**
 * EmptyState —— 任务队列为空时的引导
 */
import { useNavigate } from 'react-router-dom'

export default function EmptyState() {
  const navigate = useNavigate()
  return (
    <div style={{
      padding: '40px 20px', textAlign: 'center', color: 'var(--muted)',
    }} data-testid="empty-state">
      <div style={{ fontSize: 32, marginBottom: 8 }}>📥</div>
      <div style={{ fontSize: 13, marginBottom: 4 }}>
        当没有入库任务时，展示引导与常见入口
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        从左上角选择文件上传 / 网页抓取 / 对话沉淀 / 批量任务开始
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => navigate('/assets')}
        style={{ marginRight: 8 }}
      >
        查看资产目录
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => navigate('/overview')}
      >
        返回总览
      </button>
    </div>
  )
}
