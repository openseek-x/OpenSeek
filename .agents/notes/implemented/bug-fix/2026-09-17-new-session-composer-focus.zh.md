# Agent Note: 新会话激活反馈

Status: implemented

[English](2026-09-17-new-session-composer-focus.md) | 中文

## 问题

一个 Workspace 会有意保留一个尚未提交消息的 blank Session。当这个 blank Session 已被选中时，全局「新建会话」操作会再次打开同一个身份。Conversation 树不会重新挂载，页面也没有导航变化。把焦点移到 composer 虽然让界面可以输入，但这个变化太不明显，无法确认点击已经完成。没有 Workspace 的新会话页面也缺少相同的可见反馈。

## 决策

Conversation 服务负责为 Session editor 和无 Session 的 Workspace 入口交付 composer focus。每个已挂载的 InputBar 绑定自己的聚焦操作。已挂载表面的请求会在导航完成后的 microtask 中执行；尚未挂载的表面会保留请求，直到对应表面完成绑定。后来的请求会替换较早的 pending target。

新会话会在 `openWorkspace` 的同步 preparation 回调中请求焦点。复用已选中的 blank 时聚焦现有 editor；新创建的 blank 会在 InputBar 挂载后消费 pending 请求。没有 Workspace 时，新会话会清空 Session 选择并聚焦常驻的 Workspace 入口。

空的真实 Workspace 标题会调用同一条新会话路径，而不是展开一个空区域。这样，没有附加 Session 的已注册 Workspace 就有一个可见的重试操作；已经包含 Session 的 Workspace 标题仍保留展开或折叠行为。

`UiWorkspace.startSession()` 会在导航尝试后报告 `ready`、`superseded` 或 `error`。侧边栏利用该结果先显示准备状态，再显示可见的已就绪确认，或带具体原因的失败横幅。被后续导航替代的请求会移除准备状态，不会宣称成功。

## 考虑过的替代方案

**每次点击都创建另一个 blank Session。** 这样可以产生可见的导航变化，但会积累未使用的空 Session，并放弃每个 Workspace 只保留一个 blank 的规则。

**清空选择后重新打开同一个 Session。** 让选择短暂经过空状态会引入不必要的 scope 与持久化变动，可能闪现无 Session 界面，而且焦点仍然依赖渲染时序。

**让侧边栏查询 composer DOM。** 侧边栏选择器会越过 package 所有权，绕过 Lexical 的焦点与选区恢复，并在目标 editor 尚未挂载时失效。

## 后果

新会话对 blank Session 数据仍保持幂等，而每次成功激活都会把键盘焦点移到可操作表面并显示完成确认。空 Workspace 行不会再停留为没有响应的灰色分组：点击它会创建或复用 blank Session，并聚焦 composer。复用 blank 时不会改变草稿或 Session 身份。焦点交付只有一个所有者，会保留 Lexical 选区，并处理导航先于 React 挂载新 composer 完成的情况。失败会直接显示，而不再只存在于控制台。

Conversation 服务测试覆盖已挂载与延迟绑定，InputBar 测试覆盖 editor 聚焦和 disposer 清理，Workspace 测试覆盖 ready、superseded 与失败结果，侧边栏测试覆盖准备中、已就绪、失败与被替代反馈。组装后的 Web 流程还会直接注册一个空 Workspace，点击其灰色标题，并验证 Host 附加一个 Session、新行被选中且 composer 获得焦点。打包 Desktop 流程验证：在已选中的 blank 上点击「新建会话」后，焦点会从按钮移到 composer，并显示已就绪确认。
