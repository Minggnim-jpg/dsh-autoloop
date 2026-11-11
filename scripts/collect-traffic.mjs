#!/usr/bin/env node
/**
 * 拉取 GitHub Traffic 数据并落盘。
 *
 * GitHub 的 traffic/views、traffic/clones、traffic/popular/* 只保留最近 14 天，
 * 过期即不可恢复。这个脚本把每次运行拿到的数据按仓库、按日期合并写入，
 * 让历史长期留存。
 *
 * 环境变量：
 *   GH_TOKEN      必填，需要 repo 权限（经典 PAT 的 repo scope）
 *   REPOS         可选，逗号分隔的仓库列表；缺省时取当前账号全部 public 仓库
 *   OUT_DIR       可选，输出目录，默认 ./data/traffic
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN;
const OUT_DIR = process.env.OUT_DIR || join(process.cwd(), 'data', 'traffic');
const RAW_REPOS = process.env.REPOS || '';

if (!TOKEN) {
  console.error('缺少 GH_TOKEN');
  process.exit(1);
}

/** 带退避的 GET，返回解析后的 JSON；失败返回 null。 */
async function ghGet(path, { attempts = 4 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(`${API}${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      // 403/404 通常是权限不足或仓库无数据，重试无意义
      if (res.status === 403 || res.status === 404) {
        const body = await res.json().catch(() => ({}));
        console.warn(`  ${path} -> ${res.status} ${body.message || ''}`.trim());
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === attempts) {
        console.warn(`  ${path} -> 放弃：${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  return null;
}

/** 读取已有存档，不存在时返回空对象。 */
async function readArchive(file) {
  try {
    return JSON.parse(await readFile(file, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * 把逐日数组合并进已有映射。同一天再次运行以最新值覆盖，
 * 因为 GitHub 会在当天不断累加。
 */
function mergeDaily(existing, rows, timestampKey) {
  const merged = { ...existing };
  for (const row of rows || []) {
    const day = String(row[timestampKey] || '').slice(0, 10);
    if (!day) continue;
    merged[day] = { count: row.count ?? 0, uniques: row.uniques ?? 0 };
  }
  return merged;
}

async function listPublicRepos(owner) {
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await ghGet(
      `/users/${owner}/repos?per_page=100&page=${page}&type=owner&sort=pushed`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const viewer = await ghGet('/user');
  if (!viewer?.login) {
    console.error('无法获取当前账号，检查 GH_TOKEN');
    process.exit(1);
  }

  // 只统计公开仓库：私有仓库的流量不进入公开存档
  const repos = RAW_REPOS
    ? RAW_REPOS.split(',').map((s) => s.trim()).filter(Boolean)
    : (await listPublicRepos(viewer.login))
        .filter((r) => !r.private && !r.fork)
        .map((r) => r.name);

  console.log(`账号 ${viewer.login}，待统计公开仓库 ${repos.length} 个`);

  const summaryRows = [];

  for (const repo of repos) {
    const base = `/repos/${viewer.login}/${repo}`;
    console.log(`- ${repo}`);

    const info = await ghGet(base);
    if (!info) continue;

    const views = await ghGet(`${base}/traffic/views`);
    const clones = await ghGet(`${base}/traffic/clones`);
    const paths = await ghGet(`${base}/traffic/popular/paths`);
    const referrers = await ghGet(`${base}/traffic/popular/referrers`);
    const releases = await ghGet(`${base}/releases?per_page=100`);

    const archiveFile = join(OUT_DIR, `${repo}.json`);
    const archive = await readArchive(archiveFile);

    const downloads =
      archive.downloads && typeof archive.downloads === 'object' ? { ...archive.downloads } : {};
    for (const rel of Array.isArray(releases) ? releases : []) {
      const day = String(rel.published_at || '').slice(0, 10);
      if (!day) continue;
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      downloads[day] = {
        tag: rel.tag_name,
        count: assets.reduce((sum, a) => sum + (a.download_count || 0), 0),
        assets: Object.fromEntries(assets.map((a) => [a.name, a.download_count || 0])),
      };
    }

    const next = {
      repo,
      url: info.html_url,
      stars: info.stargazers_count ?? 0,
      forks: info.forks_count ?? 0,
      watchers: info.subscribers_count ?? 0,
      openIssues: info.open_issues_count ?? 0,
      views: mergeDaily(archive.views || {}, views?.views, 'timestamp'),
      clones: mergeDaily(archive.clones || {}, clones?.clones, 'timestamp'),
      downloads,
      lastPaths: Array.isArray(paths) ? paths : archive.lastPaths || [],
      lastReferrers: Array.isArray(referrers) ? referrers : archive.lastReferrers || [],
      updatedAt: new Date().toISOString(),
    };

    await writeFile(archiveFile, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');

    const sum = (obj) => Object.values(obj).reduce((a, b) => a + (b.count || 0), 0);
    summaryRows.push({
      repo,
      stars: next.stars,
      forks: next.forks,
      views14d: views?.count ?? 0,
      viewsUniques14d: views?.uniques ?? 0,
      clones14d: clones?.count ?? 0,
      cloneUniques14d: clones?.uniques ?? 0,
      downloads: Object.values(downloads).reduce((a, b) => a + (b.count || 0), 0),
      daysArchived: `${Object.keys(next.views).length}v/${Object.keys(next.clones).length}c`,
      totalViews: sum(next.views),
      totalClones: sum(next.clones),
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    login: viewer.login,
    repos: summaryRows,
    totals: {
      stars: summaryRows.reduce((a, r) => a + (r.stars || 0), 0),
      forks: summaryRows.reduce((a, r) => a + (r.forks || 0), 0),
      views14d: summaryRows.reduce((a, r) => a + (r.views14d || 0), 0),
      clones14d: summaryRows.reduce((a, r) => a + (r.clones14d || 0), 0),
      downloads: summaryRows.reduce((a, r) => a + (r.downloads || 0), 0),
    },
  };

  await writeFile(
    join(OUT_DIR, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf-8',
  );
  await writeFile(join(OUT_DIR, 'summary.md'), renderMarkdown(summary), 'utf-8');

  console.log(`\n已写入 ${OUT_DIR}`);
}

function renderMarkdown(summary) {
  const t = summary.totals;
  const lines = [
    '# GitHub 流量存档',
    '',
    `更新时间：${summary.generatedAt}　账号：${summary.login}`,
    '',
    `**合计**：star ${t.stars} · fork ${t.forks} · 近 14 天浏览 ${t.views14d} · 近 14 天克隆 ${t.clones14d} · Release 下载 ${t.downloads}`,
    '',
    '| 仓库 | Star | Fork | 近14天浏览 | 独立访客 | 近14天克隆 | 独立来源 | 下载 | 已存档天数 | 累计浏览 | 累计克隆 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of summary.repos) {
    lines.push(
      `| [${r.repo}](https://github.com/${summary.login}/${r.repo}) | ${r.stars} | ${r.forks} | ${r.views14d} | ${r.viewsUniques14d} | ${r.clones14d} | ${r.cloneUniques14d} | ${r.downloads} | ${r.daysArchived} | ${r.totalViews} | ${r.totalClones} |`,
    );
  }
  lines.push(
    '',
    '> 「近 14 天」是 GitHub 原生窗口；「累计」来自本存档逐日合并，随运行次数增长。',
    '',
  );
  return lines.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
