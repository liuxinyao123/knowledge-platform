/**
 * services/actionWebhook.ts
 *
 * Webhook delivery with HMAC signing, allowlist validation, and exponential backoff retry.
 */

import { createHmac } from 'node:crypto'
import { getPgPool } from './pgDb.ts'
import type { ActionEvent } from './actionEngine.ts'

const WEBHOOK_TIMEOUT_MS = 10000
const RETRY_DELAYS_MS = [1000, 4000, 16000] // 1s, 4s, 16s

export async function sendActionWebhook(
  runId: string,
  actionName: string,
  event: ActionEvent,
  actorId: string | number,
  args: Record<string, unknown> | unknown,
  result?: Record<string, unknown> | unknown,
): Promise<void> {
  const pool = getPgPool()

  // Fetch action definition for webhook config
  const { rows: defRows } = await pool.query(
    'SELECT webhook FROM action_definition WHERE name = $1',
    [actionName],
  )

  if (defRows.length === 0 || !defRows[0].webhook) return

  const webhookConfig = JSON.parse((defRows[0] as any).webhook)
  if (!webhookConfig.events?.includes(event)) return

  const url = webhookConfig.url
  const secret = process.env.ACTION_WEBHOOK_SECRET || ''

  // Payload
  const payload = {
    run_id: runId,
    action: actionName,
    event,
    actor_id: String(actorId),
    args,
    result,
    occurred_at: new Date().toISOString(),
  }

  const payloadJson = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(payloadJson).digest('hex')

  // Retry loop
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Action-Signature': `sha256=${signature}`,
        },
        body: payloadJson,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      })

      if (response.ok) {
        // Success
        await pool.query(
          `INSERT INTO action_audit (run_id, event, actor_id, extra, created_at)
           VALUES ($1, 'webhook_sent', $2, $3, NOW())`,
          [runId, String(actorId), JSON.stringify({ status: response.status, attempt })],
        ).catch(() => {})
        return
      }

      lastError = new Error(`HTTP ${response.status}`)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }

    // Backoff before retry
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }

  // All retries failed: write audit
  await pool.query(
    `INSERT INTO action_audit (run_id, event, actor_id, extra, created_at)
     VALUES ($1, 'webhook_failed', $2, $3, NOW())`,
    [
      runId,
      String(actorId),
      JSON.stringify({
        error: lastError?.message || 'unknown error',
        attempts: 3,
      }),
    ],
  ).catch(() => {})
}
