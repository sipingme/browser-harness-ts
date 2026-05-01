# 自定义 domain skill

> [English](./README.md) | 中文

把你自己的站点知识放这里,一个站点一个文件夹。

```
agent-workspace/domain-skills/
├── your-company-crm/
│   ├── login.md
│   └── reports.md
├── some-private-dashboard/
│   └── scraping.md
└── internal-booking-tool/
    └── upload.md
```

## 文件夹命名规则

用 **hostname 主干** —— `www.` 和第一个 `.` 中间那一段:

- `https://app.notion.so/...`        → `notion/`
- `https://www.xiaohongshu.com/...`  → `xiaohongshu/`
- `https://my-internal.acme.com/...` → `my-internal/`

这跟上游 `browser-harness/agent-workspace/domain-skills/` 的布局一致,也是
Python `goto_url()` 自动查找时认的目录名(见下文 *Mode 2*)。

## skill 文件里该写什么

skill 是一张**地图**,不是**日记** —— 记录下一个 agent 上手之前必须知道的、
**长期有效**的东西。详细的评判标准见上游指南
[`../../browser-harness/SKILL.md`](../../browser-harness/SKILL.md)。

**该写的**:

- URL 规律、查询参数、重定向陷阱
- 私有 API(页面调用的 `XHR`/`fetch` 端点、请求体结构、鉴权方式)
- 稳定的选择器(`data-*`、`aria-*`、`role`、有语义的 class)
- 框架怪癖("这个下拉框是 React combobox,只有按 `Escape` 才真正提交")
- `wait_for_load()` 抓不到的特殊等待,以及原因
- 坑点(残留的草稿、老 ID 现在返回 `null`、unicode 问题、`beforeunload` 弹框)

**不要写**:

- 原始像素坐标(视口/缩放一变就废)
- 某一次具体任务的流水账
- 密码、cookie、session token —— 这个目录是要进 git 的

## agent 怎么找到这些文件

### Mode 1(默认,简单)—— 两个工作区都读

上游 76 个 skill 住在 `browser-harness/agent-workspace/domain-skills/`,
你的自定义 skill 住在这里。让 agent 两边都读就行:

```bash
# 从 shell / agent 里同时搜两个库
rg -l '' browser-harness/agent-workspace/domain-skills/ \
       browser-harness-ts/agent-workspace/domain-skills/
```

在你的 LLM system prompt(或这份 README)里告诉它两个路径都看。
Python 的 `goto_url()` 默认只自动检测上游那个,但 markdown 文件任何 agent
被明确指路后都读得到。

### Mode 2(进阶)—— 让 Python 指向你的工作区

设 `BH_AGENT_WORKSPACE`,这样 Python 的 `goto_url()` 会自动检测**你的** skill,
并加载**你的** `agent_helpers.py`:

```bash
export BH_AGENT_WORKSPACE="$(pwd)/browser-harness-ts/agent-workspace"
browser-harness --reload      # 守护进程切到新工作区
```

代价:Python 的 `goto_url()` 不再自动查上游那 76 个 skill。想两边都有,
跑一次合并脚本 —— 它会把上游每个 skill 文件夹 symlink 进当前目录:

```bash
npm run merge-skills     # 从仓库根目录执行
```

这样 `goto_url()` 会同时看到上游(通过 symlink)和你的(真目录),
都在同一个 `agent-workspace` 下。**symlink 是每台机器本地的产物,不要提交**;
只用 `git add <你自己的站点目录>` 加你新建的真文件夹。上游新增 skill 后
重跑 `merge-skills` 即可。

## 示例

复制一个上游的例子改改就行:

```bash
cp -r ../../browser-harness/agent-workspace/domain-skills/xiaohongshu \
      ./my-internal-tool
# 编辑 my-internal-tool/scraping.md
```
