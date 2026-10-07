#!/usr/bin/env node
/**
 * Harness Skin — 本地（离线）安装 / 卸载器。只依赖 Node.js，不需要网络。
 *
 *   node install.mjs            安装（幂等：重复运行只会刷新文件）
 *   node install.mjs --dry-run  只打印计划，不写任何文件
 *   node install.mjs --remove   删除本脚本写入的 patch 条目（文件保留）
 *
 * 只做两件事，其它内容一概不碰：
 *   1. 把 lib/ 与运行清单复制到 %USERPROFILE%\.dsh\plugins\dsh-entry-transition；
 *   2. 在 %USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml 末尾追加
 *      （--remove 时删除）一段带标记 `# dsh-entry-transition (install.mjs)` 的 insert 条目。
 * 改 patch 前自动备份为 cordis.patch.yml.bak-hsx-install（仅在没有备份时写一次）。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Package root (the unpacked plugin folder this script lives in). */
const root = resolve(dirname(fileURLToPath(import.meta.url)))

/** ASCII marker: everything this script writes into the patch carries it. */
const MARK = '# dsh-entry-transition (install.mjs)'
const ID = 'id: dsh-entry-transition'

const argv = process.argv.slice(2)
const dry = argv.includes('--dry-run')
const remove = argv.includes('--remove')

const log = (line = '') => process.stdout.write(line + '\n')
const fail = (message) => {
  process.stderr.write('error: ' + message + '\n')
  process.exit(1)
}

if (argv.includes('--help') || argv.includes('-h')) {
  log('node install.mjs [--dry-run | --remove]')
  log('  (no flag)  安装：复制文件 + 向 profile patch 追加 insert 条目')
  log('  --dry-run  只打印计划')
  log('  --remove   删除本脚本写入的条目（文件保留）')
  process.exit(0)
}

const home = process.env.USERPROFILE || process.env.HOME
if (!home) fail('环境变量 USERPROFILE/HOME 不存在 —— 请在普通用户终端里运行')

const pluginDir = join(home, '.dsh', 'plugins', 'dsh-entry-transition')
const patchPath = join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
const backupPath = patchPath + '.bak-hsx-install'

/** Loader 条目：始终输出百分号编码后的纯 ASCII file URL。 */
const entryUrl = pathToFileURL(join(pluginDir, 'lib', 'index.js')).href

/** 要追加的完整 YAML 段（末尾自带换行）。 */
const block =
  MARK + ' — 入场过渡：安装标记（删除本段即卸载）\n' +
  '- insert:\n' +
  '    - id: dsh-entry-transition\n' +
  '      name: "' + entryUrl + '"\n' +
  '      config:\n' +
  '        enabled: true\n' +
  '        overlay: true\n' +
  '        theme: true\n' +
  '        minVisibleMs: 2200\n' +
  '        readyTimeoutMs: 30000\n' +
  '        playOncePerSession: true\n'

// ---------------------------------------------------------------------------
// 1. 文件：lib/ + 运行清单（bundle 声明会被摘掉 —— 本地安装靠 file:/// 条目接线，
//    避免 loader 同时按 bundle 层再插一次）
// ---------------------------------------------------------------------------

const changed = []
const kept = []

function putFile(from, to) {
  const buf = readFileSync(from)
  if (existsSync(to)) {
    const current = readFileSync(to)
    if (current.equals(buf)) {
      kept.push(to)
      return
    }
  }
  changed.push(to)
  if (dry) return
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, buf)
}

function stageFiles() {
  const libDir = join(root, 'lib')
  if (!existsSync(join(libDir, 'index.js'))) {
    fail('当前目录里找不到 lib/index.js —— 请在解压后的插件目录里运行')
  }
  for (const name of readdirSync(libDir).sort()) {
    if (!statSync(join(libDir, name)).isFile()) continue
    putFile(join(libDir, name), join(pluginDir, 'lib', name))
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (manifest.dsh && manifest.dsh.bundle) delete manifest.dsh.bundle
  putFileManifest(join(pluginDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
}

function putFileManifest(to, text) {
  if (existsSync(to) && readFileSync(to, 'utf8') === text) {
    kept.push(to)
    return
  }
  changed.push(to)
  if (dry) return
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, text)
}

// ---------------------------------------------------------------------------
// 2. profile patch：只追加 / 删除带标记的那一个段落
// ---------------------------------------------------------------------------

function patchEntry(content) {
  const hasMark = content.includes(MARK)
  const hasId = content.includes(ID)

  if (remove) {
    if (!hasMark) {
      if (hasId) {
        log('patch 里有 dsh-entry-transition 条目，但不是本脚本写入的 —— 请手动编辑：')
        log('  ' + patchPath)
      } else {
        log('未安装：patch 里没有 dsh-entry-transition 条目。')
      }
      return
    }
    const lines = content.split('\n')
    const markAt = lines.findIndex((line) => line.startsWith(MARK))
    if (!lines[markAt + 1] || !lines[markAt + 1].startsWith('- insert:')) {
      fail('标记后的布局和预期不符 —— 请手动编辑：' + patchPath)
    }
    let start = markAt
    if (start > 0 && lines[start - 1].trim() === '') start -= 1
    let end = lines.length
    for (let i = markAt + 2; i < lines.length; i += 1) {
      if (lines[i].startsWith('- ')) {
        end = i
        break
      }
    }
    const joined = lines.slice(0, start).concat(lines.slice(end)).join('\n')
    const next = joined.endsWith('\n') ? joined : joined + '\n'
    if (dry) {
      log('[dry-run] 将从 patch 删除带标记的 insert 段：' + patchPath)
      return
    }
    writeFileSync(patchPath, next)
    const after = readFileSync(patchPath, 'utf8')
    if (after.includes(MARK)) fail('删除后校验失败 —— 请检查：' + patchPath)
    log('已删除 patch 条目：' + patchPath)
    log('文件仍在 ' + pluginDir + '（要彻底卸载可直接删除该目录）')
    return
  }

  if (hasMark) {
    log('patch 条目已存在（本脚本写入），跳过 —— 只刷新文件')
    return
  }
  if (hasId) {
    log('patch 里已有 dsh-entry-transition 条目（手工配置），不动 patch —— 只刷新文件')
    return
  }
  const base = content.replace(/\s*$/, '') + '\n'
  const next = base + '\n' + block
  if (dry) {
    log('[dry-run] 将备份原 patch 为：' + backupPath + (existsSync(backupPath) ? '（备份已存在，不覆盖）' : ''))
    log('[dry-run] 将向 patch 追加 insert 段：' + patchPath)
    return
  }
  if (!existsSync(backupPath)) {
    writeFileSync(backupPath, content)
    log('已备份原 patch：' + backupPath)
  }
  writeFileSync(patchPath, next)
  const after = readFileSync(patchPath, 'utf8')
  if (!after.includes(MARK) || !after.includes(ID)) fail('写入后校验失败 —— 请检查：' + patchPath)
  log('已向 patch 追加 insert 段：' + patchPath)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

if (dry) log('[dry-run] 只打印计划，不写任何文件')
if (/[^\x00-\x7F]/.test(pluginDir)) {
  log('提示：用户路径含非 ASCII 字符，loader 条目会写成百分号编码的 file URL（此形态未经实测；若加载失败请改放纯 ASCII 路径）。')
}

if (!remove) {
  stageFiles()
  log('文件：' + pluginDir + ' —— 更新 ' + changed.length + ' 个，未变 ' + kept.length + ' 个')
}

if (!existsSync(patchPath)) {
  const profilesRoot = join(home, '.dsh', 'profiles')
  const available = existsSync(profilesRoot)
    ? readdirSync(profilesRoot).filter((name) => existsSync(join(profilesRoot, name, 'cordis.patch.yml')))
    : []
  fail('找不到 profile patch：' + patchPath + (available.length ? '（有 patch 的 profile：' + available.join(', ') + '）' : ''))
}
patchEntry(readFileSync(patchPath, 'utf8'))

if (!remove) {
  if (!dry) log('安装完成。重启 DeepSeek Harness（或刷新页面）即可看到入场过渡。')
  log('卸载：node install.mjs --remove')
}
