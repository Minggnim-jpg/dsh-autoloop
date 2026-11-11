# 流量存档

GitHub 的 `traffic/views`、`traffic/clones`、`traffic/popular/*` **只保留最近 14 天**，过期即不可恢复。这个目录把每天拉到的数据按仓库、按日期合并写入，让历史长期留存。

## 数据来源

`scripts/collect-traffic.mjs` 调用 GitHub REST API：

| 接口 | 得到什么 |
|---|---|
| `GET /user` | 当前账号 |
| `GET /users/{owner}/repos` | 公开、非 fork 的仓库列表 |
| `GET /repos/{owner}/{repo}/traffic/views` | 近 14 天浏览 |
| `GET /repos/{owner}/{repo}/traffic/clones` | 近 14 天 git clone |
| `GET /repos/{owner}/{repo}/traffic/popular/paths` | 热门页面路径 |
| `GET /repos/{owner}/{repo}/traffic/popular/referrers` | 流量来源 |
| `GET /repos/{owner}/{repo}/releases` | Release 资产下载量 |

## 文件

- `{repo}.json`：单仓库存档，含 `views` / `clones` 逐日合并结果、`downloads`、最近一次 `lastPaths` 与 `lastReferrers`
- `summary.json`：机器可读汇总
- `summary.md`：给人看的汇总表

## 自动运行

`.github/workflows/traffic-archive.yml` 每天北京时间 09:10 运行一次，也可手动触发。

**需要在仓库 Settings → Secrets and variables → Actions 里添加 `TRAFFIC_TOKEN`**：

1. 打开 <https://github.com/settings/tokens> 生成 classic token
2. 勾选 **`repo`** scope（`public_repo` 不够，读不到 traffic 接口）
3. 复制到本仓库的 Actions secret

> 为什么不直接用内置的 `GITHUB_TOKEN`：用 `GITHUB_TOKEN` 提交不会触发其他工作流；traffic 接口本身也要求对仓库有 push 权限。用 PAT 更稳妥。

## 本地运行

```bash
GH_TOKEN=$(gh auth token) node scripts/collect-traffic.mjs
# 只跑指定仓库
GH_TOKEN=$(gh auth token) REPOS=dsh-autoloop,ai-hardware-radar node scripts/collect-traffic.mjs
```

## 口径说明

- **下载**：只有 Release 资产的 `download_count` 才算下载；`git clone` 不算，它单独记在 `clones`。
- **统计范围**：默认只统计**公开且非 fork** 的仓库，私有仓库的流量不进入存档，避免意外公开。
- **14 天窗口**：`views14d` / `clones14d` 是 GitHub 原生窗口内的合计；`totalViews` / `totalClones` 是逐日合并后的累计，随运行次数增长。
