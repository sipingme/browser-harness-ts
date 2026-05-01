# browser-harness-ts

[English](./README.md) · **简体中文**

一个**内置** Python [`browser-harness`](./browser-harness) 守护进程的**薄 TypeScript 客户端**。
一个 Chrome、一个 daemon、一套 JSON 协议——Python agent 和 TS agent 可以同时连上来用。

```
┌──────────────┐       ┌──────────────────┐       ┌────────────────────┐
│ TS agent     │ ────▶ │ Python daemon    │ ────▶ │ 真实 Chrome (CDP)   │
│ (本包)        │  unix │ (./browser-      │  ws   │                    │
│              │  sock │  harness/)       │       │                    │
└──────────────┘       └──────────────────┘       └────────────────────┘
        ▲
        │ (同时:Python agent 通过 `browser-harness -c '...'` 共用同一个 daemon)
```

**Node 侧零运行时依赖**(只用 `net` + `fs`)。难活——CDP 握手、陈旧 session 自愈、
浏览器配置目录发现、远程云浏览器、76 个 domain-skills——都留在
`./browser-harness/` 子目录里,`git pull` 自动跟随上游。

## 为什么这样做

浏览器自动化是个"细节漏得到处都是"的领域——CDP 协议每个 Chrome 版本都在变、
profile picker 流程、陈旧 session、15 种不同的 user-data-dir 路径。
**完整用 TypeScript 重写**这些要烧掉几周时间,而且每次 Chrome 发新版都得再烧一轮。
保留久经沙场的 Python daemon,外面套一层薄 TS 客户端,能拿到以下收益:

### 1. **无缝接入 TS 生态**(这是核心卖点)

daemon 对 TS 侧就是一个"讲 Promise 的黑盒"——正是现代 TS agent 框架期望的形态:

- **Vercel AI SDK** / **Mastra** / **LangChain.js** / **Claude Agent SDK (TS)** /
  **OpenAI Agents SDK (TS)** 都可以把 `BH` 的方法直接注册成 typed tool,
  不用 subprocess marshaling,也不用解析 stdout。
- **Electron / Tauri / VS Code 扩展** 可以直接 embed 这个 TS 客户端,
  不需要给终端用户打包 Python 运行时(daemon 跑在开发者 / 管理员这端,
  反正 Chrome 也在这端)。
- **Monorepo 友好** —— 丢进 pnpm / Turborepo workspace,前端代码和自动化
  代码共享类型,ESLint / Vitest / `tsc --noEmit` 一条工具链打天下。
- **原生 fetch、原生 Promise、原生 ESM** —— 不需要 adapter,不需要
  `child_process.spawn` 的烂套路,不需要解析 stdout。

### 2. 类型贯穿全链路

```ts
// CDP 协议类型随手即取
import type { Protocol } from "devtools-protocol";
const targets = await bh.cdp<Protocol.Target.GetTargetsResponse>("Target.getTargets");

// 注入的 JS 里也有 DOM 类型 —— 编辑器能查拼写、能自动补全
const titles = await bh.js<string[]>(
  () => [...document.querySelectorAll<HTMLAnchorElement>("a.titleline")]
          .map((a) => a.textContent ?? ""),
);
```

注入的那个函数在编辑器里是**真正的函数** —— 能重构、能改名、能跳转定义。
Python 版的 `js("document.title")` 只是字符串,打错只有运行时才会炸。

### 3. 免费继承 Python 积累的两年边界 case 修复

`./browser-harness/` 已经处理好:

- Chrome M144 的 "Allow remote debugging" 对话框流程
- Chrome M136 默认 profile 的 CDP 锁定
- Chrome 147+ `/json/version` HTTP 发现端点被移除
- 陈旧 DevTools WebSocket 自愈重连
- 把"伪装成 tab"的 omnibox-popup 过滤掉
- macOS/Linux/Windows 上 Chrome/Edge/Arc/Brave/Comet 等 15 种 profile 路径
- Windows 上 AF_UNIX 不可用时的 TCP loopback 回退

**这些你都不用再踩一遍**。`git -C browser-harness pull` 一句话就跟上最新修复,
同时你的 TS 客户端只需要保持 ~500 行的纯 JSON RPC。

### 4. 混合方案的独有优势:跨语言共享一个 Chrome

这是单语言版本做不到的:

```bash
# Python 侧做探索和知识沉淀(LLM 写 Python 一行流最顺)
browser-harness -c '
new_tab("https://some-new-site.com")
# 查选择器、试 API...
# 把经验固化到 agent-workspace/domain-skills/some-new-site/scraping.md
'

# TS 侧跑生产流水线(有类型、可组合、可测试)
# —— 操作的是**同一个** Chrome tab、同一份登录态、同一份 cookie
npm run cli -- -c 'await bh.pageInfo(); await bh.helpers.doTheRealWork();'
```

Python agent(Claude Code / Codex)和 TS agent(你的应用)看到**同一个浏览器**。
登录态、cookie、session storage 跨语言边界保留,不会出现"需要重新登录"
或"刚才的验证码要再过一次"这类问题。

### 5. 继承的不只是代码,还有社区知识库

`./browser-harness/agent-workspace/domain-skills/<站点>/` 下的 76 个 markdown
文件记录了**各大网站上真正管用的套路** —— 稳定选择器、私有 API、
框架怪癖、坑点。Markdown 语言中立,Python agent 和 TS agent 都能读。
全量 TS 重写只能把它们当"只读参考文档";在这个混合方案里,
它们是**活的参考材料**,直接接在 Python `agent_helpers.py` 热加载机制上。

### 6. 退路始终留着

以后哪天要纯 TS(某个部署场景,或彻底抛 Python),你的业务代码不会被锁死 ——
daemon 协议就是一行行 JSON。把 RPC 目标换成纯 TS daemon 实现即可,
**调用侧代码一行都不用改**。

## 目录结构

```
browser-harness-ts/
├── browser-harness/         ← Python 守护进程(随本仓库一起存在,带独立的 .git,本仓库 .gitignore 忽略)
├── src/                     ← 本 TS 客户端
├── agent-workspace/         ← TS 侧可热加载的 agent helpers
├── bin/bhts.ts              ← `bhts -c '...'` 命令行
├── examples/basic.ts        ← smoke 示例
├── scripts/setup.sh         ← 一键安装脚本(uv 安装 + tsc 编译)
└── package.json
```

## 安装

**第一次用,一条命令搞定:**

```bash
npm install
npm run setup          # 用 uv 安装 ./browser-harness,编译 TS 客户端,
                       # 最后提示你运行 `browser-harness --setup` 附着 Chrome
```

`npm run setup` 做了这些事:

1. 检测 `./browser-harness/` 是否存在(不存在会给出恢复提示)。
2. 检查 `uv` 是否已安装(没有就打印安装命令)。
3. 执行 `uv tool install --force -e ./browser-harness` —— 把 `browser-harness` 命令加到 PATH。
4. 编译 TS 客户端(`tsc` → `dist/`)。
5. 提示下一步:`browser-harness --setup` 去 attach 你正在运行的 Chrome。

**手工 attach 步骤**(命令到 PATH 之后):

```bash
browser-harness --setup     # 交互式 —— 需要时会引导 chrome://inspect
npm run doctor              # 验证环境
```

**`browser-harness` 命令找不到?** uv 的 bin 目录没进 PATH:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

**还没有装 `uv`?**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh     # 官方安装器
# 或
brew install uv
```

## 快速开始

```ts
import { BH } from "browser-harness-ts";

const bh = await BH.connect();

await bh.newTab("https://news.ycombinator.com");
await bh.waitForLoad();

const info = await bh.pageInfo();
console.log(info);

const titles = await bh.js<string[]>(
  () => [...document.querySelectorAll(".titleline a")].map((a) => a.textContent ?? ""),
);
console.log(titles.slice(0, 5));

await bh.captureScreenshot({ path: "/tmp/hn.png" });
```

运行:

```bash
npx tsx examples/basic.ts
```

## 命令行工具(`bhts`)

`browser-harness -c '...'` 的 TypeScript 孪生版——适合 shell 脚本和那些
喜欢用子进程接口的 LLM agent:

```bash
npx tsx bin/bhts.ts -c '
  await bh.newTab("https://example.com");
  await bh.waitForLoad();
  console.log(await bh.pageInfo());
'
```

`-c` 片段里的环境:`bh` 是已连接的 `BH` 实例,`h` 是 `bh.helpers` 的别名
(见下文),顶层 `await` 可直接使用。

## Agent 可编辑的 helper(热加载)

在 `agent-workspace/agent_helpers.ts` 里放任务相关的 helper 就行:

```ts
// agent-workspace/agent_helpers.ts
import type { BH } from "../src/harness.js";

export async function starRepo(bh: BH, owner: string, repo: string) {
  await bh.gotoUrl(`https://github.com/${owner}/${repo}`);
  await bh.waitForLoad();
  await bh.clickAtXy(/* x */ 920, /* y */ 220);   // star 按钮,测量一次就记住
}
```

`BH.connect()` 时自动加载,通过 `bh.helpers.starRepo(...)` 调用。
长驻进程里 agent 改了文件后,调 `bh.reloadAgentHelpers()` 立刻生效。

**持久的站点知识**(URL 规律、稳定选择器、坑点)仍然写到 Python repo 里
`./browser-harness/agent-workspace/domain-skills/<站点>/` 下,以 markdown 形式——
**语言中立,Python 和 TS agent 都能读**。

## API 速查

所有方法除非特别说明都是 async。

| 类别 | 方法 |
|---|---|
| 导航 | `gotoUrl(url)`、`newTab(url?)`、`waitForLoad(sec?)`、`pageInfo()` |
| 输入 | `clickAtXy(x, y, button?, clicks?)`、`typeText(s)`、`pressKey(k, mod?)`、`scroll(x, y, dy?, dx?)` |
| JS | `js<T>(stringOrFn, { targetId? })` |
| 视觉 | `captureScreenshot({ path?, full? })` |
| 标签页 | `listTabs(includeChrome?)`、`currentTab()`、`switchTab(t)`、`ensureRealTab()`、`iframeTarget(substr)` |
| 文件 | `uploadFile(selector, paths)` |
| 原始 CDP | `cdp<T>(method, params?, sessionId?)`——helper 没覆盖的一切能力 |
| 守护进程 | `drainEvents()`、`pendingDialog()`、`reloadAgentHelpers()` |

类型严格。CDP 响应默认是 `unknown`——知道形状时请通过泛型指定
(`cdp<T>`、`js<T>`),或者借助已装好的 `devtools-protocol` 包做类型化。

## 三种方案对比

|  | Python 原版 | 本包(混合方案) | 全量 TS 重写 |
|---|---|---|---|
| Chrome attach 边界坑 | ✅ 已经踩过 | ✅ 免费继承 | ❌ 再踩一遍 |
| 76 个 domain-skills | ✅ 权威源 | ✅ 共享 | ⚠️ 只读参考 |
| 上游持续更新 | ✅ `git pull` | ✅ `git pull` | ❌ 重新翻译 |
| 原生 TS 类型 | ❌ | ✅ | ✅ |
| 进程内 Promise | ❌(子进程) | ✅ | ✅ |
| 额外运行时 | Python | Python + Node | Node |

## 环境变量

| 变量 | 含义 |
|---|---|
| `BU_NAME` | daemon 命名空间。默认 `default`。并行跑多 agent 时用不同的名字。 |
| `BH_AGENT_WORKSPACE` | 覆盖 TS 侧 `agent-workspace` 目录路径。 |
| `BH_TMP_DIR` | 与 Python 侧一起用时,保持 socket 位置一致(隔离 tmpdir 场景)。 |

## 暂未实现(按需补)

骨架阶段刻意留给 Python 侧或后续扩展:

- 守护进程生命周期管理(`ensure_daemon`、`run_doctor`、`run_update`、`start_remote_daemon`)
- `http_get` 走 fetch-use 代理——直接用 Node 原生 `fetch` 即可
- 截图降采样(`max_dim`)——需要的话装 `sharp` 加一步 resize
- 配置文件同步(`list_cloud_profiles`、`sync_local_profile`)

如果 TS 侧临时要用上面这些,直接 spawn Python CLI 就行:

```ts
import { spawn } from "node:child_process";
spawn("browser-harness", ["--doctor"], { stdio: "inherit" });
```

## 与 Python 原版的协作模式

因为两侧用**同一个 JSON-over-socket 协议**,任意时刻都可以这样混合用:

```bash
# Python 侧:快速探索 + 沉淀 markdown skill
browser-harness -c '
new_tab("https://www.xiaohongshu.com/explore")
wait_for_load()
print(page_info())
'

# 立刻切到 TS 侧:用强类型跑业务流程,共用同一个 Chrome
npx tsx -e '
  import { BH } from "./src/index.js";
  const bh = await BH.connect();
  const info = await bh.pageInfo();
  console.log(info);
'
```

浏览器状态、登录态、Cookie 在两次调用之间**完全保留**——它们操作的是同一个 Chrome tab。

## 许可

MIT —— 与 Python 原版一致。
