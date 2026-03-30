# Free LLM APIs

[English](README.md) · **[中文](README-CN.md)**

免费大模型 API 服务商的实时状态监控。记录每个服务商的可用状态、响应延迟、速率限制和 90 天历史，每小时自动更新。

[![在线站点](https://img.shields.io/badge/在线站点-free--llm--apis.pages.dev-22c55e?style=flat-square)](https://free-llm-apis.pages.dev)
[![服务商数量](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Ffree-llm-apis.pages.dev%2Fdata%2Fstatus_summary.json&query=%24.total&label=%E6%9C%8D%E5%8A%A1%E5%95%86&style=flat-square&color=3b82f6)](https://free-llm-apis.pages.dev/providers)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

---

## 概览

每个服务商的详情页展示：当前状态、响应延迟、RPM / RPD 限制、模型列表，以及 90 天可用性热力图。数据由 Cloudflare Worker 定时检查，每小时写入一次。

### 页面

| 页面 | 说明 |
|------|------|
| `/` | 状态看板——所有服务商的实时状态网格 |
| `/providers` | 完整服务商列表，支持搜索、筛选和排序 |
| `/providers/{id}` | 详情页：模型列表、速率限制、代码示例、可用性热力图 |
| `/configs` | 导出 LiteLLM、Cursor、LobeChat、Open WebUI 的配置文件 |
| `/changelog` | 服务商状态变更与模型更新记录 |

---

## 特性

- **每小时健康检查** — 由 Cloudflare Workers 定时执行，无需人工维护
- **90 天可用性热力图** — 每格对应一天，按服务商独立展示
- **自动变更日志** — 宕机、恢复、模型上下线均自动检测并记录
- **配置导出** — 下载适用于主流 LLM 工具的 YAML / JSON / TOML 配置
- **OpenAI 兼容接口** — 所有收录服务商均支持 `/v1/chat/completions` 格式

---

## 贡献指南

向本项目贡献，主要是在 [`site/src/data/providers.json`](site/src/data/providers.json) 中新增或修改服务商条目，然后提交 Pull Request。CI 在每次 PR 时自动运行格式校验。

### 步骤

1. Fork 本仓库
2. 在 `site/src/data/providers.json` 中添加你的条目
3. 本地运行 `npm run validate` 检查格式
4. 提交 Pull Request

### 服务商字段说明

```jsonc
{
  "id": "my-provider",              // 唯一标识符：小写字母、数字、连字符
  "name": "My Provider",            // 网站展示名称
  "description": "一句话描述该服务商提供的内容。",
  "base_url": "https://api.example.com/v1",  // 末尾不加斜杠
  "signup_url": "https://example.com/keys",
  "website_url": "https://example.com",
  "logo": "https://example.com/logo.svg",    // 推荐使用正方形 SVG
  "status": "active",               // active（活跃）| archived（已归档）
  "latency_ms": null,               // 留 null，由 checker 自动填写
  "rpm": 20,                        // 每分钟最大请求数（不确定填 null）
  "rpd": 200,                       // 每天最大请求数（不确定填 null）
  "context_window": "128K",         // 该服务商支持的最大上下文长度
  "auth": "required",               // required（必须）| optional（可选）| none（无需）
  "tags": ["openai-compatible"],
  "top_models": ["model-id-1", "model-id-2"],  // 1–5 个推荐模型 ID
  "models": [
    {
      "id": "model-id-1",           // API 请求中使用的模型 ID
      "name": "Model Name",
      "context_window": "128K",
      "modalities": ["text"],       // text | vision | code | embedding
      "rpm": 20,
      "rpd": 200,
      "status": "active"            // active（活跃）| deprecated（已弃用）
    }
  ],
  "last_verified": "2026-03-30",    // YYYY-MM-DD，填写核实数据的日期
  "geo_restrictions": [],           // 例如 ["requires-vpn-in-china"]
  "api_key_env": "MY_PROVIDER_API_KEY"  // checker worker 环境变量中对应该服务商 API Key 的字段名
}
```

**可用标签：** `openai-compatible` · `aggregator` · `multi-provider` · `china-available` · `vision` · `thinking` · `function-call` · `deepseek` · `llama` · `embedding`

### 提交前检查

- [ ] `id` 唯一，且仅含小写字母、数字和连字符
- [ ] `base_url` 末尾没有斜杠
- [ ] `top_models` 中的 ID 在 `models` 数组中均有对应条目
- [ ] `last_verified` 填写今天的日期
- [ ] 该服务商有永久免费额度，而非仅限试用赠送
- [ ] `api_key_env` 已填写 checker worker 中对应该服务商 API Key 的 secret 名称

---

## 本地开发

```bash
cd site
npm install
npm run dev   # 启动于 http://localhost:4321
```

开发服务器使用静态 `providers.json`。如需接入 checker worker 的实时状态，创建 `site/.env.local`：

```
PUBLIC_STATUS_WORKER_URL=https://free-llm-checker.YOUR_SUBDOMAIN.workers.dev
```

单独校验数据文件：

```bash
# 在仓库根目录执行
npm run validate
```

---

## 自部署

本项目完整运行在 Cloudflare 免费套餐内。

### 1. 部署前端（Cloudflare Pages）

```bash
cd site
npm run build
npx wrangler pages deploy dist --project-name=your-project-name
```

在 Cloudflare Pages 控制台配置以下环境变量：

| 变量名 | 值 |
|--------|-----|
| `PUBLIC_STATUS_WORKER_URL` | 你部署的 checker worker 地址 |

### 2. GitHub Actions 密钥配置

在仓库 Settings → Secrets 中添加：

| 密钥名 | 用途 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | 部署到 Cloudflare Pages |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `PUBLIC_STATUS_WORKER_URL` | 构建时注入，用于 SSR 状态快照 |
| `WORKER_URL` | 变更日志生成脚本使用 |
| `REFRESH_SECRET` | 保护 worker 的 `/api/refresh` 端点 |

状态检查 worker（`checker-worker/`）不包含在本仓库中，属于私有基础设施，负责定时健康检查并提供 `/api/status` 和 `/api/changelog` 接口。你可以自行实现兼容的 API，也可以不配置 `PUBLIC_STATUS_WORKER_URL`，以纯静态模式运行本站。

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | [Astro](https://astro.build) v6 + [Tailwind CSS](https://tailwindcss.com) v4 |
| 托管 | [Cloudflare Pages](https://pages.cloudflare.com)（免费套餐） |
| 健康检查 | Cloudflare Workers + KV（每小时 cron，私有） |
| CI/CD | GitHub Actions |
| 数据 | `site/src/data/` 中的静态 JSON + 实时 KV 快照 |

---

## 架构

```
GitHub 仓库（providers.json）
        │
        ▼ push 到 main
  GitHub Actions
  ├── validate.mjs      — 每次 PR 触发格式校验
  ├── 同步 → Worker KV  — 更新线上服务商目录
  ├── gen-changelog.mjs — diff git 历史，推送变更日志条目
  └── astro build → Cloudflare Pages

Cloudflare Worker（私有，每小时 cron）
  ├── 检查每个服务商的 /v1/chat/completions 接口
  ├── 将状态和延迟存入 KV
  └── 提供 /api/status 和 /api/changelog

浏览器
  └── 页面加载时请求 /api/status，更新状态标识，无需重新构建
```

---

## 许可证

[MIT](LICENSE) © 2026
