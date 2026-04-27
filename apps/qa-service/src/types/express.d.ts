/**
 * Global Express Request augmentation for Unified Auth middleware chain.
 * See apps/qa-service/src/auth/
 */
import type { Principal, Decision, SqlFragment } from '../auth/types.ts'

declare global {
  namespace Express {
    interface Request {
      principal?: Principal
      aclDecision?: Decision
      aclFilter?: SqlFragment
    }
  }
}

export {}
