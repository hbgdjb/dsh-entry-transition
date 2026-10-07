# 安装说明（Harness Skin）

把「进入工作台时的入场过渡动画 + 深色工业风主题」装进 DeepSeek Harness。
二选一：**A 离线安装（推荐）** 或 **B 依赖安装（生态惯例）**。

## A. 离线安装（推荐，需要 Node.js）

1. 下载并解压 `dsh-entry-transition-1.0.1.zip`；
2. 在解压目录打开终端，运行：

   ```powershell
   node install.mjs
   ```

3. 重启 DeepSeek Harness（或刷新页面）。

脚本只做两件事，其余一概不碰：

- 复制 `lib/` 与运行清单到 `%USERPROFILE%\.dsh\plugins\dsh-entry-transition`；
- 在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加一段**带标记**的
  `- insert:` 条目；写入前自动备份为 `cordis.patch.yml.bak-hsx-install`（已有备份不覆盖）。

特性：**幂等**（重复运行只刷新文件）；`node install.mjs --dry-run` 只打印计划；
`node install.mjs --remove` 只删除带标记的段落。控制台若中文乱码不影响执行。

### 不方便跑脚本？手动三步

1. 把 `lib` 文件夹和 `package.json` 复制到 `%USERPROFILE%\.dsh\plugins\dsh-entry-transition\`；
2. 用记事本打开 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，在**文件末尾**追加
   （路径换成你的用户名，斜杠方向保持 `/`，文件保存为 UTF-8）：

   ```yaml
   - insert:
       - id: dsh-entry-transition
         name: "file:///C:/Users/你的用户名/.dsh/plugins/dsh-entry-transition/lib/index.js"
         config:
           enabled: true
           overlay: true
           theme: true
           minVisibleMs: 2200
           readyTimeoutMs: 30000
           playOncePerSession: true
   ```

3. 重启应用。

## B. 依赖安装（pnpm / 插件市场惯例）

在你的 profile 目录（桌面应用是 `%USERPROFILE%\.dsh\profiles\desktop`）执行：

```powershell
pnpm add "下载的目录\dsh-entry-transition-1.0.1.tgz"
```

然后在该目录 `package.json` 的 `dsh.profile.bundles` 数组里加上
`"dsh-entry-transition"`，重启应用。包内的 `cordis.patch.yml` 会作为 bundle 层
（package.json 的 `dsh.bundle.patch` 声明）自动接入，无需改 profile patch。

> 这条路径遵循生态惯例（dshmarket、dsh-session-shield 等插件都这么装），
> 但**未在本机逐项实测**；遇到问题请用 A 路径（与本机现役配置完全一致，已验证）。

## 卸载

| 安装方式 | 卸载 |
|---|---|
| A（脚本） | `node install.mjs --remove`，然后可删除 `%USERPROFILE%\.dsh\plugins\dsh-entry-transition` |
| A（手动） | 删掉 patch 里那段 `- insert:`（或把 `enabled` 改成 `false`），再删插件目录 |
| B（依赖） | 从 `dsh.profile.bundles` 移除包名并 `pnpm remove dsh-entry-transition` |

改 patch 时留下的还原备份：`cordis.patch.yml.bak-hsx-install`（A）、
`cordis.patch.yml.bak-hsx`（本机原配置）。

## 包里有什么

| 文件 | 作用 |
|---|---|
| `lib/` | 皮肤本体：宿主注入（index.js）、客户端脚本（client.js）、过渡画面（boot.css）、主题令牌（theme.css） |
| `package.json` | 包清单：`dsh.client` 声明、导出、bundle patch 声明 |
| `cordis.patch.yml` | 依赖安装时的 bundle 层（本地安装不读它） |
| `install.mjs` | 离线安装 / 卸载脚本（幂等、先备份） |
| `INSTALL.md` | 本文件 |
| `README.md` | 完整开发文档：卡顿根因记录、守卫清单、验证命令、调试开关 |

## 安装后

- 想改节奏 / 关闭 / 定格截图：见 `README.md` 的「调试开关」与「关闭 / 卸载」。
- 全屏由桌面启动器负责（若你用过 `tools/install-fullscreen-launcher.mjs`），皮肤本身不碰窗口。
