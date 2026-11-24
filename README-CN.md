# Free LLM APIs

[English](README.md) · **[中文](README-CN.md)**

免费大模型 API 服务商目录：额度和价格均附官方来源，并通过探测监控记录可用状态、响应延迟和 90 天每日历史。

**网站：https://free-llm-site.free-llm-status.workers.dev**

[![在线站点](https://img.shields.io/badge/在线站点-free--llm--site.free--llm--status.workers.dev-22c55e?style=flat-square)](https://free-llm-site.free-llm-status.workers.dev)
[![服务商数量](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Ffree-llm-site.free-llm-status.workers.dev%2Fdata%2Fstatus_summary.json&query=%24.total&label=%E6%9C%8D%E5%8A%A1%E5%95%86&style=flat-square&color=3b82f6)](https://free-llm-site.free-llm-status.workers.dev/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

---

## 概览

每个服务商的详情页展示：当前状态、响应延迟、RPM / RPD 限制、模型列表、资料来源，以及 90 天每日探测历史。模型与额度按官方文档和模型 API 维护；健康状态来自私有的 Cloudflare checker Worker。标签页可见时，浏览器每 5 分钟刷新一次状态。

### 页面

| 页面 | 说明 |
|------|------|
| `/` | 服务商目录：先给出最快能调通的几家，再列出全部免费服务商（支持搜索、筛选和排序），以及最近变更 |
| `/providers` | 跳转到 `/` 并保留查询参数（动态模式返回 301；静态模式用 JS 或 meta refresh 跳转） |
| `/providers/{id}` | 详情页：模型列表、速率限制、资料来源、代码示例、每日探测历史 |
| `/models` | 按模型家族浏览免费服务商与已公布额度 |
| `/pricing` | 对比有官方来源和核实日期的 token 价格，按币种分组 |
| `/configs` | Tools：为选中的服务商生成 LiteLLM 配置，并给出填进 Open WebUI、LobeChat、Cursor 的参数 |
| `/changelog` | 服务商状态变更与模型更新记录 |
| `/changelog.json` | 机器可读的变更日志，按日期从新到旧 |
| `/data/status_summary.json` | 目录计数（`total` 为 active 服务商数，徽章使用此值），不含探测健康状态 |

---

## 特性

- **健康检查** — 动态模式：checker cron 每 15 分钟运行一次，按各服务商预算抽样探测模型；旧版模式：每个服务商每小时检查一次
- **90 天每日探测历史** — 每格对应一天，按服务商独立展示
- **目录自动维护** — 定时采集官方模型 API，只写入有实际变化的内容（[说明](docs/automatic-catalog.md)）
- **自动变更日志** — 自动记录模型/服务商增删和状态变化；手写条目保存在 `site/src/data/changelog.json`
- **Tools** — 为选中的服务商下载 LiteLLM YAML 配置，或复制 Cursor、LobeChat、Open WebUI 需要的 Base URL、模型 ID 和密钥变量名
- **OpenAI 兼容接口** — 所有收录服务商均支持 `/v1/chat/completions` 格式

---

## “免费”的定义

只有官方文档写明**持续性**免费 API 额度（按日/按月的额度，或明确标价为 0 的模型）的服务商才会标为 `active`。一次性试用金、注册促销和会过期的有限额度都不算；这类服务商标为 `archived`，并保留 `archive_reason` 和来源。`auth: credit_card_required` 表示免费额度需要绑定支付方式。

证据要求：

- `sources` 为可选字段：官方 HTTPS 链接、说明文字和 `checked_at` 日期，供维护者留档，站点上不显示。填写时必须非空且合法。
- 缺失、空白或布尔类型的价格一律不视为 0。模型 API 中 `:free`/`-free` 后缀本身不构成证据；自动判定免费还需要明确的零计费值。
- RPM/RPD 为 `null` 表示未公布或取决于账号，不代表无限。按月的额度或 token 预算写进 `quota_note`，不要换算成编造的每日请求数。
- 目录中的 `active` 只表示收录，不代表可用。健康检查用监测账号抽样探测指定模型；无数据、数据过期和账号/额度错误（401/402/403/429）记为 `unknown`，不等同于宕机。每日历史显示当日最差结果，百分比是正常天数 / 已监测天数，不是按时间计算的 SLA。

---

## 贡献指南

静态模式下，每个 provider 都是 [`site/src/data/providers/`](site/src/data/providers/) 目录下的独立 JSON 文件。新增或修改服务商时，编辑（或创建）对应文件，然后提交 Pull Request。CI 在每次 PR 时自动运行校验。动态模式下，这些文件是在线目录的初始数据和故障回退快照，维护者会定期把在线目录导出回这个目录。

### 步骤

1. Fork 本仓库
2. **新增 provider** — 创建 `site/src/data/providers/<id>.json`（字段见下方），并将 `<id>` 追加到 `_order.json` 中以控制展示顺序
3. **修改 provider** — 编辑对应的 `site/src/data/providers/<id>.json`
4. 本地运行 `npm run validate`
5. 提交 Pull Request

### 服务商字段说明

规则以 [`scripts/lib/catalog-validation.mjs`](scripts/lib/catalog-validation.mjs) 为准，命令行、同步任务、站点和 checker Worker 共用这一份校验库。

```jsonc
{
  "id": "my-provider",              // 与文件名一致：小写字母、数字、连字符
  "name": "My Provider",
  "description": "一句话描述。",     // 文本字段必须是字符串
  "base_url": "https://api.example.com/v1",  // HTTPS，末尾不加斜杠，不含 {占位符}
  "signup_url": "https://example.com/keys",  // 可选，HTTPS
  "website_url": "https://example.com",      // 可选，HTTPS
  "logo": "https://example.com/logo.svg",    // 可选，HTTPS；推荐正方形 SVG
  "status": "active",               // active | archived
  "auth": "required",               // required | optional | none | credit_card_required
  "latency_ms": null,               // 留 null，由 checker 填写
  "rpm": 20,                        // 服务商级每分钟请求数，未公布填 null
  "rpd": 200,                       // 服务商级每天请求数，未公布填 null
  "context_window": "128K",         // 可选字符串：最大上下文长度
  "tags": ["openai-compatible"],
  "top_models": ["model-id-1"],     // 1–5 个不重复的 ID，必须是 models 中未弃用的模型
  "model_order": ["model-id-1"],    // 可选：在服务商页面置顶显示的模型，其余按 models 顺序
  "models": [                       // 非空，ID 不重复；数组顺序即显示顺序（自动同步时为接口返回顺序）
    {
      "id": "model-id-1",           // API 请求中使用的模型 ID
      "name": "Model Name",
      "context_window": "128K",     // 可选字符串
      "modalities": ["text"],       // text | vision | code | embedding
      "rpm": 20,                    // 非负数或 null
      "rpd": 200,
      "status": "active",           // active | deprecated
      "pricing": {                  // 可选：标准付费价格，单位为每百万 token
        "input_per_million": 0.5,
        "output_per_million": 1.5,
        "currency": "USD",          // ISO 4217 币种代码
        "source_url": "https://example.com/pricing",
        "checked_at": "2026-11-16", // 不能是未来日期
        "valid_until": "2026-12-31" // 可选：促销价的最后一天
      }
    }
  ],
  "paid_models": [],                // 可选，结构同上；用于付费价格对比，ID 不能与 models 重复
  "sources": [                      // 可选；填写时不能为空
    { "label": "Official free tier", "url": "https://example.com/pricing", "checked_at": "2026-11-16" }
  ],
  "last_verified": "2026-11-16",    // YYYY-MM-DD：人工核实政策的日期
  "catalog_checked_at": "2026-11-16", // 可选，由自动同步写入
  "quota_note": "每月额度……",        // 可选字符串：quota_note、catalog_note、archive_reason、pricing_note
  "geo_restrictions": [],           // 例如 ["requires-vpn-in-china"]
  "api_key_env": "MY_PROVIDER_API_KEY" // 可选：checker 的 secret 名称，必须在 Worker 白名单内
}
```

`last_verified`、`catalog_checked_at` 和所有 `checked_at` 必须是真实日期，且不能晚于今天（容许 1 天时区差）。`npm run validate` 会以 `warning:` 前缀提示但不报错的情况：active 服务商的 `last_verified` 超过 90 天，或价格在 30 天内到期。`valid_until` 已过期时 PR 校验失败，直到更新或删除该价格；部署和定时同步只给出 warning。校验还覆盖 `_order.json`、`changelog.json` 中的 provider ID、`catalog/sources.json` 和 `catalog/state/*.json`。删除某个仍被 `changelog.json` 引用的服务商时，要把它的 ID 加进校验库的 `REMOVED_PROVIDER_IDS`。

**可用标签：** `openai-compatible` · `aggregator` · `multi-provider` · `china-available` · `vision` · `thinking` · `function-call` · `deepseek` · `llama` · `embedding`

### 提交前检查

- [ ] `id` 唯一，且仅含小写字母、数字和连字符
- [ ] `base_url` 为 HTTPS，末尾没有斜杠
- [ ] `top_models` 中的 ID 都是 `models` 里未弃用的模型
- [ ] `sources` 链接到支撑免费额度、限额和价格的官方页面
- [ ] `last_verified` 是你核实上述内容的日期，只在核实后更新（见[维护说明](docs/maintenance.md)）
- [ ] 该服务商有持续性免费额度，而非仅限试用赠送
- [ ] 如果填写了 `api_key_env`，它必须在 checker Worker 的白名单内

---

## 开发

需要 **Node.js 24** 或更高版本（见 `.node-version`）。

```bash
npm ci --prefix site
npm run check
cd site
npx playwright install chromium   # 或设置 PW_CHROME_PATH 使用本机 Chrome
npm run test:e2e                  # 静态页面
npm run test:dynamic              # 动态模式，使用假 catalog API
npm run dev                       # http://localhost:4321
```

`npm run check` 包含目录校验、逻辑回归、Astro 类型检查和生产构建。浏览器测试使用独立的构建目录和模拟的监测接口，不消耗服务商额度。

开发服务器读取 `site/src/data/providers/`（由 `index.ts` 聚合）。如需 checker Worker 的实时状态，把 `site/.env.local.example` 复制为 `site/.env.local` 并设置 `PUBLIC_STATUS_WORKER_URL`。

`npm run catalog:sync` 预览已配置官方模型 API 带来的变化，加 `--write` 保存。见[自动维护说明](docs/automatic-catalog.md)。

### 变量

| 变量 | 设置位置 | 用途 |
|------|----------|------|
| `CATALOG_MODE` | 仓库 variable / 构建环境 | `static`（默认）或 `dynamic`，其他值会导致构建失败 |
| `PUBLIC_STATUS_WORKER_URL` | 仓库 secret / 构建环境 / `site/.env.local` | 浏览器读取状态和变更日志的 checker 地址；动态模式下也是 catalog 的兜底地址 |
| `CATALOG_API_URL` | 站点 Worker 运行时变量（或构建环境） | 站点 Worker 没有 `CHECKER` 服务绑定时（`astro dev`，或用 `CATALOG_CHECKER_BINDING=off` 构建），动态渲染通过 HTTP 读取的 catalog API 地址，默认使用 `PUBLIC_STATUS_WORKER_URL` |
| `CATALOG_CHECKER_BINDING` | 构建环境 | `on`（默认）或 `off`；设为 `off` 时，动态站点忽略 `CHECKER` 绑定，始终使用 `CATALOG_API_URL` |
| `CATALOG_CACHE_TTL_MS` | 站点 Worker 运行时变量（或构建环境） | 动态模式下每个隔离实例的目录缓存时间，默认 60000，`0` 表示不缓存 |
| `PUBLIC_SITE_URL` | 仓库 variable / 构建环境 | 站点正式地址，用于 canonical、sitemap 和 `robots.txt` |
| `CATALOG_ALLOW_EXPIRED` | 构建环境 | 设为 `1` 时促销价过期只报 warning（部署和同步使用） |
| `CATALOG_TEST_PORT` | 本地 e2e | 动态测试中假 catalog API 的端口（默认 4334） |
| `PW_CHROME_PATH` | 本地 e2e | 使用本机 Chrome，而不是 Playwright 自带的 Chromium |

---

## 自部署

本项目运行在 Cloudflare 免费套餐内。

### 静态模式（默认）

```bash
npm ci --prefix site
npm --prefix site run build
cd site && npx wrangler pages deploy dist --project-name=your-project-name
```

站点根据 provider JSON 预渲染后部署到 Cloudflare Pages，没有 Worker 也能运行（状态显示为 unknown）。构建时设置 `PUBLIC_STATUS_WORKER_URL` 即可显示实时状态。

### 动态模式

页面在 Cloudflare Workers 上按请求渲染，目录来自 catalog API（`GET /api/catalog`），新增服务商无需重新构建。设置 `CATALOG_MODE=dynamic` 即可。`free-llm-site` Worker 通过 [`site/wrangler.jsonc`](site/wrangler.jsonc) 里的 `CHECKER` 服务绑定读取 `free-llm-checker` 的目录：同一账号下的 `workers.dev` Worker 之间不能直接用 HTTP 互相请求，所以要先部署 checker。浏览器仍然通过 HTTPS 直接请求 checker 公开的 `/api/status` 和 `/api/changelog`。没有绑定时（`astro dev`），站点改用 `CATALOG_API_URL`。生产构建在本地预览时也带着这个绑定，本机没有运行 `free-llm-checker` 时会显示内置快照；构建时设 `CATALOG_CHECKER_BINDING=off`，预览才会读取 `CATALOG_API_URL`。目录不可用或数据无效时，页面先回退到最近一次校验通过的目录，再回退到打包的 provider JSON，并显示提示。

切换到动态模式后，站点地址是 https://free-llm-site.free-llm-status.workers.dev，旧地址 https://free-llm-apis.pages.dev 会 301 跳转过去（见 [`redirect/`](redirect/README.md)）。本 README 顶部的链接在正式切换时再改。

### GitHub Actions 密钥

| 密钥名 | 用途 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | 部署到 Cloudflare Pages（静态）或 Workers（动态） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `PUBLIC_STATUS_WORKER_URL` | 构建时注入，浏览器读取实时状态 |
| `WORKER_URL` | checker 地址，部署时用于同步目录、变更日志和刷新探测 |
| `REFRESH_SECRET` | 仅供部署使用：只能同步目录、变更日志和刷新探测，无法访问任何管理接口 |

状态检查 Worker 不包含在本仓库中，属于私有基础设施，负责健康检查并提供只读的公开接口 `/api/status`、`/api/changelog` 和 `/api/catalog`。你可以自行实现兼容的 API，也可以不配置 `PUBLIC_STATUS_WORKER_URL`，以不带实时状态的静态站点运行。

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | [Astro](https://astro.build) v7 + [Tailwind CSS](https://tailwindcss.com) v4 |
| 托管 | [Cloudflare Pages](https://pages.cloudflare.com)（静态）或 Cloudflare Workers（动态） |
| 健康检查 | Cloudflare Workers cron（私有）：旧版模式用 KV，动态模式用 D1 + KV |
| CI/CD | GitHub Actions |
| 数据 | `site/src/data/` 和 `catalog/` 中的 JSON；动态模式下为 D1 中的目录版本 |

---

## 架构

```
sync-catalog.yml（静态模式，目前手动触发；每 6 小时的定时任务可随时启用）
  ├── collect：采集官方模型 API 并生成变更（只读，不运行 npm）
  ├── check：  对生成的变更运行 npm run check
  └── publish：提交实际变化；provider 文件有变化时触发 Deploy

GitHub 仓库（site/src/data/providers/*.json、catalog/）
        │ push 到 main / 手动触发
        ▼
  Deploy 工作流
  ├── npm run check + 浏览器测试
  ├── 静态：目录和变更日志同步到 checker KV，gen-changelog.mjs
  └── 静态：astro build → Pages  |  动态：astro build → Workers

Checker Worker（私有，cron 每 15 分钟）
  ├── 旧版（无 D1）：每个服务商每小时检查一次，状态存入 KV
  ├── 动态（D1）：  来源同步 / 服务商发现，按预算探测模型
  └── 提供 /api/status、/api/changelog（动态模式另有 /api/catalog）

浏览器
  └── 请求 /api/status，更新状态标识，无需重新构建
```

---

## 许可证

[MIT](LICENSE) © 2026
