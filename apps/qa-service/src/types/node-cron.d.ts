/**
 * 最小 types stub for node-cron。我们只用 schedule / stop / validate。
 */
declare module 'node-cron' {
  export interface ScheduledTask {
    start(): void
    stop(): void
  }
  export function schedule(
    cronExpression: string,
    func: () => void | Promise<void>,
    options?: { scheduled?: boolean; timezone?: string },
  ): ScheduledTask
  export function validate(cronExpression: string): boolean
}
