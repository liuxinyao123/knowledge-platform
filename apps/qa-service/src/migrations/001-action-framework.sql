-- Action Framework: state machine + audit + webhook
-- Sequence: 001 (check existing pattern before deployment)

CREATE TABLE IF NOT EXISTS action_definition (
  name VARCHAR(64) PRIMARY KEY,
  description TEXT NOT NULL,
  input_schema JSONB NOT NULL,
  output_schema JSONB NOT NULL,
  risk_level VARCHAR(8) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  preconditions JSONB,
  approval_policy JSONB NOT NULL DEFAULT '{"required": false, "approver_roles": ["admin"]}',
  webhook JSONB,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_name VARCHAR(64) NOT NULL REFERENCES action_definition(name),
  actor_id VARCHAR(64) NOT NULL,
  actor_role VARCHAR(16) NOT NULL,
  args JSONB NOT NULL,
  reason TEXT,
  state VARCHAR(16) NOT NULL CHECK (state IN ('draft', 'pending', 'approved', 'executing', 'succeeded', 'failed', 'cancelled', 'rejected')),
  attempts INT DEFAULT 0,
  result JSONB,
  error JSONB,
  approver_id VARCHAR(64),
  approval_note TEXT,
  cancel_requested BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_action_run_state_time ON action_run(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_run_actor_time ON action_run(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS action_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES action_run(id) ON DELETE CASCADE,
  event VARCHAR(24) NOT NULL CHECK (event IN ('state_change', 'webhook_sent', 'webhook_failed')),
  before_json JSONB,
  after_json JSONB,
  actor_id VARCHAR(64) NOT NULL,
  extra JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_audit_run_time ON action_audit(run_id, created_at);
