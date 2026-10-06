# 工作台皮肤（工业风过渡画面 + 深色令牌皮肤）

给 DSH Web 界面加一层"进入工作台"的过渡画面，并把整套配色/字体换成简约的深色工业风。
参考了用户提供的官网进入过渡画面的**手感**，但所有文案与图形都是中性的工程词汇，
**不含任何游戏相关字眼**（见 `DESIGN-SPEC.md` §3.3 白名单）。

进入界面时先**安静地把外壳加载好**，再**一笔一画写出** `DEEPSEEK HARNESS`，最后划出色块：

0. **静默加载**：过渡层立刻铺满屏幕并停在一帧完整静止的画面上（只有 `00 / 00` 与底色），
   此时外壳在它后面加载应用。写字动画用 `animation-play-state: paused` 按住，由外壳的"就绪"信号
   （`[data-dsh-boot]` 被移除）放行；放行前还会**等主线程持续安静 700ms**（任何一帧超过 20ms 都重新计时，
   上限 3s，最后再交给浏览器的空闲回调）——见下方"开场卡顿的根因"；
1. **一笔一画写字**：放行后，名字不是文字，而是一套**手写的单线笔画骨架**（9 个字母的骨架拼出 15 个字母、27 条笔画）。
   每条笔画用 `stroke-dashoffset` 从起点画到终点，延迟按"第几个字母 + 字母内第几笔"拉开，
   于是笔尖从左往右走、每个字母的笔画依次跟上。**最后一个字母的最后一笔落在 `1.51s`**，这是下面所有等待的基准；
2. **色块出现**：名字画完后等到 `2.6s`，左边缘出现 2px 色块细条（`0.22s`）；
3. **色块横扫**：细条展开成整幅高度的色块，向右划过整个视口（`0.9s`）；
4. **铺满 + 淡出**：补满剩余区域（`0.32s`），整层淡出（`0.46s`）。整段离场 `1.9s`。

### 卡顿：实测数据（2026-10-04，真实时钟 + 真实合成器）

之前所有优化都是猜的（沙箱里 rAF 只触发一次、`performance.now()` 被虚拟化）。改成真实环境后
`harness/measure-frames.mjs` 量出的**实际数字**：

| variant | 帧时间中位数 | p95 | 超 20ms 帧 | 推进一帧动画的主线程成本 |
|---|---|---|---|---|
| isolated（只有过渡层） | 16.7ms | 16.7ms | 0 | **0.023ms** |
| baseline（+合成负载） | 16.7ms | 16.8ms | 0 | 0.023ms |
| heavy（5400 节点重负载） | 16.7ms | 16.8ms | 0 | 0.035ms |

**两个结论**：
1. **写字动画本身几乎不花钱** —— 推进全部 27 条笔画动画只要 **0.02–0.035ms**，占 60Hz 帧预算的 **0.2%**。
   所以"减笔画"、"换揭示机制"这类优化全是白费力气。
2. 真正的问题是 **GPU 显存**。这台机器是 `AMD Radeon 610M`（**512MB** 专用显存）+ `RTX 5060 Laptop`，
   屏幕 **2560×1600 @165Hz**。而我为了"防卡"给三个整屏元素加了合成层：

| 合成层 | 物理像素（DPR 1.5） | 常驻显存 |
|---|---|---|
| `.hsx-boot`（`translateZ(0)` + `will-change`） | 3840×2400×4B | **37 MB** |
| `__bar::after`（`will-change: transform`） | 3840×2400×4B | **37 MB** |
| `__sweep`（`will-change: transform`） | 3840×2400×4B | **37 MB** |

**合计约 111MB 常驻贴图**，占核显专用显存的 **22%**，还要和正在启动的应用自己的层抢。
**这三个提升已经全部撤掉**（见下方根因 3）：实测撤掉后主线程成本只从 0.022ms 变成 0.023ms，
却释放了全部 111MB —— 这笔账不划算的部分是我当初加错了。
这就是"动画很轻但仍然卡"的原因 —— 卡在显存/带宽，不在主线程。

**修法：把这三个合成层全部撤掉**（本轮）。实测代价：主线程成本 0.022 → 0.023ms（可忽略）；
收益：释放约 111MB 显存。`check-markup.mjs` 现在反过来守卫这一点：
`no viewport-sized element is promoted to a compositor layer`、`the layer holds no resident GPU layer`。

`contain: strict` + `overflow: hidden` 仍然保留 —— 那才是把失效范围限制住、不让周围页面重绘的手段。

### 为什么之前误判成"写字动画卡"

机制上确实有区别（下表），但在**这台机器上它不是瓶颈**：

| | 动画属性 | 谁来执行 |
|---|---|---|
| 离场色块 | `translateX` | 合成器线程搬运图层 |
| 写字 | `stroke-dashoffset` | 主线程重新光栅化矢量 |

`stroke-dashoffset` 确实无法交给合成器，这点没错；错在我据此认定它是瓶颈。
**先量再改** —— 这是这轮最大的教训。
3. **每帧的 CSS 计算全部预先算好**：dash 几何与逐笔延迟原来写成 `var(--hsx-len)` 和四变量 `calc()` 表达式，
   浏览器要为 27 条笔画**逐元素、逐帧**重新求值。现在状态机在放行前把它们算成固定数值写进内联样式，
   每帧只剩光栅化，没有样式数学。CSS 里已不留 `hsx-len` / `hsx-part`；
   现在的遮块延迟是**一条** `calc()`（`--hsx-i` × `--hsx-cells`），不是 27 条内联值；
4. **把字形 SVG 的失效范围收进元素盒子**：原来用 `overflow: visible`，Chromium 无法把光栅化限制在元素边界内，
   每帧的失效区域被放大。现在把描边余量放进 `viewBox`（`-4 -4 108 118`），`overflow` 保持默认；
5. **撤掉全部合成层提升**（本轮，见上一节的显存账）：三个整屏元素各 37MB 常驻贴图 → 0。
   实测代价只有 +0.001ms 主线程。

> 两条设计决定，都是为了让开场不卡：
> **① 写字等就绪信号才开始**（否则笔尖跑在外壳加载最重的那一段上）；
> **② 离场等名字写完才开始**，所以"划出去"这一下落在外壳最忙的时间之后。
> 兜底：外壳一直不就绪时，`1.2s` 后强制放行写字；`readyTimeoutMs` 到点强制退场，不会永久冻住画面。
>
> **不变量（踩过五次坑，现在都有测试守着）**：
> **① 任何退场路径都必须先放行笔，并且等名字写完才允许动。**
> 第一次：外壳"卡死探测"比写字兜底更早触发，而退场没有放行笔 —— 画面从静止帧**直接划走，字根本没出现**。
> 第二次：就绪信号早到时 `exit()` 立刻离场 —— **名字刚起笔就被色块盖掉**。
> **② "名字写完"必须按最后一笔的真实落点算，不是名义时长。**
> 第三次：按 `write + hold` 只等到 2.4s，而末字最后一笔落到 **2.07s + 停顿**才真正结束 ——
> 色块在最后一笔收笔前就动了。现在 `nameMs` 由运行时按笔画错开公式算，`check-clock.mjs` 用它跟
> CSS 里色块的起手时刻直接比对（`the last stroke lands before the block may move`）。
> **③ 生成到浏览器的脚本里不能出现 Node 侧的标识符。**
> 第四次：`nameMs` 的计算里引用了模块常量 `WORDMARK`，而那段代码运行在浏览器里 ——
> `Uncaught ReferenceError`，**整个状态机当场死掉**：页面正常显示，但什么都不动。
> `check-markup.mjs` 现在会扫描生成的脚本体，禁止任何模块标识符和 host-only 全局泄漏进去。
> **④ 卡死探测按「真实时间」判定，不能按检查次数。**
> 第五次：`mark()` 同时被 16ms 轮询和 MutationObserver 调用，而过渡层自己会改 DOM，
> 所以"150 次检查"实际只过了约 1.2 秒而不是 2.4 秒 —— 会砍掉小一半写字动画。
> 现在用 `now() - stableSince >= 2400ms`。
>
> 兜底：外壳一直不就绪时，`1.2s` 后强制放行写字；`readyTimeoutMs` 到点强制退场，不会永久冻住画面。
>
> 为什么不用文字 + 动画：系统字体的字形是**封闭轮廓**，用 dash 描它只会得到"描边空心字"而且处处断口，
> 那是"字体在描边"而不是"人在写字"。所以要真正的一笔一画，只能自己提供笔画路径。

**画布永远取色块的相反色**，这样白块 / 黑块划过去才看得见：

| | 画布 | 大字 / 小字 | 划出的色块 |
|---|---|---|---|
| 深色主题 | 浅 `#f4f5f6` | 黑 `#0c0e10` | **黑 `#000000`** |
| 浅色主题 | 深 `#0b0d0f` | 白 `#ffffff` | **白 `#ffffff`** |

两组互为镜像：深色主题是"浅底黑字黑块"，浅色主题是"深底白字白块"（后者也是参考站那种深底浅字的观感）。
界面字体为圆润而正式的 `Segoe UI Variable`（Display + Text），代码用 `Cascadia Code`。

```
lib/theme.css     令牌皮肤：深/浅两套 --dsw-* 取值、圆角形状、外壳启动占位握手
lib/boot.css      过渡画面样式：笔画写字、色块时间轴与主题调色板
lib/index.js      宿主半：把上面三样 + 过渡画面 DOM 注入每一次 index 渲染；按字符拆分标题并判定主题
lib/client.js     客户端半：交接信号、清理自持样式
harness/          不依赖真实 GUI 的验证页与脚本（详见 §验证）
preview/          独立走查页（file:// 双击即可打开，无构建、无网络）
verify/           独立核验报告（参考站证据 + 本机外壳契约）
DESIGN-SPEC.md    设计与集成规范（单一事实源）
scripts/sync.mjs  把 lib/ 同步到运行时路径
```

## 安装

运行时路径必须是纯 ASCII，所以 `lib/` 会被同步到 `C:\Users\29316\.dsh\plugins\harness-skin`：

```powershell
node scripts/sync.mjs
```

该 profile 的 patch 层（`C:\Users\29316\.dsh\profiles\desktop\cordis.patch.yml`）末尾已插入：

```yaml
- insert:
    - id: harness-skin
      name: "file:///C:/Users/29316/.dsh/plugins/harness-skin/lib/index.js"
      config:
        enabled: true
        overlay: true
        theme: true
        minVisibleMs: 2200
        readyTimeoutMs: 30000
        playOncePerSession: true
```

> 全屏不在皮肤里配：窗口尺寸只能由原生侧改，见下面的「全屏」一节。

改完 `lib/` 后执行 `node scripts/sync.mjs`，然后**刷新页面**；若启动器只在启动时读 patch，则重启桌面应用。
原 patch 备份在 `cordis.patch.yml.bak-hsx`。

## 分发（打包成可下载插件）

一条命令产出可分享的插件包（打包器自检：文件清单 / 逐字节一致 / manifest 契约 /
bundle patch 形态 / 禁词 / 语法 / 解包回读，任一失败退出码 1）：

```powershell
node tools/package-plugin.mjs
```

产物（`dist/`）：

| 文件 | 给谁 | 怎么装 |
|---|---|---|
| `harness-skin-1.0.0.zip` | 任意用户 | 解压 → `node install.mjs` → 重启应用（离线安装，先备份 patch，幂等） |
| `harness-skin-1.0.0.tgz` | npm/pnpm 生态 | profile 目录里 `pnpm add` + 把包名加进 `dsh.profile.bundles`（包内 `cordis.patch.yml` 作为 bundle 层自动接入） |

安装细节、不跑脚本的手动三步、卸载，见包内 `INSTALL.md`。
`node verify-all.mjs` 的第 9 项会重新构建并验收这两个产物。

## 关闭 / 卸载

| 想要的效果 | 做法 |
|---|---|
| 临时关掉过渡画面，保留配色 | `config.overlay: false` |
| 临时关掉配色，保留过渡画面 | `config.theme: false` |
| 全部关掉 | `config.enabled: false` |
| 完全卸载 | 删除 patch 里那段 `- insert:`，或用 `cordis.patch.yml.bak-hsx` 还原 |

关掉后 GUI 恢复原样：皮肤只通过 index 注入的 `<style>` 与一个 `html` 上的 `data-hsx-*` 属性生效。

## 调试开关（URL 参数）

| 参数 | 效果 |
|---|---|
| `?hsx=off` | 跳过过渡画面（并在本次会话记住）——**全屏仍然生效** |
| `?hsx=only` | 过渡画面常驻，按 ESC 退场 |
| `?hsx=slow` | 进/离场时长 ×3 |
| `?hsx=drawing` | 定格在笔尖停在半途（截图用） |
| `?hsx=write` | 定格在前半段名字已写完（截图用） |
| `?hsx=still` | 定格在名字全部写完、色块细条 62%（截图用） |
| `?hsx=sweep` | 定格在色块横扫 46%（截图用） |
| `?hsx=flood` | 定格在整层铺满（截图用） |
| `?hsx=debug` | 调试模式（探针现在默认就在写字阶段采样，不依赖它） |

其他可用入口：`window.__HSX__.dismiss()` 手动退场，`window.__HSX__.state` 读状态；`document.querySelector('[data-dsh-boot]')` 是外壳启动占位。

## 全屏（窗口级，由启动器负责，不是皮肤负责）

**皮肤不碰全屏。** 早期版本用网页 Fullscreen API，结果是"先弹出小窗 → 写字 → 中途变大"，
而且退出方式别扭 —— 已删除，并加了守卫断言（`the skin never drives the fullscreen api`）。

现在由**启动器**在校外完成：

- 桌面外壳用 `BrowserWindow({ width: 1280, height: 820, show: false, titleBarStyle: 'hidden' })` 开窗，
  并且**只**把 `dsh-desktop:window-fullscreen` 做成 `main → renderer` 单向通道；
  渲染层是 `sandbox: true + contextIsolation: true + nodeIntegration: false`。
  也就是说**窗口尺寸只能从原生侧改**，页面里没有任何受支持的途径。
- 所以做法是：快捷方式先拉起程序，然后一个小工具**轮询等待窗口出现（每 40ms，最多 30s），
  在它还没被画出来之前就最大化**。外壳要等渲染层加载完才 `show()`，所以尺寸在你看到第一帧时就已经是对的。

装/卸：

```powershell
node tools/install-fullscreen-launcher.mjs          # 编译工具 + 改快捷方式（自动备份）
node tools/install-fullscreen-launcher.mjs --remove # 还原快捷方式 + 删除落地的两个文件
```

它做了什么、以及怎么反悔：

| 项 | 说明 |
|---|---|
| 改了哪个快捷方式 | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk` |
| 改成什么 | `wscript.exe "G:\DSH\dsh-fullscreen.vbs"`（窗口样式 7，点它不会闪黑框） |
| 备份在哪 | 同目录 `DeepSeek Harness.lnk.orig-hsx`，`--remove` 会自动还原 |
| 落地文件 | `G:\DSH\harness-fullscreen.exe`（8KB，源码 `tools/harness-fullscreen.cs`）、`G:\DSH\dsh-fullscreen.vbs`、以及诊断日志 `G:\DSH\dsh-fullscreen.log` |
| 启动器铁律 | **任何情况下都不弹对话框**（找不到文件就静默退出），安装脚本会断言这一点 |
| 启动器第二铁律 | **只用 WSH 5.8 一定存在的 API**。快捷方式用样式 7 隐藏运行，脚本里的运行时报错会被**完全吞掉**：不弹框、看不到退出码，程序看起来就像"没走启动器"。踩过的坑：`WshShell.CurrentEnvironment` 在 WSH 5.8 里并不存在，一调用就抛错，表现就是"启动器毫无反应、日志也不写"。安装脚本现在会断言代码里没有 `CurrentEnvironment` / `Environment()` / `Exec()` 这类 API |
| 为什么要"盯一会儿" | 外壳是在窗口**隐藏**时创建的，随后 `show()` 会重新施加自己的 1280×820，把先前的最大化**覆盖掉**。所以工具会：① 在窗口第一次被绘制前先最大化（你看不到跳变）；② 之后 8 秒内每 60ms 检查一次，发现被还原就立刻再最大化（`--settle 8`） |
| 诊断日志 | `G:\DSH\dsh-fullscreen.log`（UTF-16）：记录找到窗口时的状态、首次最大化、每次"再最大化"、最终状态。启动异常时先看它 |
| 手动还原 | 双击 `DeepSeek Harness.lnk.orig-hsx` 覆盖回去，或 `--remove` |

想自己按快捷键：`Win + ↓` 退出最大化，`F11`/双击标题栏 再最大化。
**被最大化的只是窗口，任务栏还在**，所以随时能切走 —— 这也是你选的那种"全屏"。

## 验证

```powershell
node verify-all.mjs
```

按顺序做这些事，任一步失败即非零退出：

1. **同步检查** — `lib/` 与运行时副本一致。
2. **宿主半注入契约** — 直接调用 `apply()`，断言它请求 `webServer`、只注册 `webserver/index-inject`、并推送 `style / style / html:body / script:body` 四行。
3. **真实 index 渲染** — 用发行版 `dist/index.html` 与 `renderIndexInjections`，断言令牌样式落在 `</head>` 之前、过渡层 DOM 落在 `<body>` 之后且位于 `#div#root` 之前、脚本在 DOM 之后。
4. **注入脚本语法** — 用 `new Function` 解析内联脚本，确认没有 `</script>` / `</style>` 提前闭合。
5. **令牌级联** — 无头 Edge 打开 `harness/cascade.html`：皮肤样式表排在主题插件样式表**之前**（比真实顺序更苛刻），断言深/浅两种模式下 `body` 与其后代的 64 项计算值全部命中皮肤取值。
6. **过渡层几何** — 无头 Edge 打开 `harness/probe.html`，断言 12 项版式关系（标题/分隔线/说明的先后、读数与右上信息对齐到同一内边距、单位与数字基线一致、底部进度条贴底等）。
7. **状态机** — 无头 Edge 跑 `harness/index.html`：正常路径下过渡层最终从 DOM 移除；`?stuck=1`（模拟插件激活失败）下也会退场并释放 `html[data-hsx-boot]`。
8. **无游戏字眼** — 全仓扫描禁用词表。

单条命令也可以单独跑：

```powershell
node harness/build-cascade.mjs      # 重建级联验收页
node harness/build-probe.mjs        # 重建几何/调色板探针页
node harness/build.mjs              # 重建注入真值页（状态机 + 外壳模拟）
node harness/build-iso.mjs [--hsx-mode=drawing|write|still|sweep|flood] [--theme=dark|light]
node harness/render-index.mjs       # 只跑真实 index 渲染
node harness/inspect-wordmark.mjs   # 只看骨架：几个字母、几条笔画、多宽
node harness/measure-wordmark.mjs   # 浏览器里量每个字母框的真实尺寸
node harness/check-markup.mjs       # 只跑 DOM/脚本/样式契约
node harness/check-layout.mjs       # 只跑深/浅两种模式的几何与调色板
node harness/check-clock.mjs        # 只跑"时钟真的生效了吗"（读浏览器解析后的秒数）
node harness/check-phases.mjs       # 只跑写字分段与离场时间轴
node harness/build-seq.mjs          # 重建时序里程碑页（真值页 + 里程碑记录）
node harness/check-sequence.mjs     # 只跑"先放行笔、再退场"的时序断言（4 种交班场景）
node harness/measure-frames.mjs     # 【真实环境】量帧时间 + 推进一帧动画的主线程成本（对比 5 种变体）

> 旧的 `harness/build-phase.mjs` 已被 `build-iso.mjs --hsx-mode=…` 取代。
```

## 设计要点（实现时踩过的坑）

- **令牌必须写在 `body` 上**：发行版的 `--dsw-*` 别名声明在 `body` / `body[data-ds-dark-theme]`，
  写在 `html` 上的值对 `<body>` 内部是不可见的（元素自身声明优先于继承）。皮肤因此用同样的两个选择器 + `!important`。
- **为什么需要 `!important`**：主题插件是在客户端阶段把样式表追加到 `<head>` 的，位置在宿主注入的 `<style>` **之后**；
  同优先级下后者胜，所以只能靠 `!important` 保证皮肤权威。
- **`--dsw-elevation-*` 不覆盖**：插件把它重新声明在 `body, body *` 上，继承值会被每个后代覆盖，因此皮肤不管它。
- **圆角靠 `corner-shape: round` 而不是改半径**：设计系统默认 `superellipse(1.5)`，在 Chromium 里圆角看着像被削方；
  自带组件的圆角尺寸本来就不大（2–12px），所以把 `--dsw-corner-shape` 改成正圆就是"小圆角框"。
  过渡层反向声明 `corner-shape: square`（仪表不该是面板）。
- **字体从窄体换成圆润体**：`Bahnschrift`（窄体、工业）在第一轮用着合适，但用户要求"圆润一点但正式"，
  于是换成 Windows 的人本无衬线 `Segoe UI Variable`（Display 带头部、Text 带正文），代码用 `Cascadia Code`。
  换字体时记得同步 `--dsw-font-family`、`--ds-font-family-code` 以及过渡层自己的 `font-family` 三处。
- **"写字"必须用笔画路径，不能拿字体凑**：试过三种做法——整行 `mask-image` 横扫（读起来是"整块被揭开"）、
  每个字符独立淡入（只是"逐字出现"，不是"一笔一画"）、对系统字体做 `stroke-dashoffset` 描边
  （字形是**封闭轮廓**，描出来是空心字而且 E/N/A 处处断口）。
  最终做法：自己提供 `STROKE_GLYPHS` 单线骨架，一条 `<path>` 就是一笔，dash 沿笔画走。
  样式里刻意不出现任何 `mask-*`，`check-markup.mjs` 会断言这一点。
- **离场是四段式**：① 一笔一画写字（1500ms + 700ms 停顿）；② 左边缘出现 2px 色块细条（220ms）；
  ③ 细条展开成整幅高度的色块向右划过视口（900ms）；④ 色块铺满（320ms）后整层淡出（460ms）。
  **划出去的就是色块本身**（`--hsx-block`，即该主题的底色），不是"先划一条线再补色"。
  **所有时长都必须写成 `calc(<base>ms * var(--hsx-k))`**：这一个变量同时承担 `?hsx=slow`（×3）与
  reduce（×0.45）。曾经踩过的坑是变量声明了却没被任何 `calc()` 引用，结果慢放/减弱动效对离场完全无效；
  现在 `harness/check-markup.mjs` 静态断言每个阶段都缩放了，`harness/check-clock.mjs` 再从浏览器读取
  **解析后的秒数**复核（4.1s / 12.3s / 1.845s），只靠静态检查抓不到这类问题。
- **退场时间轴锚定在 `.hsx-boot--leaving`**：CSS 的各个延迟与 JS 的收尾定时器都从加这个类的同一刻起算，
  两边不可能漂移；色块细条的延迟也是那时才开始算（提前跑会让它在外壳还没就绪时就填满）。
- **静帧不能靠动画**：headless 的 `--virtual-time-budget` 会把动画直接跳到终态，
  所以定格一律用显式属性（`stroke-dashoffset: calc(var(--hsx-len) * 0.52)`、`transform: scaleX(.46)`），
  见 `harness/build-iso.mjs`；`?hsx=drawing` 就是靠这个才拍到了"笔停在半途"的那一帧。
- **作者 `!important` 会顶掉 CSS 动画**：色块细条原来写成 `height: 100% !important` + `hsx-rail`，
  结果那条 `!important` 让动画彻底失效（作者 important 声明优先级高于动画），220ms 的生长根本不播。
  已删掉 `!important`，靠 `forwards` 保持终态；`check-markup.mjs` 加了守卫断言。
- **笔画没写到时会留下小圆点**：Chromium 会给被 offset 藏起来的 dash 也画上圆头端点，
  所以"看不见"不能只靠 `stroke-dashoffset`，必须让整条路径在轮到自己之前 `opacity: 0`。
  现在整套虚线机制已被**遮块滑走**取代（`hsx-slide` 纯 `transform`），这个坑自然消失。
- **错开是"逐字母"而不是"逐笔画"**：早期版本把一个字母里的笔画按 120ms 拉开（`--hsx-part`），
  字母是"分几次"冒出来的。27 个遮块 → 15 个同时动的元素，且字母一次成型 —— 这是 5 个变体
  在真机上逐一对比后选定的。CSS 用 `--hsx-i`（字母序号，标记内联）× `--hsx-cells`（词长，容器上一次写入）算延迟；
  `harness/check-stagger.mjs` 守卫这一点。
- **宿主脚本是模板字符串**：`lib/index.js` 里回传给浏览器的脚本本身写在反引号模板里，
  所以**脚本正文里不能出现反引号**（哪怕在注释里）——一旦出现就会提前闭合模板，
  报错却是莫名其妙的 `Unexpected identifier 'timeline'`。`harness/check-markup.mjs` 有一条专门的守卫断言。
- **就绪信号**：外壳在挂载应用的同一个 commit 里移除启动占位 `[data-dsh-boot]`，这是最可靠的交接点。
  插件激活失败时占位不会消失，所以皮肤还有"占位内容 2.4s 不变即强制退场"的兜底，
  避免把失败卡片盖在过渡层下面。
- **无头截图不可靠**：headless Edge 的 `--virtual-time-budget` 只推进定时器、不推进合成器动画，
  直接截图多半拍到初始帧。验证因此以"计算样式 / 几何测量 / DOM 断言"为准；
  阶段静帧用 `harness/build-iso.mjs` 把动画钉死在终态再截。
- **开场卡顿的根因**（每一条都由实测或用户反馈定位，并加了静态守卫）：
  0. **动画和外壳启动抢主线程** —— 这是最主要的一条。原先写字动画从页面加载就开始，
     正好压在外壳加载应用最重的那一段上。现在写字**等就绪信号 + 持续安静 700ms** 才放行，离场**等名字写完**才开始，
     于是整段动画都跑在安静的主线程上。
   1. **放笔兜底定时器抢跑了就绪信号** —— 真机实测外壳就绪在 ~2.1s，而兜底 1.2s 就开枪，笔撞上
      挂载期一次 **237ms** 的大帧（用户能"感觉到"的就是它）。兜底改 4s，且**所有非就绪放笔路径
      都走安静门**（`releaseWhenIdle`）。
   2. **就绪被处理了不止一次** —— 占位观察器在挂载期一直触发 `mark()`，每次重入 `onReady`：
      又开一个安静等待、又把就绪时间戳往后覆盖（这就是 `quietWait` 量出来恒为负的元凶）。
      现在 `onReady` 有 `if (ready || dismissed) return` 守卫，只处理一次。
   3. **"6 帧安静"太弱** —— 165Hz 下 6 帧只有 ~36ms，挂载期爆发帧轻松藏在后面。现在是
      **持续 700ms 干净帧**（超 20ms 重新计时，上限 3s）+ 浏览器空闲回调。
  1. **细条用 `height` 做动画** —— 每帧重新布局整个过渡层。现在改成 `transform: scaleY()`，纯合成。
  2. **离场用 `scaleX` 铺满整屏** —— 视口大小的元素每帧都要重新光栅化。现在改成
     **`translateX` 滑动一张已经画好的整屏缓冲**（`-100% → 0`），合成器直接搬运图层、不重绘。
  3. **给三个整屏元素加 `will-change` 提升合成层** —— 2560×1600 + 512MB 核显上每个贴图 ~37MB，
     常驻 111MB 等于自造显存争抢（我为"防卡"加的，反而有害）。现已全部撤掉。
  4. **`stroke-dashoffset` 逐笔画** —— 27 条矢量每帧重光栅化。改成**遮块揭示**（纯 `transform`），
     错开从"逐笔画"改成"逐字母"（5 个变体实机对比后用户选定的最优：字母一次成型、同时动的元素减半）。
  5. **★ 遮块是 SVG 子元素，所以动画不在合成器上** —— 最后、也最隐蔽的一条。
     帧数据说明问题不在动画本身（中位 **6ms**，165Hz 原生），而在应用启动期主线程的几次 **~170ms** 阻塞。
     Chromium 会把 **HTML 元素**的 `transform` 动画交给合成器（主线程被堵也继续滑），**SVG 子元素的不交** ——
     所以主线程一堵，遮块就冻住。用户的原话"字底下的小光标连贯、字卡"正是这条机制差别（光标是 HTML 元素）。
     现在遮块是 **HTML 元素 + `will-change: transform`**，一个字母一块、`scaleX(1→0)` 收缩揭示；
     因为只在自己格子里收缩，**27 个 rect + 54 个 clipPath 全部删掉**。
     证据（真实 trace）：`Paint` 从 **168 次/4s（≈42 次/秒）** 降到 **1.6 次/秒**，同时
     `AnimationHost::TickAnimations` 持续 tick —— 动画确实跑在合成器上。
  守卫在 `harness/check-markup.mjs`：`the layer holds no resident GPU layer`、
  `no viewport-sized element is promoted to a compositor layer`、`the cover is promoted to its own compositor layer`、
  `the reveal animates a compositor transform`、`the pen waits for sustained idleness, with a backstop`、
  `readiness is handled once`、`the fallback kick is later than the shell and goes through the quiet gate`；
  另有 `check-release.mjs`（放行与暂停配对）、`check-stagger.mjs`（逐字母错开）、`check-clock.mjs`（时序）、
  `check-composited.mjs`（**抓 trace 断言"没有逐帧重绘"**，把遮块挪回 SVG 会立刻失败）。
- **为什么这里量不出帧率**（两次尝试都撞墙，记录以免重走）：
  1. `--virtual-time-budget` 下 **`requestAnimationFrame` 只触发 1 次**（实测 `raf=1`，而 `setInterval` 跑了 126 次），
     所以按帧采样的脚本永远测不到数据；
  2. 同一模式下 **`performance.now()` / `Date.now()` 也被虚拟化**，量到的"耗时"恒为 0；
  3. `--dump-dom` 在 load 就返回，拿不到动画结束后的结果；loopback HTTP 被沙箱挡住，页面无法回传。
  结论：沙箱内**没有可用的真实时钟**（rAF 只触发 1 次、`performance.now()` 恒为 0、`--dump-dom` 在 load 就返回），
  所以仓库里不留假装能测的脚本。真机帧率靠**有界探针**：只在写字阶段采样 ≤3s 自动停，结果写
  **localStorage（退出不丢，主通道）** + `window.__HSX__.perf`，收集器在线时还会 beacon 过来。
  读取命令：`node harness/read-storage.mjs`（应用运行中也能读，共享读已验证）。
  实测基线：**中位 6ms（165Hz 原生帧）**；修复前问题是 `worst=237ms` 的单次大顿挫 + `quietWait` 为负。

## 已知取舍

- 皮肤不做"完全体主题包"：只覆盖用户实际会看到的语义令牌（背景/层级/描边/文字/状态色/气泡/侧栏/按钮/滚动条），
  没有碰几百个 `--dsw-static-*` 调色板原子值。
- 浅色模式是"不破坏"级别的兜底（可读、协调），主推深色。
- 过渡画面每次浏览器会话只播一次（`sessionStorage`）；想要每次都播，把 `playOncePerSession` 设为 `false`。
- 圆角只改"形状"不改半径：各组件沿用设计系统自己的半径（气泡 8–12px、菜单 6px 等）。
- `preview/` 下的独立走查页是评审伴生件，真实行为以 `lib/` + 实机为准。
