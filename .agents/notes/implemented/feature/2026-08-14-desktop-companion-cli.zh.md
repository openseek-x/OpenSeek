# Agent Note: 桌面 companion CLI 与锁定版本的包管理器

Status: implemented

[English](2026-08-14-desktop-companion-cli.md) | 中文

## Problem

桌面分发物内嵌 Host 和图形客户端，却没有为只安装桌面应用的用户提供受支持的 `dsh` 运行方式。因此，安装或更新外部 profile 组合包仍要求单独安装 Node.js、另一套独立版本的 CLI，并保证 `PATH` 上存在 pnpm，尽管应用已经携带匹配的 CLI 与 profile 运行时。这种拆分让插件管理脱离图形用户采用的主要安装路径，也可能使包管理器行为与已发布应用发生版本漂移。

## Decision

`@deepseek-ai/dsh` 将仓库锁定的 pnpm 版本声明为运行时依赖。插件命令从自身安装中解析 pnpm 入口，并通过 `process.execPath` 启动；它绝不从 `PATH` 查找包管理器。普通 npm 安装使用自身的 Node 可执行文件，桌面 companion 则设置 `ELECTRON_RUN_AS_NODE=1`，让 CLI 和 pnpm 两个进程都使用打包后的 Electron 可执行文件。

每次 profile 启动都会以该 profile 的 manifest（元数据清单）为裸包解析锚点。因此，无论是 Node 还是 Electron，都会先查找该 profile 的树外依赖，再查找 `$DSH_HOME/profiles/node_modules` 中修复后的安装依赖闭包，不受 workspace 提升方式或桌面包布局影响。

桌面打包器会在应用可执行文件旁写入一个轻量的公开启动器：macOS 应用内为 `Contents/MacOS/dsh`，Windows 安装目录内为 `dsh.cmd`，Linux 压缩包根目录内为 `dsh`。它还会在应用资源中写入私有的 `node` 与 `pnpm` shim，并且只把该目录加入 companion 进程树的 `PATH`，使包生命周期脚本能够解析内嵌运行时和锁定版本的包管理器。每个启动器都通过相对路径寻址已部署文件，POSIX 启动器还会追踪自身的符号链接目标，因此移动应用或为其创建链接后，启动器、CLI、内置组合包和包管理器之间的对应关系仍然成立。Companion 与图形应用使用相同的 `$DSH_HOME` 和 profile。启动器与 shim 会在原生应用签名前注入，因此它们始终位于签名覆盖的应用载荷内。

桌面容器不会把目录加入 `PATH`，也不会编辑 shell 启动文件。DMG 拖放安装和 Linux 压缩包解压不存在可信的跨平台安装事务来承载这项修改，静默更改用户的 shell 配置也超出了应用安装权限。用户可以直接调用安装后的路径，或自行在已加入 `PATH` 的目录中创建链接。

桌面应用中的 profile 包修改仍以重启为生效点。用户在执行 `add`、`update` 或 `remove` 前退出应用，完成后重新打开；companion 不尝试在正在运行的 Electron 进程中热切换代码。包生命周期脚本继续采用既有 pnpm 信任模型，并以宿主用户权限在 agent 沙箱之外执行。

## Verification

构建后 CLI 验收测试会在空 `PATH` 环境下安装本地组合包，证明插件命令使用声明的 pnpm 依赖，而不是宿主命令。Node 兼容性启动冒烟测试会从全新的 harness home 启动构建后的 Web 组合，证明其内置裸插件可通过修复后的安装依赖闭包解析。桌面打包冒烟测试会定位各平台启动器，清空 `PATH`，通过符号链接调用 POSIX 启动器，检查 companion 以及私有的 `node` 与 `pnpm` 命令，安装并激活一个本地 profile 组合包，再启动并检查图形应用。原生打包 job 会在两种 macOS 架构、Windows x64 和 Linux x64 上覆盖这条路径。实际安装各类容器以及通过用户管理的 Windows `PATH` 调用仍是接收方机器上的覆盖缺口。

## Alternatives considered

**继续把 npm CLI 作为独立前置条件。** 这能维持最小的桌面产物，但只安装桌面的用户仍无法管理插件，CLI 与包管理器版本也可能偏离它们所修改的应用。

**直接在图形设置页加入包安装。** UI 最终可以调用同一包管理机制，但还需要进度流、生命周期脚本信任决策、重启协调，以及包管理器部分失败后的恢复。Companion 会先建立一份经过测试的实现，再增加另一种呈现方式。

**自动修改 `PATH`。** Windows 具备安装器事务，但 DMG 和 tar 解压没有；不同用户和 shell 的启动文件也各不相同。逐平台实施隐式修改会导致安装行为不对称，而且难以安全撤销。

**再随附一套独立 Node 运行时。** 这样可以不使用 Electron 的 Node 模式，却会复制每个桌面产物中已有的大型运行时，并增加另一项版本与漏洞更新责任。

## Consequences

桌面安装会携带可移动、版本匹配的 CLI，无需系统 Node.js 或 pnpm 即可管理外部 profile 组合包。npm CLI 也会在不同宿主上获得确定的包管理器行为。浏览器、桌面与命令行启动继续使用同一批 profile 文件。

pnpm 载荷会增加 CLI 和桌面安装大小。用户把 companion 放置或链接到 `PATH` 之前，仍不能直接以裸名称 `dsh` 调用它；Electron 内嵌的 Node 运行时也是 CLI 执行路径的一部分。插件安装仍是需要明确给予信任的宿主操作，桌面组合变更也仍然需要重启。
