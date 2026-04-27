# ADR 2026-04-24-37 — qa-service Dev Runner = `--experimental-strip-types`（工程纪律）

> 工作流 C · 工程纪律沉淀。触发事件：ADR-35 执行时 `ActionFatalError` 的 `constructor(public code: string, ...)` 让 `pnpm dev:qa` 启动即挂 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。

## 背景

`apps/qa-service/package.json` 的 `dev` 脚本：

```json
"dev": "node --experimental-strip-types src/index.ts"
```

Node 22 的 `--experimental-strip-types` 只做一件事：**把 TypeScript 类型注解物理删掉**，产生合法的 JavaScript 再执行。它**不做编译**，所以 TS 专有的运行时结构都不支持。

## 禁用清单（违反会让 qa-service 启动即挂）

| 违规写法 | 正确写法 |
|---|---|
| `class X { constructor(public foo: T) {} }` | `class X { foo: T; constructor(foo: T) { this.foo = foo } }` |
| `enum Color { Red, Green }` | `const Color = { Red: 'Red', Green: 'Green' } as const; type Color = typeof Color[keyof typeof Color]` |
| `namespace Foo { ... }` | 改用 ES 模块（每个 .ts 文件就是一个模块） |
| `@Decorator` 类/方法装饰器 | 不用（项目目前没场景；有需求改 tsx/swc） |
| `import Foo = require('foo')` | `import Foo from 'foo'`（或 `import * as Foo from 'foo'`） |
| 某些 `export = X` 形式 | `export default X` |

**允许但要小心的写法**（strip-types 支持但行为微妙）：

- `as const` ✓
- `satisfies T` ✓
- `import type { X } from '...'` ✓（会被删除）
- 泛型 `<T>` / `<Args extends ...>` ✓（类型注解都会被删）
- 交叉/联合/映射类型 ✓
- `readonly` 字段修饰符 ✓（普通字段声明上就可以；只有 `readonly` + parameter property 合用才踩坑）

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | 禁止在 `apps/qa-service/src/**` 使用 parameter property / enum / namespace / 装饰器 | 其它三个写法已列入"禁用" |
| D-002 | 新代码合并前 CI（或至少本地）跑一次 `pnpm --filter qa-service dev` 冷启动 30s 无挂，才算通过 | tsc 过≠启动过 —— strip-types 错误只在运行时暴露 |
| D-003 | 不切换 `apps/qa-service` 的 dev runner（例如改成 `tsx` / `swc-node`） | 团队已沉淀在 strip-types 上，换运行时是大动作；当前纪律够用 |
| D-004 | `apps/mcp-service` / `apps/web` 同样使用 strip-types 相关的运行时（mcp-service: `node --experimental-strip-types`），纪律同等适用 | 目前 mcp-service 代码未踩坑 |

## 触发本 ADR 的 bug

[.dev-logs/qa-service.log] 启动日志：

```
code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX'
```

**位置**：`apps/qa-service/src/services/actionEngine.ts:19`

**修前**：
```ts
export class ActionFatalError extends Error {
  constructor(public code: string, message?: string) {
    super(message || code)
    this.name = 'ActionFatalError'
  }
}
```

**修后**：
```ts
export class ActionFatalError extends Error {
  code: string
  constructor(code: string, message?: string) {
    super(message || code)
    this.code = code
    this.name = 'ActionFatalError'
  }
}
```

## 关联

- 上游：ADR-35（ontology-action-framework）—— 本 ADR 由其执行 bug 触发
- 未决：暂无

## Review 辅助（给 reviewer 的 egrep）

```bash
grep -rnE 'constructor\s*\((public|private|readonly)\s' apps/qa-service/src apps/mcp-service/src
grep -rnE '^\s*(export\s+)?enum\s+' apps/qa-service/src apps/mcp-service/src
grep -rnE '^\s*namespace\s+[A-Z]' apps/qa-service/src apps/mcp-service/src
grep -rnE '^\s*@[a-zA-Z]\w*\s*\(' apps/qa-service/src apps/mcp-service/src
```

任何命中都要复核（可能是字符串字面量里的误匹配）。
