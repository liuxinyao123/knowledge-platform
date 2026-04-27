# Spec: file-source-smb（SMB/CIFS adapter 协议特定行为）

> 本 spec 只约束 SMB 适配器的协议语义。通用 adapter 行为见 `file-source-adapter-spec.md`。

## config_json 形状

```jsonc
{
  "host": "nas.corp.local",     // 必填 · 主机名或 IP
  "share": "docs",               // 必填 · 共享名
  "path": "/engineering/specs",  // 必填 · share 内路径；以 '/' 开头
  "domain": "CORP",              // 可选 · NTLM domain
  "username": "svc-rag",         // 必填
  "password_enc": "<encrypted>", // 必填 · 加密后的值
  "timeout_ms": 30000,           // 可选 · 默认 30000
  "max_file_mb": 200             // 可选 · 默认 200
}
```

**Scenario: 必填字段缺失**
- Given config 缺 host
- When adapter.init(config)
- Then throw `InvalidFileSourceConfig`，message 含 "host required"

**Scenario: path 没以 / 开头**
- Given config.path = 'engineering'（缺前导斜杠）
- When adapter.init
- Then adapter 内部归一为 '/engineering'（兼容）

---

## 连接 & 认证

**Scenario: NTLMv2 认证成功**
- Given 合法 username / password / domain?
- When adapter.init
- Then 连接建立，listFiles 首调成功

**Scenario: 认证失败**
- Given 错误 password
- When adapter.init
- Then throw `FileSourceAuthError`，message 不含明文 password

**Scenario: 主机不可达 / DNS 失败**
- Given host 无法解析
- When adapter.init
- Then throw `FileSourceNetworkError`，cause 挂原始 DNS/connect error

**Scenario: SMB1 不支持**
- Given 服务器只开了 SMB1
- Then adapter.init 抛 `FileSourceProtocolError` with message 'SMB1 not supported; enable SMB2 or SMB3'

---

## listFiles · 递归 + 增量

**Scenario: 稳定 id = 绝对路径**
- Given 文件 `\\nas\docs\engineering\specs\a.pdf`
- Then `descriptor.id = '\\\\nas\\docs\\engineering\\specs\\a.pdf'`（反斜杠规范的绝对路径）
- And `descriptor.path = '/a.pdf'`（相对 `config.path = '/engineering/specs'`）
- And `descriptor.name = 'a.pdf'`

**Scenario: 子目录递归**
- Given config.path = '/engineering'
- And 文件分布：`/engineering/a.pdf` + `/engineering/sub/b.pdf`
- Then listFiles 返回两条都带各自路径

**Scenario: 跳过特殊目录**
- Given 目录里有 `.snapshot` / `$RECYCLE.BIN` / `.AppleDouble` / `Thumbs.db`
- Then listFiles 不返回这些（默认忽略 ALL dotfile 开头 + 常见系统目录）

**Scenario: 符号链接/快捷方式处理**
- Given 目录含 .lnk 文件
- Then listFiles 跳过（不跟踪 Windows 快捷方式；可在 Execute 阶段走 feature flag 开启）

**Scenario: 非 UTF-8 文件名**
- Given 目录含 GBK 编码的中文文件名
- Then adapter 尝试 UTF-8 解码，失败则用 `sanitizeFilename()` 替换不可表示字符，保留能解码的部分作为 descriptor.name
- And log WARN 一次（不阻断）

**Scenario: mtime 时区**
- Given 远端返回本地时间 '2026-04-23 10:00:00' · 服务器时区 Asia/Shanghai
- Then adapter 必须转成 UTC '2026-04-23 02:00:00Z' 进 descriptor.mtime

**Scenario: listFiles 遇到访问拒绝的子目录**
- Given 部分子目录无读权限（SMB 返回 STATUS_ACCESS_DENIED）
- Then 该目录被跳过，log WARN 一次（path + 错误 code）；scan 继续
- And 其它目录的文件正常返回

---

## fetchFile · 单文件读

**Scenario: 正常读取**
- Given 文件 100KB 存在
- When fetchFile(id)
- Then buffer.length === 100_000

**Scenario: 超过 max_file_mb · 不拉**
- Given config.max_file_mb = 200 · 文件 stat 显示 250MB
- Then throw `FileSourceFileTooLarge`（含 size 和 limit）
- And 不发起实际 READ（避免浪费流量）

**Scenario: fetch 过程中文件被远端修改**
- Given fetch 进行中 · mtime 被改
- Then adapter 完成当前 fetch（返回旧内容）· 不检测 mtime 变化
- And 下一轮 scan 的 listFiles 会把它放进 `updated`，触发重新 ingest

**Scenario: fetch 超时**
- Given 下载中网络卡住超过 `timeout_ms`
- Then throw `FileSourceTimeout`（不挂 stack，message 含 id + elapsed_ms）

---

## close · 资源释放

**Scenario: close 关闭底层连接**
- When close()
- Then SMB TCP 连接关闭；后续 listFiles/fetchFile 抛 `FileSourceClosed`

**Scenario: 连接断开后自动 close**
- Given SMB 连接被远端 RST
- Then adapter 捕获 · emit 'disconnected' 事件 · 标记内部 closed=true
- And 进行中的 fetchFile promise reject with `FileSourceDisconnected`

---

## 凭据 & 日志卫生

**Scenario: password 永不入日志**
- Given adapter 打任何日志（info/warn/error）
- Then 日志内容 stringify 后不得出现明文 password 或 password_enc 的密文
- And config dump 时必须走 `redactSecrets(config)`

**Scenario: error.cause 不包含明文 password**
- Given init 失败抛 `FileSourceAuthError`
- Then error.cause 里的原始错误对象的 message / config 字段都不含明文 password
