# dsh-hark-subagent —— 把 hark 云端 agent 当 DSH 子 agent

> 路径: `plugins/dsh-hark-subagent/` · 类型: **DSH 宿主插件 (工具面扩展)**
> 配套网关: `workspaces/reverse/hark.com/bridge/` (端口 8920)

## 解决什么

hark 是**云电脑 agent**: 工具在它自己的云沙箱里执行, 没有 OpenAI API, 也不能被 DSH 当成模型
(三条硬证据见 `workspaces/reverse/hark.com/DSH-COMPATIBILITY.md`)。

但它可以当**执行体**。本插件把这条链的 DSH 侧补齐:

    DSH 主 agent (HengXin666)
      └─ hark_submit  ──►  网关挑一个有额度的 hark 号
                           └─ 校验它的 GitHub 绑定 (真绑 + 在 LoLiOA)   ← 防假绑定
                           └─ 建 hark 项目 (独立 cid)
                           └─ 把任务投进项目, 指定存储仓库/分支/目录
      └─ hark_wait    ──►  hark 在 GitHub 存储仓库里用 REST API 提交
      └─ hark_publish ──►  主 agent 以 HengXin666 身份合并 + 开 PR

## 存储布局 (用户的硬要求)

| 仓库 | 布局 | 谁开 PR |
|---|---|---|
| `LoLiOA/dev-public` (public) | 每个作业一条分支 `hark/<job_id>`, 产物在仓库根 (与真实项目同构) | hark 侧提交, 主 agent 开 PR |
| `LoLiOA/dev-private` (private) | main 分支 + `<project_dir>/` 目录隔离, **绝不写根** | 主 agent 以 HengXin666 合并进真实私有仓 |

存储仓库只是**介质**。真正的交付一律由 `hark_publish` 落到目标仓库并开 PR。

## 为什么超时不算失败

用户明确要求: "注意你我可能会超时, 不要因为超时就取消任务或者静默失败, 要能知道任务有时候是接续的"。

- `hark_wait` 的语义是"最多等 N 秒", 到点返回 `RUNNING`/`STALE` + `resume` 摘要;
- 插件**从不**发 cancel; `hark_cancel` 只在人明确要求时由主 agent 调;
- `STALE` = 心跳超过 180s 没更新 (**不是失败**), 处理方式是继续等或 `hark_followup` 接续。

## 实时状态 (WS)

插件启动后连 `ws://127.0.0.1:8920/ws`, 收到 `snapshot` 后每帧增量更新, 并把一段摘要
渲染进**系统提示** (`order 5110`):

    [hark] WS 实时 · 快照 2s 前 · 号 17/17 可用 · 已绑 4 · 在跑 job 1
      - j-20261019-0001 RUNNING 轮次3 hark=hk...@lolioa.com gh=puma188c repo=LoLiOA/dev-public

为什么必须进系统提示而不是"给个工具等它来查": 本仓实测 agent 主动检索率 6.7%,
"给模型一个工具等它来调"约等于 0 次调用 (与 `dsh-taskspan` 同一条结论)。

人也可以直接开 `http://127.0.0.1:8920/subagent` 看同一份数据的表格视图。

## 工具 (8 个)

| 工具 | 用途 |
|---|---|
| `hark_submit` | 投递任务 (挑号 → 验绑定 → 建项目 → 发首轮) |
| `hark_status` | 作业状态 (单个 / 列表 + 容量) |
| `hark_wait` | 等待推进 (超时不算失败) |
| `hark_followup` | 同一作业再发一轮 (上下文在 hark 项目里延续) |
| `hark_cancel` | 显式取消 (仅在明确要求时) |
| `hark_accounts` | 号池: 存活 / 额度 / 绑定 / 是否在 LoLiOA |
| `hark_bind` | 绑定 + **三重真值校验** (防假绑定) |
| `hark_publish` | 以 HengXin666 合并 + 开 PR |

## 挂载 (两处都要改, 少一处不生效)

```bash
cd ~/.dsh/profiles/web
pnpm add link:/home/hx/Loli/code/AI-Code/gpt-json-to-token/HX-Jungle/plugins/dsh-hark-subagent
```

然后编辑 `~/.dsh/profiles/web/package.json`, 在 `dsh.profile.bundles` 里补上
`"dsh-hark-subagent"`, 重启 dsh。

**判据**: 对照已生效的 `hx-memory` / `dsh-purge` —— 它们都是 **dep + bundles 双在**。
只在 dep 里 = 装了不加载。

## 前置

网关必须先起 (否则插件工具全部返回 `reachable:false`, 但不阻塞宿主启动):

    ./run.sh start hark2api
    curl -s localhost:8920/health

> hark 冒烟
