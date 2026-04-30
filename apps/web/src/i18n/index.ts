/**
 * i18n init —— react-i18next + i18next + browser language detector
 *
 * 接入方式（main.tsx 第一行）：`import './i18n'`
 *
 * 语言：
 *   - zh-CN（默认 + fallback）—— 现有所有硬编码中文继承到这里
 *   - en          —— 第一波翻译目标
 *   - ja / ko / vi —— 骨架已留 namespace，文案待补（先 fallback 到 en）
 *
 * Namespace 拆分：
 *   - common         —— 跨页面通用（按钮、错误、占位符、确认弹窗等）
 *   - notebook       —— Notebook 模块（NotebookList / Detail / Templates / Chat / Studio / Share）
 *   - <module>       —— 后续每个大模块单开 namespace（QA / Search / KG / Agent / Governance / IAM / Eval ...）
 *
 * 持久化：localStorage key `dsclaw.i18n.lang`；没值时 detector 按 navigator.language 兜底。
 *
 * 添加新 key 流程：
 *   1. 在 resources/zh-CN.json 对应 namespace 加 key
 *   2. 复制到 en.json 翻译；ja/ko/vi 留空（自动 fallback en）
 *   3. 组件用 `const { t } = useTranslation('notebook')` + `t('some.key')`
 *
 * 添加新语言：
 *   1. 在 resources/ 加 <lang>.json，按 namespace 分块
 *   2. resources/index.ts 加 import + 进 resources map
 *   3. SUPPORTED_LANGUAGES 加新条目（含 native label）
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhCN from './resources/zh-CN.json'
import en from './resources/en.json'
import ja from './resources/ja.json'
import ko from './resources/ko.json'
import vi from './resources/vi.json'

/** localStorage 持久化 key（与 i18next-browser-languagedetector lookupLocalStorage 同步） */
export const I18N_STORAGE_KEY = 'dsclaw.i18n.lang'

/** 支持的语言列表 + native label（用于切换 widget 显示） */
export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文', nativeLabel: '简体中文' },
  { code: 'en',    label: '英文',    nativeLabel: 'English' },
  { code: 'ja',    label: '日语',    nativeLabel: '日本語' },
  { code: 'ko',    label: '韩语',    nativeLabel: '한국어' },
  { code: 'vi',    label: '越南语',  nativeLabel: 'Tiếng Việt' },
] as const

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]['code']

const resources = {
  'zh-CN': zhCN,
  en,
  ja,
  ko,
  vi,
} as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: {
      // 未译的 ja / ko / vi key 先回退到 en，再回退到 zh-CN
      ja: ['en', 'zh-CN'],
      ko: ['en', 'zh-CN'],
      vi: ['en', 'zh-CN'],
      'default': ['zh-CN'],
    },
    defaultNS: 'common',
    ns: ['common', 'nav', 'auth', 'overview', 'components', 'notebook'],
    interpolation: {
      escapeValue: false,   // React 已经做 XSS 转义
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: I18N_STORAGE_KEY,
      caches: ['localStorage'],
    },
    react: {
      useSuspense: false,
    },
  })

export default i18n
