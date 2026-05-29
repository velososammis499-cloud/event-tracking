<div align="center">

# Event Gadget

**零侵入自动埋点 + 智能分析工具**

在任意网页中加入一行代码，即可自动采集用户的所有点击、曝光、页面浏览、表单交互与停留时长，并通过可视化看板进行行为分析与自然语言对话分析。

[English](#english) | [中文](#中文)

</div>

---

## 中文

### 它能做什么

- **自动采集** — 不需要产品经理指定埋点，不需要前端研发写代码，自动采集页面浏览、点击、元素曝光、表单交互、停留时长
- **全链路追踪** — 自动感知用户从哪里来（直接访问 / 外部链接 / 站内跳转），记录完整的页面导航链路
- **可视化看板** — 科技感仪表盘，包含数据概览、路径分析、排行榜、导航链、事件浏览器、行为分析、偏好分析 8 大模块
- **对话式分析** — 内置自然语言分析引擎，支持中文提问，如"用户点击最多的功能是什么"、"用户从首页都去了哪里"
- **隐私安全** — 自动过滤密码、信用卡等敏感字段，不上报敏感信息

### 架构概览

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   目标网页    │────▶│  Server (:3001)  │────▶│   Dashboard      │
│  + sg.js     │     │  数据接收 + 存储   │     │   (:5173)        │
│  + tracker   │     │  SQLite          │     │   可视化分析看板   │
└─────────────┘     └─────────────────┘     └──────────────────┘
```

| 包 | 说明 |
|---|------|
| `packages/tracker` | 浏览器端自动埋点 SDK，自动采集 5 类事件 |
| `packages/server` | Node.js 后端，接收事件数据，SQLite 持久化，提供分析 API |
| `packages/dashboard` | React 分析看板，8 大分析页面 + 对话分析 |

### 自动采集的事件类型

| 事件类型 | 说明 | 采集内容 |
|---------|------|---------|
| `pageview` | 页面浏览 | 路径、标题、来源、触发方式 |
| `click` | 点击 | 元素标签、文本、ID、class、href、data-track |
| `impression` | 元素曝光 | 可见比例、可见时长 |
| `form_interaction` | 表单交互 | 聚焦/修改/提交、字段名、字段类型 |
| `dwell` | 停留时长 | 页面活跃停留时间 |

---

### 快速开始

#### 前置要求

- Node.js >= 18
- npm >= 9

#### 1. 安装 & 启动

```bash
# 克隆项目
git clone https://github.com/velososammis499-cloud/event-tracking.git
cd event-tracking

# 一键安装依赖 + 构建追踪器 + 初始化数据库
npm run setup

# 启动服务（同时启动后端 + 看板）
npm run dev
```

启动完成后：
- 后端服务运行在 **http://localhost:3001**
- 分析看板运行在 **http://localhost:5173**

#### 2. 在你的网页中接入埋点

在目标 HTML 页面的 `<head>` 或 `<body>` 末尾添加一行代码：

```html
<script src="http://localhost:3001/sg.js" data-app-id="your-app-name" data-debug="true"></script>
```

**参数说明：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `src` | 是 | 指向你部署的 sg.js 地址 |
| `data-app-id` | 是 | 应用标识，用于区分不同业务系统，如 `"purchase-system"`、`"erp"`、`"company-website"` |
| `data-user-id` | 否 | 当前登录用户 ID |
| `data-debug` | 否 | 设为 `"true"` 在浏览器控制台查看采集日志 |

#### 3. 查看分析数据

1. 打开看板 **http://localhost:5173**
2. 在页面顶部的 **App ID** 输入框填入你的 `data-app-id`（如 `your-app-name`）
3. 点击 **30天** 时间范围按钮
4. 数据即会展示在各分析页面中

#### 4. 体验 Demo 页面

项目自带两个示例页面，可直接体验：

```bash
# 在 example 目录下启动静态服务
cd example
python3 -m http.server 8080
```

| Demo 页面 | 地址 | 说明 |
|-----------|------|------|
| 基础 Demo | http://localhost:8080/index.html | 简单 4 页 SPA，快速体验 |
| 供应链系统 | http://localhost:8080/supply-chain.html | 完整供应链业务系统模拟 |

打开后在页面上点击操作，然后回到看板查看数据。

---

### 在不同场景中接入

#### 纯 HTML 页面

```html
<!DOCTYPE html>
<html>
<head>
  <title>我的页面</title>
</head>
<body>
  <h1>Hello World</h1>
  <button data-track="btn-submit">提交</button>

  <!-- 在 </body> 前加入这一行 -->
  <script src="http://your-server:3001/sg.js" data-app-id="my-site" data-debug="true"></script>
</body>
</html>
```

#### React / Vue SPA 项目

在项目的 `index.html` 的 `<head>` 中加入：

```html
<script src="http://your-server:3001/sg.js" data-app-id="my-spa-app"></script>
```

Tracker 会自动监听 `history.pushState` 和 `popstate`，SPA 路由切换无需额外配置。

#### 多个业务系统

每个系统使用不同的 `data-app-id`，看板中按 App ID 筛选：

```html
<!-- 采购系统 -->
<script src="http://your-server:3001/sg.js" data-app-id="purchase-system"></script>

<!-- 仓储系统 -->
<script src="http://your-server:3001/sg.js" data-app-id="warehouse-system"></script>

<!-- 财务系统 -->
<script src="http://your-server:3001/sg.js" data-app-id="finance-system"></script>
```

#### 标记关键元素

给需要重点追踪的元素加上 `data-track` 属性，Tracker 会优先采集并关联标签：

```html
<button data-track="btn-quick-order">快速下单</button>
<a href="#/suppliers" data-track="nav-suppliers">供应商</a>
<div data-track-impression="card-stats">统计卡片</div>
```

---

### 部署到服务器

#### 方式一：直接部署

```bash
git clone https://github.com/velososammis499-cloud/event-tracking.git
cd event-tracking
npm run setup

# 生产模式启动后端
cd packages/server
npm run build
PORT=3001 node dist/index.js

# 生产模式启动看板
cd packages/dashboard
npm run build
# 将 dist/ 目录用 nginx 等静态服务器托管，配置反向代理 /api 和 /collect 到后端
```

然后网页中的 `src` 改为你的服务器地址：

```html
<script src="http://your-server-ip:3001/sg.js" data-app-id="my-app"></script>
```

#### 方式二：Docker（推荐）

```bash
# 构建镜像
docker build -t event-gadget .

# 启动
docker run -d -p 3001:3001 -p 5173:5173 event-gadget
```

#### 方式三：离线分发

```bash
# 构建后打包
npm run setup
cd packages/dashboard && npm run build && cd ../..

# 打包必要文件
tar -czf event-gadget.tar.gz \
  package.json package-lock.json \
  packages/tracker/dist \
  packages/server/src packages/server/package.json packages/server/public \
  packages/dashboard/dist packages/dashboard/package.json
```

对方收到后解压、安装依赖、启动即可。

---

### 看板功能一览

| 页面 | 功能 |
|------|------|
| **数据概览** | 页面浏览量、会话数、用户数、事件总量 + 趋势图 + 热门页面 |
| **路径分析** | Sankey 流图展示页面间跳转，来源类型分布，掉失漏斗，页面停留时长 |
| **排行榜** | 点击 / 曝光排行，页面互动表 |
| **导航链** | 会话级完整导航时间线，可视化用户操作轨迹 |
| **事件** | 原始事件浏览器，支持按类型、路径、时间筛选 |
| **行为** | 行为路径分析，来源渠道分布，跳出点识别 |
| **偏好** | 点击热力图，注意力雷达，操作模式序列，功能使用趋势 |
| **对话分析** | 自然语言提问，如"用户最常点击什么"、"从首页去了哪里" |

---

### API 接口

后端默认运行在 3001 端口，提供以下接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/collect` | 接收埋点事件数据 |
| GET | `/api/events` | 查询事件列表（支持分页、筛选） |
| GET | `/api/pages` | 页面统计（浏览量、独立会话、独立用户） |
| GET | `/api/journeys` | 页面跳转路径对 |
| GET | `/api/chains` | 完整导航链 |
| GET | `/tracker.js` | Tracker SDK（UMD） |
| GET | `/sg.js` | 零配置加载器 |
| GET | `/health` | 健康检查 |

---

### 技术栈

| 模块 | 技术 |
|------|------|
| Tracker SDK | TypeScript, Rollup, Zod, IntersectionObserver |
| Server | Express, better-sqlite3, TypeScript |
| Dashboard | React 19, React Router 7, TanStack Query, Recharts, Vite |

---

### 项目结构

```
event-tracking/
├── packages/
│   ├── tracker/          # 浏览器端自动埋点 SDK
│   │   ├── src/
│   │   │   ├── core/     # Tracker 核心、会话上下文、导航链管理
│   │   │   ├── collectors/ # 5 大事件采集器
│   │   │   ├── reporter/ # 批量上报 + 重试 + Beacon 降级
│   │   │   └── utils/    # 敏感字段过滤
│   │   └── dist/         # 构建产物（UMD + ESM）
│   ├── server/           # 数据接收后端
│   │   ├── src/
│   │   │   ├── routes/   # collect + analytics 路由
│   │   │   ├── db/       # SQLite schema + 查询
│   │   │   └── index.ts
│   │   └── public/       # sg.js 零配置加载器
│   └── dashboard/        # 可视化分析看板
│       └── src/
│           ├── pages/    # 8 大分析页面
│           ├── components/ # 可视化组件
│           ├── api/      # API 客户端 + React Query
│           ├── analysis/ # 对话分析引擎
│           └── hooks/    # 筛选器 Hook
├── example/
│   ├── index.html        # 基础 Demo 页面
│   └── supply-chain.html # 供应链系统 Demo
└── package.json          # Monorepo 配置
```

---

## English

### What It Does

- **Auto-tracking** — No manual instrumentation needed. Automatically captures pageviews, clicks, impressions, form interactions, and dwell time
- **Full journey tracking** — Tracks where users come from (direct / external / internal navigation) and records complete navigation chains
- **Visual dashboard** — Cyberpunk-themed analytics dashboard with 8 analysis modules
- **Conversational analysis** — Built-in NLP engine for asking questions in natural language
- **Privacy-first** — Automatically filters sensitive fields like passwords and credit card numbers

### Quick Start

```bash
# Clone and setup
git clone https://github.com/velososammis499-cloud/event-tracking.git
cd event-tracking
npm run setup

# Start backend + dashboard
npm run dev
```

Then add one line to your HTML page:

```html
<script src="http://localhost:3001/sg.js" data-app-id="your-app-name" data-debug="true"></script>
```

Open **http://localhost:5173** to see the analytics dashboard. Enter your `data-app-id` in the filter bar and click **30d** to view data.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `src` | Yes | URL to sg.js on your deployed server |
| `data-app-id` | Yes | App identifier to distinguish different systems |
| `data-user-id` | No | Current logged-in user ID |
| `data-debug` | No | Set to `"true"` to see tracking logs in browser console |

### Deployment

Point the script src to your server address:

```html
<script src="http://your-server:3001/sg.js" data-app-id="my-app"></script>
```

See the [Chinese section](#部署到服务器) for Docker and offline distribution options.

---

### License

MIT
