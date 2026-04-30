/**
 * Ambient stub types for i18n libs.
 *
 * 这是 sandbox 友好的"够用"类型声明 —— 让 tsc 能过，让 IDE 能给基本提示，不阻塞开发。
 * 用户 `pnpm install` 之后真正的 react-i18next / i18next / i18next-browser-languagedetector
 * 类型会自动覆盖（node_modules 优先）。
 *
 * 等真正的库装好后这个文件可以删（或保留也无害，会被 node_modules 优先）。
 */

declare module 'i18next' {
  export interface I18n {
    resolvedLanguage?: string
    language?: string
    changeLanguage(lang?: string): Promise<unknown>
    t(key: string, opts?: Record<string, unknown>): string
    use(plugin: unknown): I18n
    init(opts: Record<string, unknown>): Promise<unknown>
  }
  const i18n: I18n
  export default i18n
}

declare module 'react-i18next' {
  import type { I18n } from 'i18next'
  export interface UseTranslationResponse {
    t: (key: string, opts?: Record<string, unknown>) => string
    i18n: I18n
  }
  export function useTranslation(ns?: string | string[]): UseTranslationResponse
  export const initReactI18next: unknown
}

declare module 'i18next-browser-languagedetector' {
  const LanguageDetector: unknown
  export default LanguageDetector
}
