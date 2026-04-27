import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import RequireAuth from '@/auth/RequireAuth'
import Login from '@/knowledge/Login'
import Governance from '@/knowledge/Governance'
import Ingest from '@/knowledge/Ingest'
import IngestJobDetail from '@/knowledge/IngestJob'
import Overview from '@/knowledge/Overview'
import QA from '@/knowledge/QA'
import Agent from '@/knowledge/Agent'
import Search from '@/knowledge/Search'
import SpaceTree from '@/knowledge/SpaceTree'
import SpaceSourceTreePage from '@/knowledge/SpaceTree/SpaceSourceTreePage'
import Mcp from '@/knowledge/Mcp'
import Assets from '@/knowledge/Assets'
import AssetDetail from '@/knowledge/Assets/Detail'
import Iam from '@/knowledge/Iam'
import EvalPage from '@/knowledge/Eval'
import EvalDatasetDetail from '@/knowledge/Eval/DatasetDetail'
import EvalRunDetail from '@/knowledge/Eval/RunDetail'
import NotebooksPage from '@/knowledge/Notebooks'
import NotebookDetail from '@/knowledge/Notebooks/Detail'
import Insights from '@/knowledge/Insights'
import KnowledgeGraph from '@/knowledge/KnowledgeGraph'

export default function App() {
  return (
    <Routes>
      {/* 公开路由 */}
      <Route path="/login" element={<Login />} />

      {/* 受保护路由 */}
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="spaces" element={<SpaceTree />} />
        <Route path="spaces/:id" element={<SpaceTree />} />
        <Route path="spaces/:id/tree" element={<SpaceSourceTreePage />} />
        <Route path="search" element={<Search />} />
        <Route path="ingest" element={<Ingest />} />
        <Route path="ingest/jobs/:id" element={<IngestJobDetail />} />
        <Route path="qa" element={<QA />} />
        <Route path="agent" element={<Agent />} />
        <Route path="governance" element={<Governance />} />
        <Route path="assets" element={<Assets />} />
        <Route path="assets/:id" element={<AssetDetail />} />
        <Route path="iam" element={<Iam />} />
        <Route path="mcp" element={<Mcp />} />
        <Route path="eval" element={<EvalPage />} />
        <Route path="eval/datasets/:id" element={<EvalDatasetDetail />} />
        <Route path="eval/runs/:id" element={<EvalRunDetail />} />
        <Route path="notebooks" element={<NotebooksPage />} />
        <Route path="notebooks/:id" element={<NotebookDetail />} />
        <Route path="insights" element={<Insights />} />
        <Route path="knowledge-graph" element={<KnowledgeGraph />} />
      </Route>
    </Routes>
  )
}
