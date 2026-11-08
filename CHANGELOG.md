# Changelog

## [v0.7.27] - 2026-11-08

- fix(ui): 全屏查看器在 iOS 状态栏下让开 safe-area (39e3c2c2)
- fix(attachment): 路径引用在时间线可见，文本/图片预览修复 (c90acd39)
- feat(attachment): 按类型和大小分流，二进制只给路径 (9d717a8d)
- feat(mention): @ 菜单兼容反斜杠路径 (946e574e)
- fix(attachment): @ 提及回到 files[]，对齐官方 file/path 两种部件 (f7bc62e8)
- fix(sidebar): 连接状态点改用服务器健康状态，与设置页同源 (7d313a13)
- fix(models): 模型列表未使用模型按名称首字母排序 (e7951497)
- fix(slash-command): 斜杠命令匹配改为打分式模糊排序 (59f84120)

## [v0.7.26] - 2026-11-06

- perf(react): 稳定 useSyncExternalStore 订阅引用，避免每次渲染重绑 (35154609)
- chore(api): 删除已无引用的手写 SSE 解析器 (ab2629d9)
- perf(panel): 右侧面板首次打开前不再挂载 files/changes 内容 (6c690185)
- perf(sidebar): 不再为最近会话的每个目录打开 shell 库存 (3c03f935)
- fix(permission): 旧快照不再复活已经通过的权限请求 (1770f6ed)
- fix(desktop): 刷新后复用本机服务，不再重走完整启动流程 (81d3f19c)
- perf(session-list): 目录补拉批量合并，重连时强制补偿首屏 (16ec3f99)
- perf(server): 健康检查与探测降噪，快照引用稳定，SSE 状态与健康收敛 (40d0c6a5)
- perf(events): 全局状态接口只查一次，目录引用抖动不再触发刷新风暴 (782e9089)
- perf(api): 桌面端首请求固定走 Tauri fetch，避免 CORS 必败重试 (f0084a04)

## [v0.7.25] - 2026-11-02

- fix(markdown): 长公式支持横向滚动 (44800bdd)
- fix(attachment): 本机路径引用只写路径，不再整份读进 prompt.files[] (983bb028)

## [v0.7.24] - 2026-10-24

- feat(appearance): 抓取间隔改成可调滑杆 (d8a3565e)
- fix(appearance): 主操作按钮改成半透明磨砂 (9177c56d)
- feat(appearance): 抓屏背景支持录屏，并统一浮层材质 (a0e6f49a)
- feat(appearance): 桌面背景抓取（自绘档）与窗口背景模式 (83422e6c)
- fix(appearance): 权限/提问/websearch 弹窗与 Dialog 同一块玻璃 (fad989bd)

## [v0.7.23] - 2026-10-24

- fix(chat): 「移到后台」不再统计上一回合遗留的 shell (2952ccae)
- fix(input): 换行到顶时输入框工具条不再被裁掉 (15739390)
- fix(message): 折叠遮罩只作用于超长折叠消息 (af7eaafc)
- fix(appearance): 玻璃下主按钮、标签栏与状态点的质感 (c90cfd4e)
- chore(window): 记录最终选中的窗口材质，方便真机排查 (5fa185ed)
- feat(appearance): 窗口材质加降级链，无模糊时抬高染色 (86f21896)
- feat(appearance): 桌面端玻璃直接透出窗口背后的桌面 (7b88b3fc)
- fix(input): 忙碌时输入框底色不再被抬高 (bd1ae610)
- fix(input): 输入框单行高度不再随首字跳动 (abbc785e)
- style(appearance): 提高输入框描边光的色彩可见度 (95d473a6)
- fix(appearance): 全屏预览改用淡色叠层 (acfa4bfe)
- style(appearance): 输入框描边光放缓坡度并拉长光带 (e7359457)
- fix(appearance): 玻璃改用文字色叠层，开启时切深色 (833dde1a)
- feat(appearance): 补齐组件、浮层、编辑器与终端 (1f67c0d9)
- feat(appearance): 输入框与按钮改用中性玻璃质感 (f3c14549)
- feat(appearance): 玻璃外观与自定义壁纸 (46184e96)

## [v0.7.22] - 2026-10-23

- refactor(input): Android IME 兜底收敛为 useAndroidImeSafeTextarea (5b599f46)
- fix(input): Android WebView 全选删除后重建 textarea 节点 (69617707)
- fix(attachment): skill 附件展开后补上类型和技能 ID (1bf39b22)
- fix(message): 渲染用户消息里的 skill 附件 (acf287d6)
- fix(timeline): 文件变更收敛为描述性一行，diff 复用工具卡 (6c9c3387)
- fix(timeline): 压缩消息独立成行，失败提示不再被开关隐藏 (0418523f)
- fix(timeline): 文件 diff 改为行下展开，去掉套娃卡片 (e956ad4e)
- fix(timeline): 回合文件变更改为正文末尾的卡片 (d9ee30c4)
- chore(preview): 增加时间线 UI 的浏览器预览页 (e921d91b)
- fix(timeline): 提示行统一为分隔线样式，并新增默认关闭开关 (af50264c)
- feat(session): 实时处理 session.moved 并渲染移动提示 (45bf6945)
- feat(timeline): 补齐切换记录、压缩排队与回合 diff 的渲染 (8c9e02e1)
- fix(message): 重试卡片显示实时倒计时 (9d5e40c8)
- fix(attachment): file:// 附件地址按段编码 (95e19efc)
- fix(files): 切换预览标签不再改变标签顺序 (5b8be80d)
- fix(events): 切回前台复核半开连接，短时切屏保持懒连接 (f8490164)
- perf(session-list): 目录补拉按官方页大小一次拿满 (9e20a5ea)
- refactor(session-list): 搜索改官方口径，本地匹配 + 会话 ID 回读 (73874945)
- fix(session-list): 搜索补全结果跟服务器绑定，切服务器不串 (1414f17a)
- docs(session-list): 记录 session.list 的实测语义 (9ae6b1e7)
- fix(session-list): 索引没覆盖的旧会话也能搜到 (a60ff2a5)
- fix(session-list): 重连撞上在途拉取时，落地后再补一次 (58282d64)
- fix(session-list): 服务器被删除时释放索引与事件订阅 (6ec8625e)
- fix(session-list): 翻页以当前目录为准，去掉 2000 条硬上限 (ff89068c)
- perf(session-list): 首屏只拉一页 200 条，不再自动续页 (a5fee557)
- fix(session-list): 当前目录被挤出索引时按目录补拉一次 (4b9c4119)
- fix(session-list): 展开量跟随目录，切走再切回来不跳 (eeeee4f9)
- perf(session-list): 每台服务器一份会话索引，切目录不再发请求 (ddec0aad)
- perf(session): 进会话复用列表元信息并预取首屏，恢复动作让出首屏路径 (c8f8bfe6)
- fix(api): 相对 baseUrl 补全为绝对地址 (1c78fed7)

## [v0.7.21] - 2026-10-20

- fix(server): 健康检查探当前生效地址，不再盯着列表第一行 (e846d751)
- fix(settings): 地址列表默认收起，多入口不再把卡片撑成半屏 (46c1b259)

## [v0.7.20] - 2026-10-20

- refactor(settings): 地址列表成为唯一数据源，去掉重复的 URL 输入框 (82481049)
- feat(settings): 地址列表可手动增删排序，多地址不再只能靠重新配对 (0ccecccf)
- test(e2e): 真实服务端上的多地址探测、切换与延迟验证 (a6163db2)
- feat(server): 同一服务器支持多地址，内网优先、不可达降级、恢复后切回 (720e6a25)
- fix(reconnect): 网络恢复时主动重建半开连接，补齐面板补偿拉取 (35a7f7a8)
- fix(mobile): 触摸目标改为显式 opt-in，手机不再把按钮单方面顶高 (8e02ce37)
- style(markdown): 内联代码改用 0.875em/19px 的行内配比，修正垂直不居中 (08877a09)
- fix(reasoning): 折叠行里的行内代码去掉盒子，不再被裁掉上下边框 (ef948762)

## [v0.7.19] - 2026-10-18

- style(markdown): 内联代码改用 flex 居中 + 细描边的紧凑 chip (8032ff23)
- style(markdown): 内联代码改成传统 chip 样式（等宽 + 淡底 + 内边距） (7120317f)
- style(markdown): 内联代码改成传统样式（等宽 + 淡底 chip，颜色继承正文） (236c65f9)
- fix(chat): 修掉文件夹拦截的两个漏洞（i18n 键位置 + 兜底把文件夹捞回来） (9e49a4cb)
- fix(chat): 拖入文件夹一律拦下，不再发起上传 (24956292)
- change(settings): HTML 渲染默认改为关闭 (ea9750d9)
- refactor(preview): 确认弹层去掉体积兜底，diff 永远照常渲染 (996ce0a9)
- refactor(preview): 确认弹层去掉「保存/放弃」的说明文案 (14b6118f)
- refactor(preview): 删掉编辑态的保存状态栏 (8b3af9f2)
- refactor(preview): 确认弹层改用工具卡片那套 DiffView（文件名/统计/全屏） (36e31e54)
- style(panels): 统一右侧面板标签头部动作图标的配色 (934818b2)
- fix(hooks): useAutoRefresh 真的调用 onFilesystemChanged（B4 之前是死代码） (8e24a6a3)
- test(preview): 补保存事务的自动化测试（需求三 F14 第一批） (627da35c)
- feat(preview): 写入安全边界 + 混合行尾兜底（需求三 E12/13、D10） (6a5b25cf)
- feat(preview): 关闭拦截 + 保存状态栏（需求三 C7/C8） (372a506f)
- feat(preview): 外部改动落到界面 + 写后校验（需求三 B4/B6） (601e24d0)
- feat(preview): 外部改动捕获 + 自写抑制（需求三 B4/B5 数据通路） (79f27baf)
- feat(preview): 保存 / 放弃改动都走带 diff 的二次确认 (2b662d17)
- fix(preview): 编辑态优先于预览类型分发，md/html 也能编辑保存 (38f9f897)
- feat(preview): 覆盖前备份 + tab 上的脏/冲突标记 (19bb128c)
- feat(preview): 文件预览编辑模式对齐 PiUI（显式编辑态 + 保存事务） (1d89e9c3)
- feat(preview): 文本预览改成可编辑（需求三 P2.1，保存事务未接入） (f6e8744d)
- refactor(codemirror): 拆出只读/可编辑共用的扩展工厂（行为不变） (fec41484)
- fix(chat): 请求区卡片的头部横线两端留空，与项目面板分隔线一致 (0340252a)
- fix(chat): 网页搜索的选择器补齐展开态细节，控件样式对齐设置页 (99c47a06)
- refactor(chat): 网页搜索源改用项目统一的 DropdownMenu，去掉原生 select (44fad2a6)
- fix(chat): 网页搜索表单改用与权限/提问同款 dock，可收起为胶囊 (c59af43e)
- fix(chat): 网页搜索表单与提问/权限同一个请求区，不再压在输入框上 (7744b014)

## [v0.7.18] - 2026-10-18

- feat(desktop): 桌面端附件改由 Rust 流式上传，桌面也拿到真实进度 (a3ff755f)
- feat(chat): 上传进度（浏览器走 XHR），整个胶囊当进度条 (7965fb93)
- test(chat): 补桌面端选择器内联媒体与模型不支持时的用例 (0ca88969)
- feat(chat): 桌面端「选文件」与拖入共用同一条附件判定 (d70bed82)
- feat(chat): 直引本机路径前先问服务端读不读得到 (888f379b)
- feat(chat): 本机实例拖入文件不再走上传（需求二） (662c56bd)
- fix(message): 气泡与回填不再显示附件的路径引用行 (e3ef17f5)
- feat(chat): 拖入任意文件走上传，失败可见可重试（Issue #182） (d758b3fa)
- feat(message): 路径型附件注入文本引用与 metadata.attachments（Issue #182） (8e321888)
- feat(api): 任意文件上传与附件三路分发（Issue #182） (f4f4d84f)
- feat(settings): 配置编辑器改为 OpenCode v2 配置 schema (7ae730d8)

## [v0.7.17] - 2026-10-16

- fix(chat): 会话还 busy 时过程壳不再提前收成「已处理」 (6596015f)
- fix(message): step 完成信息改为消息级末尾一行，不再因末尾是正文而整块丢失 (42cdac7b)
- fix(chat): 进入会话时可靠对齐输入框模型 (5cb5c39c)
- fix(markdown): 修正 CJK 强调闭合、货币 $、脚注与任务列表解析 (19daea72)
- fix(message): 移动端不再把 agent 徽标撑高（内联紧凑按钮退出 32px 最小点击区域） (9176a514)
- feat(chat): 会话操作收进标题菜单，去掉弹窗头部横线 (f4a7d7c4)
- fix(sessions): 已回复的权限/提问不再被快照重放复活，清掉侧边栏残留徽标 (be027569)
- fix(ui): 边缘渐隐改用 mask，避开 Tailwind v4 渐变在 oklab 下的色带分层 (8e86eee6)
- feat(chat): 输入框 ↑↓ 优先翻阅当前会话自己的历史输入 (0fe07571)
- feat(settings): 新增「渲染 HTML 内容」开关，可关闭 AI 输出的 HTML 活渲染 (aae118ad)
- feat(sessions): shell 库存接入全局事件直写，挂载/摘下的实时性对齐官方 (1ed2b55f)
- fix(message): followShellOutput UTF-8 边界自愈，修流式输出的中文乱码 (cd3a793c)
- feat(message): bash/shell 工具卡运行中实时输出跟随 (31cb107a)
- feat(sessions): shell 输出弹窗复用信息流沉浸模式工具卡 (146db2a3)
- feat(sessions): 后台 shell 在跑的 idle 会话也算活跃，进活跃 tab (70db9fa8)
- fix(sessions): shell 库存按工作区目录取数，挂载覆盖文件夹/活跃列表 (2f204f26)
- feat(sessions): 后台 shell 挂到侧边栏父会话下，活着就算会话活跃 (aff816d5)

## [v0.7.16] - 2026-10-16

- fix(chat): 队列操作行插队按钮挪到行首 (80cb042f)
- fix(chat): 队列操作图标对齐用户消息 action bar 规格 (27adc4a9)
- fix(chat): 队列长文本折叠复用 CollapsibleUserText，不再搞特殊 (37a52d5e)
- fix(chat): @ 提及的附件 url 补 file:// scheme，修发送 400 (24e90dae)
- test(chat): 修 RetryStatusInline 倒计时测试的时序 flake (d19c9cfa)
- fix(chat): 队列气泡渲染附件胶囊，和普通用户消息同款 (de3269d8)
- refactor(chat): 会话移动菜单从下拉改成 Dialog (e3a79d35)
- feat(chat): 对话列/输入框左缘拖拽调宽（两个独立把手，dsh 样式） (622c0e32)
- feat(chat): 队列消息可折叠，默认折叠/展开有设置开关 (79db1df6)
- feat(chat): shell 模式给「真心想输入 !」留退路，并写进输入框提示 (78c9d12f)
- feat(chat): 发送改为官方时序——提交即清空、后台发送、失败恢复 (e253d45a)
- fix(chat): 失败 idle 标记不再被可见性过滤掉（错误不渲染的最后一环） (f1470a04)
- fix(chat): 会话级错误（失败 idle 标记）渲染成错误卡片 (054e554a)
- feat(plugins): 插件面板显示所有插件的来源位置，头部横线对齐 MCP 面板 (56e7ffb2)
- feat(changes): 文件变更面板改为事件驱动刷新，刷新无感 (e3650e30)
- fix(sessions): fork 出的新会话实时进列表，不用手动刷新 (62b01d92)
- fix(session): deep undo 刷新后正确隐藏已撤销消息并保留 redo (4efc8b60)
- fix(chat): fork 用户消息后新会话输入框预填恢复 (17979ef2)
- fix(session): 刷新后从 Session.Info.revert 重建 undo/redo 状态 (b9780d49)
- feat(message): 压缩消息补 step 完成信息，操作条按其下排列（对齐助手） (474c529c)
- fix(message): 压缩消息的 undo 按钮真正拿到 onUndo/canUndo (bc5a375c)
- feat(message): 压缩结果展开后支持 undo / 分叉 / 复制操作条 (e3d4c6f3)
- feat(message): 上下文压缩改为单标识 + 可收起 + 结束后自动收起 (49c63e64)
- fix(permissions): 他端批准权限后非文件权限卡片不再残留按钮 (77f8ac0c)
- fix(diff): patch 还原的合成间隙区域不再渲染折叠条 (f3a56376)
- fix(diff): ContentBlock/SessionChangesPanel 也按 @@ 绝对行号还原 (bafeb95d)
- fix(diff): 按 patch 的 @@ 绝对行号还原 before/after (6833baa4)
- fix(chat): truncate the load-error stack shown in the UI (b9dcdd7e)
- fix(permissions): show the diff preview before approving edit/write (1ca87a18)
- fix(startup): wait for the local service before loading a session (2c3b698e)

## [v0.7.15] - 2026-10-15

- fix(composer): compress only the model name in the seat trigger (7ad42a0c)
- fix(composer): let the seat trigger use the room it has (10035271)
- fix(composer): keep the aggregated seat trigger from colliding with the actions (4d74f6a0)
- docs(terminal): state both gates of the connect-ticket endpoint in the hint (94b7fc1c)
- fix(service): rewrite the registered bind address (0.0.0.0) to loopback (a50d925b)
- fix(terminal): explain why the PTY connection failed instead of only retrying (b6287c95)

## [v0.7.14] - 2026-10-15

- fix(chat): decide the permission notification after the session chain is known (09c8d8a9)
- fix(chat): never notify about a permission that is already on screen (1d74fed8)
- fix(chat): mount live child-session permissions instead of only toasting (cac92e36)
- fix(chat): make subagent card binding deterministic and bounded (ec96b783)
- fix(store): make childSessionStore.subscribe safe to pass unbound (3cbadce3)
- feat(servers): re-pair from the edit form and grant Android camera access (ab061980)
- fix(chat): keep subagent permissions visible and mounted while tools run (c21fa795)
- feat(desktop): adopt the shared background service and manage it from settings (3f9dc4a9)
- feat(servers): scan pairing QR codes when adding a server (98cb17ff)
- fix(servers): redeem pair links before diagnosing mixed content (99837f92)
- feat(servers): add servers via opencode pair links and pair from the UI (9363caca)
- fix(message): restore the inline subagent transcript in task tool cards (f3f32510)

## [v0.7.13] - 2026-10-15

- fix(chat): refresh stale session state after an SSE reconnect (09163a20)
- fix(chat): keep auto-scroll pinned to the bottom during streaming (a9011c54)

## [v0.7.12] - 2026-10-14

- fix(mobile): scope the keyboard-session reveal to iOS - Android Chrome was already correct (f00d8952)
- chore: remove the viewport debug badge - keyboard lift confirmed fixed on device (cd858745)
- fix(mobile): stop deriving keyboard-open layout from viewport metrics - hand over to native scroll-into-view (ad68aefc)
- chore: temporary viewport debug badge for the iOS keyboard-lift issue (bdceec8c)
- fix(mobile): single-channel keyboard compensation - pin app height to the visual viewport, drop the inset padding (35dc0868)
- chore: remove the scaffolding from the iOS white-flash hunt (c0fff34c)
- fix(router): never assign window.location for hash navigation - iOS standalone treats it as an app navigation (a870ad3a)
- feat(router): wrap route changes in View Transitions - snapshot crossfade instead of live re-raster (23bf0db4)
- fix(mobile): cover the workspace switch before paint, not after (ef514680)
- fix(mobile): composite the chat surface only while the pager is swiping (934082f7)
- fix(mobile): veil workspace switches on iOS to hide the WebKit tile-raster white flash (155bec57)
- fix(mobile): remove the display-flip viewport heal - it blanked the whole root on iOS (8ae5a841)

## [v0.7.11] - 2026-10-14

- test(form): capture form state in an effect to satisfy the react-compiler lint rule (97a00665)
- refactor(changes): align the review panel with the official v2 diff consumption (97c2d3db)
- fix(chat): direction-aware scroll attribution - growth-animation frames no longer detach follow (c88444fc)
- fix(form): restore free-form custom answer input on choice questions (5721b508)
- chore(mobile): remove the temporary standalone viewport debug badge and probes (94ec4035)
- fix(explorer): stop attributing sessions to scope directories - v2 lists are global (f2a98d90)
- fix(mobile): pin standalone shell to screen.height - innerHeight drifts per launch (2e7d324e)
- fix(mobile): drop baseline compensation - on-device data shows a healthy viewport (feb67ef4)
- fix(mobile): measure the standalone viewport gap instead of assuming the env inset (e0d10a36)
- fix(dialog): keep mobile sheet below the iOS status bar in browser/PWA (1a2a5ae0)
- fix(mobile): revert blind safe-area compensation that pushed the shell off-screen (1517b62e)
- fix(mobile): compensate iOS standalone viewport undermeasuring safe-area inset (07e8565f)
- ci(docker): build images on dev pushes too, not just main (c298405e)
- fix(mobile): pin app height to real innerHeight in browser/PWA mode (e3b51efb)

## [v0.7.10] - 2026-10-14

- fix(chat): restore session model/agent/variant from durable SessionInfo on fresh launch (c9429753)
- fix(message): make tool-produced file capsules expandable like user attachments (d65a395e)
- fix(file-explorer): scope preview tabs by workspace instead of one global list (eced73be)
- fix(message): restore tool row descriptions lost in the v2 migration (4600e2dc)
- fix(chat): keep bottom-follow alive through high-TPS streaming artifacts (136210b4)
- fix(file-explorer): key preview cache by workspace, clear stale preview on switch (b05934f6)
- fix(sidebar): switch workspace when opening a session from the active tab (3ef7ee3d)

## [v0.7.9] - 2026-10-13

- fix(events): debounce catalog refetches triggered by SSE bursts (33be0456)
- fix(chat): stop blanking the seat menu label during background refetches (85468568)
- fix(chat): stop prefilling persisted drafts, recall them via ArrowUp instead (0ff39041)

## [v0.7.8] - 2026-10-13

- fix(service): normalize IPv6 unspecified bind address in listening URL (9c0294e3)
- feat(settings): one complete serve argument per line (fd84ca88)
- fix(service): run bare 'opencode serve' for the default entry URL (54b2166f)
- fix(service): let user --hostname/--port replace derived serve args (cc1e5e29)

## [v0.7.7] - 2026-10-13

- fix(sessions): make unpin reachable on touch for server-deleted pinned sessions (4d80cf4c)
- fix(message): keep execute tool name consistent with other tools (18a7e672)
- feat(message): surface what the v2 CodeMode execute tool actually runs (335e6e7b)
- fix(ui): honor minWidth for constrained dropdown menus (753d4395)
- fix(chat): seat menu reopens at root pane and tooltip skips empty segments (b676df23)
- fix(ui): make dropdown menus instant and fix seat-model menu anchoring (cab92508)
- feat(chat): DSH-style seat selector mode for the composer (b3ef0dbd)
- feat(chat): make send/stop buttons circular (c2258163)
- feat(chat): swap send button icon from paper plane to arrow-up (c56451a2)
- feat(service): extra serve startup args setting, reusing the env-vars UI (77017397)

## [v0.7.6] - 2026-10-12

- fix(service): honor explicitly configured server passwords and serve bind args (4908fa1a)

## [v0.7.5] - 2026-10-12

- fix(file-explorer): strip trailing slashes from directory entries (24647965)
- feat(chat): restore smooth streaming growth animation at stick-to-bottom (5db979eb)
- fix(chat): heal stale virtual row measurements causing message overlap (dcfe27cf)
- refactor(agents): agents 收敛为共享 store，对齐官方 location sync 设计 (126f1ab8)
- fix(chat): server.connected 时补拉模型/agent 目录，根治选择器空载 (64abe223)
- feat(models): 模型目录缓存增加 fetchedOnce 与按需自愈补拉 (9e0057e8)
- fix(sdk): abortInFlightApiRequests 不再永久毒化客户端缓存 (05e757e2)
- feat(chat): 发送失败自动幂等重试一次（对齐官方 composer） (495fb6a7)
- refactor(sidebar): worktree 不再合并进项目，按独立文件夹展示 (e00529d9)
- feat(chat): 发送失败时弹出错误通知，不再静默吞消息 (51651745)
- fix(sdk): 给 REST 请求加响应头超时，根治发送链卡死 (5ad5c94c)
- fix(events): 修复 SSE 永久断联与重连补偿漏洞 (f3707985)
- fix(project-dialog): 浏览到 location 根之外时项目路径被拼上 ../../ (df5e05e2)
- feat(v2): 输入框插队/排队 chip 显隐开关（agent 设置「后续消息排队」之后） (bacbd3ed)
- fix(v2): warmup 移除 workerFiles——vite 8 类型不支持（客户端入口预热即达同样提速） (19f28e0e)
- fix(v2): server.warmup 预热转译管线——首访白屏 7.4s → 1.2s (dd9b868d)

## [v0.7.4] - 2026-10-07

- fix(v2): 内嵌服务就绪检查带条目凭据——用户自配 OPENCODE_SERVER_PASSWORD 时不再白等 15s (c59371b1)
- fix(v2): 移到后台计数改半角括号——修全角括号撑出的缩进问题 (35da48b3)
- fix(v2): 页脚布局对齐 v1 todos 结构——有阻塞任务时「⏩ · 移到后台 · 新对话」 (8703a6c3)
- fix(v2): 「移到后台」挪进输入框页脚行（与 Full Auto 双三角同排） (035eff64)
- fix(v2): 队列编辑/重排投影——服务端重写期间数量恒定不再「变多变少」 (5fce4d08)

## [v0.7.3] - 2026-10-06

- fix(v2): shiki 改为排除预打包——dev 冷启动不再捆 430 chunk，预览 404 也不复发 (00c28e0a)
- fix(v2): 翻页请求游标不带 order——修复「加载更多」400 空转颤抖 (c1eeda68)
- fix(v2): 服务状态刷新带凭据——修复启动成功后状态被刷回「未运行」 (15b52607)

## [v0.7.2] - 2026-10-06

- fix(v2): 历史翻页游标自指防死循环——「加载更多」卡在顶部不再发生 (7429c1e9)

## [v0.7.1] - 2026-10-06

- fix(v2): 内嵌服务接住 v2 强制随机密码——stdout server password 提取回传 (7c2fdea6)

## [v0.7.0] - 2026-10-06

- fix(v2): shiki 依赖列入 optimizeDeps——修复 dev 下代码块主题预览 404 (a4744c11)
- docs(v2): 覆盖文档收口——本轮 15 项缺口实现清单（C12-C26） (acdc099e)
- feat(v2): OpenCode 官方桌面主题 JSON 导入（主题生态接通） (b1ccce05)
- feat(v2): /btw 侧问（session.generate）+ 纯文本斜杠命令兜底路由 (6bfa9173)
- feat(v2): 设置独立 Provider 管理页（对齐官方 settings/providers） (40a1320b)
- feat(v2): 命令面板混合搜索——命令+文件+会话（对齐官方 palette.ts） (e909e188)
- feat(v2): 通知声音跨标签页去重 + 健康检查 10s 自动轮询 (737d46db)
- feat(v2): session.message.get 封装 + model.selected durable 回读（对齐官方 data.ts:677-683） (a2c90904)
- feat(v2): List/Skill 工具内容渲染器（对齐官方 session-ui tool-renderer） (601858d8)
- feat(v2): 输入草稿持久化——按会话/工作区作用域（对齐官方 composer persistence） (f90a4b12)
- feat(v2): 全局输入历史持久化（对齐官方 composer/history store） (df73bb30)
- feat(v2): revert.committed 事件消费（对齐官方 data.ts:1076-1092） (7282016c)
- feat(v2): 客户端斜杠命令族 /undo /redo /fork /export（对齐官方 use-session-commands） (5689475b)
- feat(v2): 队列拖拽重排（对齐官方 queue-panel 的 reorder 语义） (8664db7e)
- feat(v2): 队列编辑原位替换——stash 草稿 + 替换提交 + 位置保持（对齐官方 queue.edit） (e0eefab2)
- feat(v2): compaction 进行中/失败/用量 UI（对齐官方 SessionCompactionMessage） (df7e1f50)
- feat(v2): skill 提及入口——@ 菜单接入技能目录（对齐官方 composer/model.ts:193-205） (10673e7b)
- feat(v2): Picker 行内断开连接（凭据管理闭环）+ 覆盖文档 P0 标记完成 (11df3a9f)
- feat(v2): usage-exceeded 用量超限对话框（对齐官方 usage-exceeded-dialogs） (dea72076)
- feat(v2): MCP needs_auth 走 integration OAuth 授权流（对齐官方 useMcpToggle） (3737c0e3)
- feat(v2): provider 连接对话框——OAuth 登录与 API key 流程（对齐官方 providers/connect） (59e1e4fe)
- feat(v2): 接入 integration/credential API 封装（provider 连接与 OAuth 前置） (61d5fa1b)
- docs(v2): 覆盖文档勘误——session.generate(/btw) 移出边缘清单、shell.* 接入备注、migration/message.get 补充、本轮审计修复清单 (a064fa39)
- fix(v2): 时钟校准改用真实服务端事件时间戳（删除本地时钟伪校准） (ffb5d618)
- feat(v2): 工具名精确匹配对齐 v2 + 会话标题 displayLabel 兜底 + v1 todo 残留清理 (9f3f07bd)
- feat(v2): 历史分页改游标 + 首屏 leadingTurn 补齐 (96ea3ad8)
- fix(v2): 容错四件套——revert 清队列、compaction 去重、回复 404 短路、form 失败保留 (a9e0ff5c)
- feat(v2): 接入 shell.list/get/output——后台候选并入 running shells + 运行中 shell 实时输出 (362aaeb3)
- fix(v2): 「始终允许」默认交服务端持久化（对齐官方 always 语义） (ed728154)
- feat(v2): prompt 载荷对齐官方——mention 区间、skills、metadata 选择快照 (0fd97efe)
- fix(v2): inbox 快照对账——快照期间事件增量合并 + 在途乐观条目保留 (e8f5fadf)
- fix(v2): 发送链路对齐官方——串行化、回滚守卫、queue 不立即切换模型 (48ef75d9)
- fix(v2): 排队条目投递上屏对齐服务端事件（物化 + 投递时间改写） (9ffe4a34)
- docs(v2): 覆盖清单更新 inbox 队列实现形态（气泡式 + 回声投影 + admitLocal） (f490c48f)
- feat(v2): 排队消息气泡式队列 UI（对齐 PiUI 形态 + 官方 inbox 语义） (2c81c4df)
- docs(v2): P3 两项定论——persistentPty 与 server.pair/connect 官方 web 不消费，归入边缘 API 清单 (404533e9)
- docs(v2): 覆盖清单勾选 plugin.* (58ce850b)
- feat(v2): 插件管理面板（plugin.list/check/update + plugin.updated 事件） (84c5fd67)
- docs(v2): 覆盖清单勾选 websearch.providers (9abce0ff)
- feat(v2): websearch.provider 表单专用 dock（websearch.providers） (50974521)
- docs(v2): 覆盖清单勾选 session.background (dfefd697)
- feat(v2): 阻塞中的 shell/task 可移到后台（session.background） (ef880c0c)
- docs(v2): 覆盖清单勾选 session.move (1b6ccda0)
- feat(v2): 会话移动到其他目录 / worktree（session.move） (b109a6d9)
- docs(v2): 覆盖清单勾选 vcs.branch.list (aba54c80)
- feat(v2): worktree 创建表单接入 vcs.branch.list 基准分支选择 (4e5bc8ea)
- docs(v2): 覆盖清单勾选 reference.list (211070d3)
- feat(v2): @ 提及菜单接入 reference.list（命名引用目录） (14577564)
- docs(v2): 覆盖清单勾选 shell 命令（含实现要点与未做项） (9471d51a)
- feat(v2): 接入 `!` shell 命令（官方 composer shell mode） (80b62ad3)
- feat(v2): 排队消息迁移到服务端 inbox，对齐官方 queue 语义 (c34b776e)
- docs(v2): SDK 覆盖对照与缺口接入计划 (4e72b6f4)
- docs(v2): v2 迁移文档与 API 对照；新增 puppeteer-core（本地浏览器 probe 依赖） (682c5fea)
- fix(v2): 侧栏项目标签渲染 branch.current，不再把整个 branch 对象拼进字符串 (c4c66bf2)
- fix(v2): question 工具内嵌提问匹配失败 + 表单排版去重 (7b556b9c)
- refactor(v2)!: 删除 UI ModelInfo 投影层，模型与供应商全链路使用原生 SDK 类型 (85fc2ebd)
- feat(v2): 消息列表倒序修正 + 发送乐观上屏的官方机制 (393d82a4)
- feat(v2): SSE 45s 空闲看门狗掐断半开连接，重连成功后再广播补偿拉取 (9ad316c1)
- fix(v2): revert.stage 遇 SessionBusy 先 interrupt 再重试，import 传 location (796e99ea)
- fix(v2): 配置合并对齐官方 Config.latest 语义 (b267b84c)
- fix(v2): PTY WebSocket 改用官方 connect-ticket 流程 (f44d9eae)
- chore(dev): dev server 忽略 Rust target 等大目录监听，/api 代理不再 rewrite 前缀 (05845d23)
- fix(v2): 健康探测改用 GET /api/info，避免未知路径命中 SPA 回退误判 (9294b5bf)
- docs(v2): 标注 toolState 里当前未接线的官方移植函数 (e5a65f26)
- docs(v2): 盘点「已分发但故意不消费」的事件，避免日后误判为漏接 (34184fe2)
- feat(v2): 接线 provider/model 目录失效事件，修掉模型目录陈旧 (94252a99)
- refactor(v2): 撤销历史构造收敛为单一实现 (f7e1acff)
- refactor(v2)!: 删除自造视图模型与投影层，改为原生消费 v2 消息 (9bc1caad)
- fix(v2): 投影层的 ordinal 改为「按 kind 计数」——与官方实现对齐 (0ff4defa)
- fix(v2): 配置编辑器顶层 agent 键改为 agents（用真实服务端验证） (f1199aae)
- fix(i18n): 补回缺失的翻译键，修掉 confirm 弹窗显示原始 key (4b473343)
- docs(v2): 记录两处「UI 有但无人产出」的分支，避免误判成在工作 (3f4e9162)
- docs(v2): 记录「系统上下文」UI 已无产出方（不要误以为它在工作） (91f689c1)
- feat(v2): 接线 session.retry.scheduled，实时显示重试提示 (08122ca1)
- fix(v2): 纠正上一轮的错误结论——content 快照事件根本不在事件流里 (5ab2f62a)
- fix(v2): 模型/agent 改走 switchModel/switchAgent，修掉"中途切模型无效" (494e5311)
- fix(v2): 修掉撤销/重做里 findIndex 未命中时的静默错误结果 (e2c530d5)
- fix(v2): 重试倒计时加单位保护，避免显示荒谬数字 (a41cdcbc)
- chore(v2): 清除死掉的 store 方法与 v1 时代的 mock 残留 (52f56f2d)
- fix(v2): 接线 content 快照与 tool.input.started，修掉"工具调用实时不显示" (56e1c82b)
- fix(v2): 投影用户消息正文，修掉"重新加载后用户消息全是空白气泡" (4d8f1116)
- fix(v2): 统一结构化错误的展示，修掉"实时失败显示原始 JSON" (02586074)
- fix(v2): 投影助手消息的 retry 字段，让重试提示真正显示 (eb85c46b)
- fix(v2): 工具失败改为显示可读错误，而不是原始 JSON (3ca3e8e7)
- fix(v2): 投影 v2 错误形状，修掉"所有助手错误都显示为未知错误" (c221449c)
- refactor(v2): 去掉事件分发层的负载强转，让编译器逐一核对负载 (fc72afd6)
- chore(v2): 清理指向已删除模块的残留引用 (12d4db1a)
- refactor(v2): 删除不可达的 LSP/Formatter 桩文件 (eaa1bef1)
- refactor(v2): 删除不可达的 tool 桩文件 (378ca3c2)
- refactor(v2): 删除两处 v1 兼容残留 (256d81dd)
- test(v2): 补投影层测试，锁住流式 ordinal 的跨模块契约 (f16e5d4c)
- fix(v2): 修正 worktree「重置」的误导性文案，删除失效的类型别名 (cd8ed7dd)
- ci(pages): 恢复 dev 的自动部署 (5d9e7818)
- chore(i18n): 删除 v1 已移除能力的死键 (866dbd4c)
- fix(v2): 投影 compaction 消息，上下文估算在压缩后正确重置 (e1db347b)
- fix(v2): 配置顶层键 provider → providers（真实缺陷） (768239b0)
- test(v2): 测试全绿（669 通过 / 4 跳过 / 0 失败） (2cbfcd3e)
- test(v2): 修复 v2 负载导致的测试失败，路径工具移出 api 桶 (b7f2d55a)
- test(v2): 全部测试文件改用 v2 形状，typecheck 归零 (f928af32)
- fix(v2): 清空全部源码类型错误，仅剩测试待改 (27390142)
- fix(v2): 配置编辑器适配 v2（Config 类型修正 + 保存改走文档写入） (46212987)
- fix(v2): 会话列表事件与查询对齐 v2 (f9f7f25e)
- fix(v2): 文件条目/状态/项目路径的剩余消费点 (70a6dff2)
- fix(v2): 文件内容消费点与项目根目录对齐 v2 (71fa8393)
- fix(v2): 移除会话归档功能（v2 没有归档端点） (5c2b9105)
- feat(v2)!: 删除 todo 子系统 (513b4c19)
- feat(v2): worktree 面板改为按 projectID 定位 (2904b10c)
- feat(v2): MCP 面板适配 v2（删除 OAuth，资源目录改形状） (2c5caf9c)
- fix(v2): revert 流程对齐 v2 语义 (55ef372a)
- feat(v2): 文件树适配扁平条目，删除全文检索 UI (a9a70921)
- feat(v2): 事件分发改为 v2 扁平流式事件 (e358b16e)
- feat(v2): 表单取代提问，新增 formFields 渲染层 (9435a94e)
- fix(v2): 会话统计改用 cost，权限改为 action/resources/save (e8c4d92b)
- fix(v2): 会话目录改为 location.directory（49 处） (16ea3ca8)
- test(store): messageStore 测试改写为 v2 语义 (9f44c276)
- refactor(protocol): 移除 v1 SDK，接入 v2 投影层与导出/导入 (8c81f605)
- feat(protocol)!: API 层重写为 OpenCode v2 原生 (55d2cdc9)
- ci(pages): v2 重写期间暂停 dev 的自动部署 (dc617b96)

## [v0.6.46] - 2026-09-16

- fix(ui): 评审 N2——BottomPanel 终端恢复门控改比对自身绑定服务器 (23cf65a6)
- refactor(store): 评审 N3——门控抽成共享纯函数谓词，8 个消费点统一语义 (526db887)
- fix(store): 评审 N1——实时事件落地后丢弃迟到的陈旧初始快照 (8b870dcd)
- fix(tauri): 评审修正——应用退出兜底回收 WSL sidecar (b168c40a)
- fix(ui): 评审修正——生命周期圆点与 Wi-Fi 探测图标分离 (92eb319b)
- fix(store): 评审修正——sidecar 复活不再劫持用户主动切换 (3221502d)
- fix(ui): 评审修正——WSL 界面语义色、图标一致性与可达性 (31f95a68)
- fix(events): 评审修正——服务器变化事件按 reason 门控消费 (3ea91924)
- fix(tauri): 评审修正——轮询单调时钟、sidecar 句柄归属与安装容错 (4b9ed336)
- fix(store): 评审修正——删除服务器时回收默认指针与 WSL 绑定 (24ef8773)
- fix(events): 评审修正——非活动服务器端点变化不再迁移 SSE 订阅 (d8a946e4)
- fix(config): 评审修正——清理 PR 内本地配置与行尾噪音 (7096f48d)
- test: 放宽配置搜索用例超时，避免并发下误报 (84ab01aa)
- fix(multi-server): 子 session 内嵌请求改用面板绑定的服务器 (94259914)
- fix(multi-server): 服务器作用域请求统一使用当前绑定的 serverId (4f6999c9)
- fix(sessions): 评审修正——过滤后兜底 active server、enabled 关闭中断重试、去除空 catch (e0601b71)
- fix(wsl): 评审修正——在线目录 revalidate 去重、prewarm 跳过就绪服务器、测试门控简化 (0659e112)
- fix(sidebar): 会话列表加载态与错误态——重试间隙不再闪现空态文案 (3e7110ee)
- perf(sessions): 修复启动级联——未注册服务器过滤、upsert 短路、订阅集合增量管理 (59885c19)
- perf(wsl): 按需预热——启动零探测、设置页意图驱动、在线目录 TTL 缓存 (68afa5b3)
- fix(deps): bump fast-uri to 3.1.6 (CVE-2026-13676) (d823f189)
- fix(wsl): sidebar group and SSE follow WSL server registered after boot (b5a21665)
- feat(wsl): frontend server sync, settings UI and connections integration (d32b6411)
- feat(wsl): backend server management commands for Windows desktop (1642caea)
- chore: exclude local opencode reference dir from git, eslint and vitest (cfd5ce63)

## [v0.6.45] - 2026-08-29

- fix(session): bound getLastTurnDiff to latest page instead of full message fetch (7c7a47ef)
- fix(deploy): forward Authorization header through standalone Caddy proxy (db9ff56f)
- fix(message): stop entry-grow animation on cleanup to avoid stuck height under StrictMode (cdb7e0f4)

## [v0.6.44] - 2026-08-17

- fix(markdown): robust math parsing and converge renderer rules (5602e384)

## [v0.6.43] - 2026-08-12

- fix(permissions): refresh can't load pending permissions (composite vs raw family check) (69633740)
- fix(permissions): clear stale pending requests when switching sessions (e04c8e6d)
- fix(permissions): refresh must not drop SSE-known permission dialogs (15702579)
- fix(active-tab): busy session tree now nests children under parents again (70e100d5)
- fix(sessions): task-child permission matching, sub-session view, child abort use composite keys (6b30fec0)
- fix(permissions): pending permission/question requests filtered out by key mismatch (14b36811)

## [v0.6.42] - 2026-08-12

- fix(sessions): remaining composite-key mismatches in selection, busy & unread markers (8de12315)
- fix(sessions): child sessions under parent no longer broken (composite-key mismatch) (f245160f)

## [v0.6.41] - 2026-08-11

- fix(multi-server): force auto path style while multi-server mode is enabled (247f12ed)
- fix(tauri): terminal bridge connects the pty's own server, not the active one (7dd92778)

## [v0.6.40] - 2026-08-11

- fix(multi-server): terminal tabs keep their own server; connections no longer break after focus switch (3bd25276)

## [v0.6.39] - 2026-08-11

- fix(multi-server): per-server path style detection (Windows/Linux coexistence) (15491eb7)

## [v0.6.38] - 2026-08-11

- fix(right-panel): remount file/diff content when the server changes (77dee66e)
- fix(multi-server): right panel (files/diff/terminal) follows focused session's server (327d8f47)

## [v0.6.37] - 2026-08-11

- fix(mobile): restore gap between collapsed reply capsule and scroll-to-bottom button (e202887a)
- perf(multi-server): memoize server folder groups with stable callbacks (38c2f5aa)
- fix(search): react to whitelist changes in result server set (30a2d24d)
- fix(search): highlight only the exact server::session match (b61ab0cd)
- feat(multi-server): global sidebar search matches servers, folders, and chats (4a704236)
- fix(sse): subscribeToEvents follows active server (restore single-server parity) (9d98e6b2)
- fix(multi-server): non-focused server folders no longer force-expand on global cwd (d45d955e)
- fix(multi-server): git/vcs/path info follows focused server (fa0bfa25)
- fix(multi-server): cross-server same-path folder click switches server context (d7b2c851)
- fix(multi-server): folder click in current directory toggles collapse again (d9df63e8)
- fix(multi-server): per-server model list, clean whitelist on server delete (4abda442)
- chore(api): drop unused getSessionMessageCount, verify serverId param convention is uniform (d31cec04)
- chore(multi-server): reactive subscribed count, drop stale server-switch flag entries (17d6eb36)
- refactor(multi-server): fix ineffective storage version subscription, clean up dead code (6c1705ed)
- feat(multi-server): unified workspace storage, per-server active list, project selector & routing polish (9b1a2db3)
- feat(multi-server): subscribe to multiple OpenCode servers simultaneously (75a00b64)
- fix(mobile): keep the input box usable after select-all-delete with an IME (d71ff404)

## [v0.6.36] - 2026-08-10

- perf(ui): reduce streaming work and sync window controls (871a9726)
- fix(markdown): keep single-tilde ranges literal and render \(...\)/\[...\] math (43a0b7e4)

## [v0.6.35] - 2026-07-24

- fix(pwa): manifest 使用相对路径，修复子路径部署下 start_url 指向根域 (be8fa62b)
- fix(settings): make service env var value inputs usable on narrow widths (5cad205d)
- fix(message): preserve Android expand body rendering (78fcc27b)
- fix(chat): 修复输入框折叠的两个滚动态bug (a7d6d75e)
- fix(chat): stop InputFooter flicker from streaming dock collapse (cbdcc364)
- refactor(message): dedupe ToolGroup tool map and document spacing parity (22227c23)
- refactor(message): share MessageExpandPanel shell and expand motion tokens (45764dab)
- fix(ui): fix expanded Thinking shimmer sweep on short labels (750099b9)
- refactor(message): unify expand animation tokens across message stream (92389673)
- fix(ui): tighten row padding between consecutive assistant messages (75fe97d1)
- fix(ui): unify message stack gap and step-finish spacing (7c2652a1)
- refactor(message): extract shared spacing contract for collapsible blocks (ed7c66b9)
- fix(chat): make collapsed input dock click-through except capsule (8911b67a)
- fix(ui): 统一思考块与工具步骤块间距，修复展开态流光动画 (1864e4bb)
- fix(ui): 优化内嵌提问选项勾选框与输入框对齐 (f9868878)
- fix(message): 优化思考折叠预览与间距 (f63acb62)

## [v0.6.34] - 2026-07-19

- fix(message): markdown 思考折叠时渲染单行预览 (5505c2d3)
- fix(settings): 对齐已保存 CSS 覆盖方案工具栏 (85559cd4)
- fix(settings): 优化代码块主题选择与预览 (a4ef92a5)
- feat(ui): 优化侧栏与面板控件交互 (f15c5350)
- feat(settings): 调整聊天相关默认设置 (dd401a85)
- chore: remove TODO.md (task complete) (40bb61ab)
- feat(code-block): user-configurable Shiki theme (light/dark independent) (93a71e61)
- fix(settings): 优化搜索候选宽度和键盘滚动 (fd1de693)
- feat(config): 添加配置字段和原始 JSON 搜索 (dba66d9a)
- feat(settings): 添加设置搜索和分类导航 (913d949e)
- refactor(config): 重构可视化配置编辑器 (6caacc71)

## [v0.6.33] - 2026-07-18

- fix(sidebar): 修复文件夹模式全局文件夹拖拽排序 (7dbe35c)
- Revert "perf(input): animate streaming border pulse with opacity" (3f84e2c)
- feat(sidebar): add global folder to folder-mode session list (fc26be5)

## [v0.6.32] - 2026-07-18

- fix(chat): inline loading-history indicator into message stream (127ade3)
- perf(codeblock): remove useDeferredValue for real-time highlighting (e83dac6)
- perf(markdown): remove redundant useDeferredValue and cache fullText (1f9b228)
- feat(terminal): long-press repeat and haptic feedback for mobile extra keys (1f5cce2)
- fix(chat): clamp mention/slash menu below header shadow (2e77064)

## [v0.6.31] - 2026-07-17

- fix(chat): keep retry status above input and re-pin on footer height change (77305b0)
- fix(sidebar): align folder session loading spinner with list text (84b3660)
- fix(chat): inherit input dock collapse setting in split panes (d1eef49)
- perf(chat): pin streaming hot rows in virtual range (bb0781c)
- perf(chat): reuse stable process timeline items during streaming (1dc8b54)
- perf(input): animate streaming border pulse with opacity (6283508)
- perf(chat): narrow message store subscriptions for sidebar chrome (c37c81e)
- fix(lint): remove useless escape in live markdown suffix regex (47213df)
- fix(sidebar): harden session fetch after PR #140 (96efa5c)
- feat(files): reveal local files in system explorer (90588e7)
- feat(changes): open files from changes context menu (62c7698)
- fix(sidebar): stabilize session fetch effect to prevent /session request storm (497279f)
- perf(markdown): append plain live text without full reparse (dc40efe)
- perf: cut layout thrash on panels, diff measure, and input budget (2ba9641)
- perf: localize overlay scrollbar scan and scroll updates (dd6578f)
- perf: narrow Tauri compositing hints to glass layers (0a8adfd)

## [v0.6.30] - 2026-07-16

- fix(test): hoist serverStore mock for pinned sessions init (16165d5)
- fix(project): polish folder-drop zone to center dashed overlay (1cf504c)
- feat(project): add projects by dropping folders on the chat stream (3bd7396)
- fix(project): open add-project dialog at current directory (20ff2ef)
- fix(session): isolate pinned sessions per server (8dbff0a)
- fix(message): correct collapsed-height threshold and isolate user bubble layout (9027257)
- perf(stream): preserve settled part references across deltas (e4086d5)
- fix(sync): force completed snapshots over preserved live text (421f160)
- fix(sync): preserve longer live part text across reloads (e30a807)
- perf(syntax): coalesce streaming highlight requests to one rAF (8260c4e)
- perf(markdown): freeze settled blocks and skip live re-lex on pure append (973b5c6)
- perf(chat): cut streaming layout tax on stick-to-bottom path (654f355)
- fix(chat): equalize collapsed/expanded bottom padding to stop dock flicker on desktop (7316710)
- fix(chat): fake Android expand height without layout animation (5f3ad81)
- fix(markdown): restrict subscript ~text~ to chemical-forma only (06961ad)
- fix(chat): stop sticky-bottom from hijacking scroll-up during streaming (628325e)
- fix(chat): format process duration as whole ms/s/m/h/d/y (0ea645c)
- fix(chat): show whole seconds on process collapse timer (94b4e5d)
- fix(chat): keep tool steps collapsed under process collapse (14f82a7)
- fix(chat): single earliest Working shell for async multi-send (ef0c537)
- refactor(chat): clean up process-collapse shell gate (7b19aaf)
- feat: process collapse for agent turns (a686569)
- feat: enable desktop collapsed input dock by default (9382b79)
- perf(chat): reduce virtualizer render overscan to 15 (d654e02)
- fix: drive busy UI from session status like official webui (fad60a9)
- fix: add @tanstack/react-virtual dependency for CI build (40aae8f)
- fix: stabilize virtualizer session switch and auto-scroll (1fe16fa)
- fix: prepend anchor stability during history loading (a48f184)
- fix: scroll-to-bottom button + header spacing (f201bb5)
- fix: remove contentRef ResizeObserver — causes render loop (5666a53)
- fix: remove key={sessionId}, handle session switch via effect (054ba6e)
- refactor: clean virtualizer implementation (v5 lessons applied) (69d1403)
- fix: pin chat scroll only when expanded pages change (afb7d4f)
- fix: keep chat pages stable when prepending history (c1e9edc)
- fix: render expanded tool header and body together (eb07b8a)
- fix: mount tool headers before body during expand (fa9aa6e)
- fix: keep disclosure headers fixed while content expands (5011fb5)
- fix: only follow bash scroll during live stream (8129bfe)
- fix: keep bash terminal scrolled to exit status (a269e8b)
- fix: reveal message actions on hover for pointer devices (655a8d9)
- feat: show fork/copy actions only on latest assistant (02dc726)
- feat: show step finish info only on latest turn step (f111242)
- refactor: redesign sidebar session manage mode UI (c7ad8ed)
- feat: add sandbox storage fallback (3bb121a)
- fix: preserve interactive SVG previews (6923cd5)
- fix: preserve nested HTML artifacts (62fdf76)

## [v0.6.29] - 2026-07-12

- fix: stop HTML preview width feedback (75c7b38)
- feat: preview fenced markup languages (d008faa)
- fix: preserve bare HTML artifact assets (eae9b46)

## [v0.6.28] - 2026-07-12

- fix: use accent color for HTML source control icon (7eb3c26)
- fix: persist model visibility with current hidden keys (4650043)

## [v0.6.27] - 2026-07-11

- fix: scroll HTML previews like code results (483fa01)

## [v0.6.26] - 2026-07-11

- fix: persist HTML preview controls on touch (ccd25c2)

## [v0.6.25] - 2026-07-11

- fix: reveal HTML preview controls on touch (5e102a2)
- feat: preview HTML files in file explorer (8705599)
- feat: add sandboxed interactive HTML previews (d3a3abb)
- fix: render aligned math and markdown alerts (cb12cb0)
- fix: separate task header navigation and disclosure (c65f8fc)
- fix: redraw collapsed tool content on mobile (55daadd)
- fix: harden chat rendering edge cases (75e769e)
- perf: restore smooth chat page transitions (4c84e0a)
- perf: make chat virtualization content-aware (83dc3a7)
- fix: stabilize chat scrolling with async media (1c576ae)
- refactor: consolidate syntax highlighting into worker-only architecture (7224c65)
- fix: restore inline style filtering for rich HTML markdown (47e4546)
- fix(docker): fix backend image build (mise CDN lag, opencode api rate limit, TARGETARCH) (c73c2a6)
- fix: harden markdown rendering and cleanup render residues (ef40a33)
- chore: remove unused message role visibility rule (c30f9e6)
- fix: restore stable chat virtualization baseline (7ca2382)
- feat: replace streamdown markdown renderer (f7e3a3f)
- perf: stabilize markdown and shiki highlighting (1d615d7)
- fix: restore markdown DOM styles (addfb1a)
- perf: patch streaming markdown updates (fa995ae)
- perf: optimize streaming markdown rendering (3410212)
- fix: preserve file preview target navigation (3aac8c5)
- fix: remove chat page paint containment (0213d64)
- fix: stabilize chat scroll anchors (b3784b4)
- fix: isolate hidden chat premeasurement (759db6e)
- fix: restore readonly CodeMirror remount on render (829429b)
- fix: change PageBlock from contain-content to contain-layout-style to prevent paint clipping of expanded tool content on mobile (e48e6ca)
- fix: preserve scroll position after loading history (fc6ce8e)
- fix: premeasure chat pages after user scroll intent (4118ca6)
- fix: commit initial chat page heights synchronously (9c60328)

## [v0.6.24] - 2026-07-03

- perf: reduce layout thrash in streaming render (95994a8)
- fix: improve streaming render performance under heavy usage (9bb161a)
- feat: search file names alongside content, drag results to input as @mention (3f38eb1)
- feat: auto-refresh file tree and changes panel (a3f0d3b)
- fix: prevent invisible window after closing in fullscreen (987f966)
- fix: account for container padding in scrollItemIntoView (8c54441)
- fix: stop mention menu selection reset during streaming (a6838f8)
- fix: ensure keyboard-selected menu items are fully visible (90105ae)
- fix: wrap arrow key navigation in popup menus (a45815a)
- fix: shrink divider hit area in horizontal split for outline index (8ccca70)
- fix: stabilize scroll anchor when page heights change (4096b71)
- Revert "fix: premeasure chat pages during scroll" (440be3d)
- fix: premeasure chat pages during scroll (59e2260)
- fix: link subtask titles to sessions (0a0a5f7)
- fix: tighten outline index hit area (7cd3271)
- fix: mute permission sounds during full auto (7b0e78f)
- feat: show MCP resources (807e2f5)
- feat: add file content search (df843d3)

## [v0.6.23] - 2026-06-27

- fix: constrain mobile dialog content height (52d6a5e)
- fix: constrain composer height (94ed590)
- fix: preserve message disclosure state (0fcc13f)

## [v0.6.22] - 2026-06-27

- fix: stabilize streaming markdown highlights (a973d79)

## [v0.6.21] - 2026-06-27

- fix: remeasure CodeMirror layout after collapse-to-expand animation (d6e5d5c)
- fix: stabilize recent sessions on startup (a4e88f7)
- fix: avoid expanding stale chat pages on resize (69ee821)
- fix: smooth streaming markdown updates (664abc4)
- fix: optimize streaming markdown rendering (f88b68e)
- fix: reduce chat virtualization reflow work (4e520cf)
- fix: ensure auto-approved permission state is always cleared (f657827)
- fix: clear replied permission requests locally (45aced2)
- fix: optimize streaming markdown rendering (665ebf4)
- fix: stabilize chat stream render props (c5a6dc6)
- fix: reduce streaming chat re-renders (ec71fb1)
- fix: prefer verified terminal mono fonts (78ecf8d)
- fix: stabilize mobile keyboard focus (570f74a)
- fix: avoid blank CodeMirror content when expanding collapsed inputs (da64f85)
- fix: respect user scroll position in sub-session auto-scroll (a795405)
- fix: expand accordion content immediately, not one frame late (a08014f)
- fix: break infinite re-render cycle when moving terminal between panels (73d998d)

## [v0.6.20] - 2026-06-22

- fix: bottom panel tabs should not have top safe-area padding (34a6d98)
- fix: stabilize fullscreen overlays (7e1ca42)
- perf: switch terminal to WebGL2 GPU-accelerated renderer (84b0a21)
- docs: add macOS quarantine removal note to READMEs (9341044)

## [v0.6.19] - 2026-06-21

- perf: move outline fisheye animation to CSS variables (cebf4b8)
- perf: stabilize outline index during streaming (38648e0)
- fix: hide dialog close button on mobile (60016c0)
- fix: refactor Android status bar to top-chrome self-extend (e4735da)
- feat(chat): render user messages as markdown (5f9f2d3)
- fix: make Android status bar fully transparent (7d03f6c)
- fix: stabilize mobile pager depth transform (8117762)
- feat: add mobile pager depth transform (d7c9b98)
- fix: improve mobile pager accessibility (0493f6c)
- fix: polish mobile pager depth (9a1a890)
- fix: round mobile pager separators (2a3bb8c)
- fix: harden mobile pager state sync (cb7a161)
- feat: add mobile snap panel pager (39cb451)

## [v0.6.18] - 2026-06-19

- chore: upgrade ajv to v8 for build compatibility (2c5830f)
- fix: macOS 拖拽文件上传两次的问题 (977844f)
- fix: 高亮当前对话位置的 tick 在日间模式下不可见 (c919d1c)
- fix(macos): 兼容拖放坐标判断 (f4ae1e9)
- fix(macos): clear fullscreen state on window destroy (37972e9)
- fix(macos): 退出全屏后重新对齐红绿灯位置 (1a6c403)
- fix: undo 后输入框字体模糊的问题 (726387e)
- fix(macos): 红黄绿按钮与自定义标题栏按钮垂直对齐 (a942272)
- fix: macOS 从 Finder 拖放文件到窗口不生效 (71ed010)
- fix(chat): integrate pinned session UI and lifecycle (9b1b7a9)
- feat: add conversation pinning to sidebar (d6b7500)
- fix(chat): preserve first message on new sessions (38e51c3)
- fix(chat): keep outline highlight toggle scoped (a1e9ddb)
- fix(chat): stabilize outline current highlight (68b7748)
- fix(terminal): omit undefined restore size options (c0a6038)
- fix(chat): show hidden project directories (9da3bee)
- feat: add territory-based highlight to outline index (ec10ea4)
- fix: consolidate drawer bottom safe-area padding (8c01459)

## [v0.6.17] - 2026-06-07

- fix: default changes panel to last turn scope (0c341e9)
- fix: read metadata.output for real-time bash streaming during execution (5da7b1f)
- fix(settings): apply mobile viewport height to config editor (d442e66)
- fix(titlebar): preserve decorum window controls (1892621)
- fix: remove touchAction:none from FileTreeItem button that broke mobile scrolling (a619d72)
- fix: replace 92vh with calc(var(--app-height) * 0.92) in mobile SettingsDialog to fix address bar hiding issue (f3558fc)

## [v0.6.16] - 2026-06-07

- fix(startup): cancel stale local endpoint requests (9c789e5)

## [v0.6.15] - 2026-06-06

- fix(settings): validate opencode server health (0c19e18)
- fix(startup): refresh after local service URL changes (991a856)

## [v0.6.14] - 2026-06-06

- fix(pwa): clear stale iOS keyboard inset (f5eba98)
- fix(chat): lock mobile sidebar swipe direction (7e1df88)
- fix: apply detected local service URL before boot (e0c00bb)
- fix(settings): improve config editor schema handling (b5a8978)
- fix(session): reset missing routed sessions (46a35d0)
- fix(chat): preserve streaming page height measurements (1c97439)
- fix: detect local opencode service URL (e628ac7)
- feat(settings): add visual opencode config editor (7965d06)
- feat: auto-detect opencode service binary (b3b32bd)
- refactor: align api types with sdk (ad5fb7b)

## [v0.6.13] - 2026-06-05

- chore: update opencode sdk (4a4fe17)
- fix: render Windows path markdown links (d895fa6)
- fix: improve Linux terminal font fallback (7158d87)
- fix: make markdown code blocks selectable (cd453ad)

## [v0.6.12] - 2026-06-02

- refactor: harden internal drag interactions (ccb0280)
- feat: support desktop file path drops (aa177a3)
- fix: keep mermaid touch controls off desktop (346423a)
- fix: refine markdown touch controls (6dfa4b9)

## [v0.6.11] - 2026-05-31

- fix: clarify auto approval behavior (e16e7aa)
- fix: preserve whitespace in split word diff (d0b10dd)
- fix: highlight streaming code blocks (9198a4d)
- fix: improve markdown rendering (2a75c1b)
- perf(chat): stabilize virtualized scroll premeasurement (046019d)
- fix: refine chat page virtualization (5854671)
- chore: bump version to 0.6.11-canary.1 (bd0ecd8)
- fix: stabilize chat scrolling with paged virtualization (a7bb14a)
- fix: terminal reverse video shows black box in light mode (b902645)
- fix: terminal ANSI white colors invisible in light mode (5a8a386)

## [v0.6.11-canary.1] - 2026-05-25 (Pre-release)

- fix: stabilize chat scrolling with paged virtualization (a7bb14a)

## [v0.6.10] - 2026-05-17

- fix: refresh sidebar child session links (a49908a)
- ci: deploy pages from dev (bc50843)
- fix: route permission replies through session (75bd8ac)
- fix: avoid iOS toolbar bottom gap (d880fac)
- fix: keep provider enabled for visible models (2462adf)
- fix: show detailed completion time on hover (9ca1ab6)

## [v0.6.9] - 2026-05-16

- fix(terminal): correct clipboard paste behavior (bf6f902)
- ci(docker): add image workflow guardrails (da80d45)
- fix(docker): avoid qemu frontend builds (2d4d00b)

## [v0.6.8] - 2026-05-16

- fix(diff): keep split word diff text themed (53e1d9a)
- feat(docker): add optional host backend access (279ac15)
- fix(message): preserve aborted messages with content (86fd11f)

## [v0.6.7] - 2026-05-15

- fix(input): prevent IME confirmation from sending messages (5f4e0bb)
- feat(terminal): add scoped clipboard keybindings (2f8a933)

## [v0.6.6] - 2026-05-13

- fix(session): 修复 PR #90 的子目录加载竞态并理顺范围刷新语义 (5360b59)
- fix(session): 目录切换时合并活动会话刷新状态 (4aca25d)
- feat(file-explorer): 按目录恢复文件树展开状态 (e29498d)

## [v0.6.5] - 2026-05-10

- ui: show bash working directory (48d5b28)
- fix: skip shiki fallback for unsupported languages (d4ea3be)

## [v0.6.4] - 2026-05-04

- fix: keep delete change bars continuous (843d861)

## [v0.6.3] - 2026-05-04

- ui: simplify tool diff result headers (a5889a5)
- build: reduce bundled asset size (3e4aaa2)
- fix: align wrapped diff empty textures (d4b187b)
- fix: smooth split session loading (c4f3bb7)

## [v0.6.2] - 2026-05-04

- fix: smooth wrapped diff scrolling (e46d0e5)
- fix: center collapsed diff buttons on mobile (9c1c6ef)
- fix: keep empty diff buffer textures aligned (3b70696)

## [v0.6.1] - 2026-05-03

- fix: align readonly code gutters with diffs (b9a15d3)
- fix: polish diff gutter and separators (2568070)
- fix: keep chat bottom spacing comfortable (bc42873)
- fix: tighten chat surface bottom spacing (f47dedb)
- fix: PWA safe-area double padding on iOS (0b4fa33)

## [v0.6.0] - 2026-05-03

- test: update diff viewer mock for shared data (13d7c04)
- fix: stabilize preview tab hover width (f2d0564)
- feat: improve file and change previews (7ae977d)
- fix: restore scrolling for inline code previews (09d3e96)
- perf: share diff data with fullscreen viewer (e3ceef8)
- perf: hoist diff viewer data across view modes (4467730)
- fix: improve readonly code selection contrast (4955f56)
- fix: strengthen empty diff buffer texture (849445f)
- fix: add Pierre-style empty diff buffers (16eec59)
- fix: adapt line number gutter width (d37f112)
- fix: center diff separator icons (db857dc)
- fix: port Pierre diff separator styling (789dcf2)
- fix: add Pierre-style diff separator expansion (1ce0d3a)
- fix: refine handwritten diff collapsed separators (ab9c8a6)
- fix: mask readonly code gutters (0a41e2a)
- refactor: extract readonly codemirror view (0b81235)
- fix: refine code search responsive layout (fc12a33)
- fix: anchor code preview search panel (00244e3)
- fix: polish code preview search panel (cd4e8d1)
- fix: smooth syntax theme switching (1f079e1)
- fix: use complete github shiki themes (2fc89fb)
- fix: align shiki theme with github syntax colors (e4c171a)
- feat: add adaptive shiki theme (6cb720e)
- feat: use codemirror for code previews (487cea3)
- fix: optimize sidebar transition rendering (06fe9a2)
- fix: limit message offscreen unmounting to resize (3986e5f)

## [v0.5.20] - 2026-05-01

- fix: preserve git subdirectory projects (e9646b9)

## [v0.5.19] - 2026-04-29

- fix: tighten sidebar search spacing (8b76cb2)
- fix: align desktop titlebar and dialog layout (f5800ba)
- fix: align dialog overlay styling (fe3a3cf)
- fix: unify right panel tab styling (ca6d697)
- fix: align command palette styling (dc67f38)
- fix: polish sidebar popover styling (da633ea)
- fix: preserve route session during refresh (9d3f0a0)
- fix: prevent terminal reconnect loops on global switch (5d0aca2)

## [v0.5.18] - 2026-04-29

- fix: tighten pane focus and interaction regressions (c800e44)
- fix: prevent route sync from overwriting focused panes (fa44f13)

## [v0.5.17] - 2026-04-28

- fix: keep session actions tied to visible focus (0e16597)
- ci: update GitHub artifact actions (d9e49c6)

## [v0.5.16] - 2026-04-28

- fix: hide session actions after mouse selection (1d6b4be)
- ci: upgrade GitHub Actions Node runtimes (ff10d7b)

## [v0.5.15] - 2026-04-28

- fix: restore model selector typography scaling (121b762)

## [v0.5.14] - 2026-04-28

- fix: close the remaining review regressions (58a03dc)
- fix: clear lint regressions and selector focus artifacts (1b85707)
- fix: preserve injected desktop titlebar controls (7e60acf)
- fix: reveal session row actions on keyboard focus (a568535)
- fix: ignore hidden controls during menu dismissal (2db0cd0)
- fix: normalize menu focus target detection (c981584)
- fix: harden menu close paths against hidden targets (c1ac600)
- fix: make portal menus inert only after close (f82b285)
- fix: route tab exits through real control order (ce3ad2d)
- fix: keep selector focus stable during keyboard actions (6fbefae)
- fix: finish keyboard flows for selection popups (110cb06)
- fix: complete keyboard navigation for selection menus (ce247ee)
- fix: stabilize stacked dialog and toolbar menu focus (3d3c542)
- fix: align keyboard paths across dialogs and selectors (8f7b01f)
- fix: tighten follow-up focus and visibility behavior (7618593)
- fix: close the remaining interaction accessibility gaps (f634223)
- fix: polish remaining high-traffic control semantics (5c88ad0)
- fix: resolve remaining session and dialog correctness issues (7bde507)
- fix: tighten menu and diff accessibility (399471d)
- fix: finish button semantics in project controls (c05d5c9)
- fix: improve semantic buttons in settings and sidebar (3a1b5bf)
- fix: harden session updates and menu interactions (1d673df)
- fix: update context usage immediately after compaction (df01835)

## [v0.5.13] - 2026-04-27

- fix: restore drag and drop in secondary desktop windows (36d489e)

## [v0.5.12] - 2026-04-27

- fix: create the Android main window explicitly (1c20510)

## [v0.5.11] - 2026-04-26

- fix: defer desktop windows until the first frame is ready (1b1e186)
- fix: remove titlebar separator that misaligns with sidebar border (ed14752)
- fix: prevent overlay sidebars from being obscured by desktop titlebar (8b20d80)
- feat: add titlebar actions — back/forward, open project, settings, new window (65abc23)
- fix: keep fullscreen viewers below desktop chrome (40e1ef4)

## [v0.5.10] - 2026-04-26

- feat: add manual terminal labels and restore state (b42a90d)
- fix: align terminal PTY handling with upstream (093f2f2)
- fix: avoid macOS traffic light overlap in fullscreen headers (a5a3554)

## [v0.5.9] - 2026-04-23

- fix: harden live tool timing updates (d6c963a)
- feat: resolve issue #74 running tool durations (54490f3)
- feat: store calibrated server time locally (f35c4ab)
- feat: handle server.connected event timestamps (0e77075)
- refactor: extract shared ticking clock hook (1b0c626)

## [v0.5.8] - 2026-04-21

- fix: polish sidebar session and notification layout (51b22f2)
- refactor: modularize settings backup snapshots (a9d59c6)
- fix: reset project dialog state on reopen (b344278)
- feat: add settings backup import and export (93ad2ab)
- fix: rebalance obsidian surface contrast (0837734)
- fix: separate system notification settings from sound config (ccc80e4)
- feat: add separate system notification controls (3236d14)
- feat: add Dracula theme preset (7623377)
- fix: persist model selection across session restore (d8eb318)
- fix: shrink launcher icon mark further for masked shells (4f3e99f)
- fix: reduce app icon mark scale and drop custom Android splash (2552342)
- fix: remove unsupported Android splash attr from canary build (21ea11a)
- fix: shrink Android app icon foreground and add native splash theme (8325bfc)
- feat: redesign app icons for desktop and Android (527d423)

## [v0.5.7] - 2026-04-19

- fix: anchor toasts to the content area beneath desktop titlebar (fe15280)

## [v0.5.6] - 2026-04-19

- chore: sync Tauri app icons from web opencode.svg (f792218)
- polish: slim desktop titlebar down to minimal app chrome (375e8d1)
- feat: add platform-aware desktop titlebar foundation (43fa2da)
- fix: prevent model selector from jumping to wrong provider on split (5b33360)

## [v0.5.5] - 2026-04-18

- fix: remove redundant *Single i18n keys — let i18next handle count=1 natively (9385ef8)
- style: match pane drop highlight radius to pane shell (rounded-lg) (f8acac2)
- feat: enable drag-to-split on active session list items (ac20b7b)

## [v0.5.4] - 2026-04-18

- polish: pane drop overlay — drop text labels, harden edge cases (2be4c13)
- perf: keep pane drop overlay state out of ChatPane re-render path (17025ad)
- feat: drag sessions onto chat pane to split or replace (e413864)
- fix: add keyboard shortcuts to question dialogs (send keybinding to submit, Escape to skip) (dc83e0e)
- fix: narrow shell tool detection to exact 'sh' match across all matchers (f534454)
- Update zh-CN usage stats labels to English (074878e)
- fix: distinguish file writes in tool summary (2f25e93)
- fix: refine message tool summary wording (1d41542)
- fix: guard session error without sessionID (2166183)

## [v0.5.3] - 2026-04-17

- style: use distinct icons for settings tabs (9b2adb1)
- fix: sanitize exported CSS snippet filenames safely (139725c)
- fix: adapt token usage ring track to all themes (75f2ad4)
- refactor: derive theme previews from preset tokens (720c426)
- feat: add reusable CSS overrides for themes (eba9d1d)
- refactor: split settings into agent and workspace tabs (b38ac6b)
- feat: add configurable message completion timestamps (2f01c56)
- feat: add model visibility settings (731efdd)
- style: improve glass effect - thicker base, blur(22px), saturate(200%) (bd27ce1)
- feat(themes): 新增Sakura、Ocean、Obsidian三款预设主题 (bfa449c)
- feat(settings): 添加自定义CSS模板管理功能 (79db9f4)

## [v0.5.2] - 2026-04-15

- test: fix streamed event mock typing (92627ee)
- fix: preserve UTF-8 text in streamed markdown updates (8d89ce4)
- feat: add release update checks with about entry (closes #33) (e29a842)
- fix: preserve files and changes panel state across tab switches (closes #63) (3d57dc9)
- fix: allow pin toggle on selected model in desktop model selector (96e0ab2)
- fix: remove mobile 16px font-size override so input matches message stream (9e1eb6e)

## [v0.5.1] - 2026-04-13

- feat: show agent and model name in step finish info (closes #61) (7299319)
- fix: restore line-height lost during font system migration (3d83f3b)
- fix: split diff view losing syntax highlighting when word diff is active (9f281ec)
- feat: tune default font sizes to match opencode official UI proportions (29c6f76)
- feat: unified typography system with CSS variables and per-axis font scale sliders (4533b15)

## [v0.5.0] - 2026-04-13

- feat: add keep-screen-awake toggle in appearance settings (Wake Lock API) (3a6a13c)
- fix: update inline code test to match simplified style (no border/bg) (edc4beb)
- fix: simplify inline code style and add persistent underline to links (7f2cd73)
- fix: allow share URL to scroll horizontally on mobile (d049ce0)
- fix: ensure bottom padding in PWA standalone for devices without Home Indicator (eb8682c)
- fix: use replaceState on mobile to prevent session history stacking (ceed83d)

## [v0.4.9] - 2026-04-11

- fix: prevent model restoration from overriding user selection during streaming (0c799e3)
- fix: return 404 for /api on frontend-only image (b07a30e)
- fix: align UI hook dependencies with live state (63a2b87)
- refactor: remove dead UI cleanup leftovers (5b82694)
- fix: remove unused resolveAlias function in shiki module (81d5fdb)
- perf: lazy-load shiki languages and optimize Tauri release profile (1be34e0)
- fix: PTY WebSocket auth fails behind reverse proxy (4bbb3c5)
- fix: prevent session fetch storm on SSE reconnect in SessionContext (ae26e6c)
- refactor: unify SSE and PTY into a single transparent bridge (73e638f)
- fix: use tungstenite message variants for PTY bridge (6210294)
- fix: bridge Tauri mobile PTY through native client (e33bde5)

## [v0.4.8] - 2026-04-10

- feat: queue follow-up messages behind active turns (90756e3)
- fix: GPT apply_patch diff not rendering and error messages invisible in chat (6d6f81d)
- fix: align prompt history cursor navigation (4dd2bf4)
- fix: tighten session alerts and mobile code copy (8e02c0a)

## [v0.4.7] - 2026-04-09

- fix: update command test to mock sdk instead of removed http module (f7521bc)
- fix: patch sdk migration review findings (e45b2b5)
- refactor: collapse remaining sdk helper types (c9d2a74)
- refactor: align remaining api models with sdk (f9c9272)
- refactor: align user message model fields with sdk (e427ccd)
- refactor: align event types with sdk (826cd49)
- refactor: tighten message part guards (b83098f)
- refactor: align tool part types with sdk (cecab44)
- refactor: align event payload adapters with sdk (d9ffe50)
- refactor: tighten sdk adapters and message conversions (a5aa326)
- refactor: align config and skill types with sdk (4eed10c)
- refactor: trim remaining sdk type wrappers (bfa0bde)
- refactor: collapse API types onto sdk definitions (e5e7305)
- refactor: replace API type wrappers with sdk aliases (89d42ac)
- fix: finish sdk migration cleanup (a90d0aa)
- fix: align API layer with official opencode sdk (ae4308c)
- fix: eliminate UI flicker, merge duplicate effects, avoid object mutation (a6e4cc1)
- fix: stabilize git workspace recents and worktree actions (abd0ee5)

## [v0.4.6] - 2026-04-07

- fix: keep active child sessions visible across projects (9d8a725)
- fix: polish folder recents load more control (cbb1d59)
- fix: fade changes stats as one line (f05f8af)
- fix: compact changes panel header (231904f)

## [v0.4.5] - 2026-04-06

- fix: refine changes menu spacing (ad48921)
- feat: sync file explorer status with change modes (b655d50)
- fix: align undo state with visible messages (752cae6)
- fix: clear command drafts after dispatch (4851435)
- fix: show history compacted messages (cc7d980)
- fix: simplify changes panel mode switch (ceb721b)
- feat: add git and branch review modes (71a8c0d)
- feat: add git setup and current-turn session changes (769f3ab)

## [v0.4.4] - 2026-04-06

- fix: keep edit mode checkboxes compact on mobile (3d7c342)
- feat: support shift-select in recents edit mode (6181f5f)
- style: refine edit mode selection visuals (c7ca524)
- feat: add batch edit mode for sidebar recents and rewrite folder drag-sort (a1326d5)
- fix: persist panel layout and terminal positions (e1aeea8)

## [v0.4.3] - 2026-04-05

- fix: improve pane navigation and sidebar drag affordances (a3dd889)
- fix: keep input focus after sending (161e7b8)
- fix: render bash tool commands inline (b6a6db2)
- fix: remove sidebar footer divider (d6e59b9)
- fix: prefer pointer outline interaction on hybrid devices (a20ebc0)

## [v0.4.2] - 2026-04-03

- fix: switch folder recents to the clicked directory (d579407)
- fix: support sticky ctrl+alt combos in mobile terminal keyboard (4d9c5b3)
- fix: use tauri plugin-opener for external links in terminal and MCP auth (9b80bf3)
- fix: add background tint and equal spacing to plain code block copy button (102b5d4)
- fix: prevent global mode from being overridden by pane directory sync (b7a665c)

## [v0.4.1] - 2026-04-03

- fix: disable split-pane entry points on small touch screens (3c1a607)

## [v0.4.0] - 2026-04-03

- fix: align request dialogs with the input dock width (59b5962)
- perf: fix memo-defeating patterns in message rendering pipeline (f678d36)
- fix: stabilize ChatPane tree structure across fullscreen toggle (79b28f1)
- fix: preserve DOM across pane fullscreen toggle and hide split button in fullscreen (13c7f5e)
- fix: keep split resizing off the render path (750dd50)
- fix: normalize panel PTY restoration and dedupe terminal tabs (d1b4565)
- feat: add pane fullscreen mode and refine split header actions (cf959e0)
- fix: remove split container transition side effects (5332f61)
- fix: stabilize split-pane header interactions (6631e01)
- refactor: streamline split-pane chrome and transitions (cdb4a8b)
- fix: avoid first-frame tool expansion flicker on session switch (a71dea2)
- refactor: finish pane-first cleanup and auto-approve wiring (8af9e57)
- fix: unify router state and focused-pane directory sync (2cbb177)
- refactor: remove legacy focused-session compatibility layer (e4d0616)
- refactor: unify chat shell around focused pane state (e45dd17)
- fix: sidebar selectedSessionId follows focused pane in split mode (a82abaf)
- fix: isolate per-pane state — fullAutoMode, agent selection, session eviction, clearSession (18bc9af)
- fix: prevent duplicate SSE subscriptions in split-pane mode (e15ad08)
- feat: add split-pane UI with full-parity ChatPane, SplitContainer, PaneHeader, SplitToolbar (3af6b14)
- refactor: parameterize useChatSession for multi-instance support (1b37d8d)
- refactor: make session infrastructure multi-instance ready (e0ce47d)
- fix: hide assistant fork action when no text can be copied (f734462)
- fix: keep composer action blur out of transform layers (6eb3bf0)

## [v0.3.8] - 2026-03-31

- feat: add fullscreen button to file preview and changes diff preview (9e4ca2d)
- feat: enable fork from assistant messages to preserve AI replies (f2a0079)
- refactor: unify floating component shadows to a consistent two-tier system (shadow-sm / shadow-lg) (1cf526e)
- chore: upgrade dependencies (vite 8, i18next 26, lucide-react 1.x, etc.) (41498bf)
- fix: adjust ModelSelector padding so scrollbar doesn't overlap list content (e7d6e4f)
- refactor: unify ModelSelector into a single component for both PC and mobile (5b81638)
- fix: sync session title to messageStore on SSE update for real-time header refresh (b74bb6a)
- fix: align mobile header toggle spacing (1052826)

## [v0.3.7] - 2026-03-28

- fix: remove double border on attachment meta when no content preview (d29a2f4)
- fix: hide floating actions (undo/redo/permission) during todo panel swap (a3a7231)
- fix: apply glass effect to mobile collapsed capsule (2075818)
- fix: fallback fetch after send to prevent missing user message on SSE drop (e2138df)
- fix: skip overlay scrollbar on elements with no-scrollbar class (506cf24)
- feat: child sessions displayed under parent in sidebar with toggle for always-show (97ce7d8)
- feat: add diff toggle for folder recents (a1ed95e)
- fix: wire compact model selector to global shortcut (d14fb42)

## [v0.3.6] - 2026-03-28

- test: add chatViewport mock to InputBox and InputToolbar tests (7eb80ac)
- fix: remove unused let binding in overlayScrollbar (ab9eaba)
- feat: add horizontal overlay scrollbar support (ad8d21d)
- refactor: rewrite outline index with visual config, focus-based interaction and entry windowing (18bccf9)
- fix: align compact model selector trigger (480dd04)
- refactor: centralize chat viewport state (8512fcb)
- fix: improve coarse pointer support in desktop UI (4cfc8e5)

## [v0.3.5] - 2026-03-27

- fix: use previous stable tag for release changelog (b00cff7)
- fix: load chat header title from session detail (0b8443c)
- fix: stabilize chat history loading scroll behavior (87190c6)
- fix: animate todo panel swap without layout jank (ca8a672)
- feat: add frosted glass toggle in appearance settings (662070c)
- fix: apply overlay scrollbar to textarea, hide all native scrollbars (5dce51f)
- fix: frosted glass not rendering in Tauri production build & overlay scrollbar positioning (96e72c1)
- feat: replace native scrollbars with global overlay scrollbar system (da09781)
- refactor: simplify @ and / menus with cleaner layout and unified style (f5bddec)
- refactor: redesign ModelSelector for glass aesthetic (33a9dd2)
- refactor: unify frosted glass system with CSS utility classes (0e459f9)
- style: introduce frosted glass effect to all floating surfaces (ae10178)
- fix: remove extra padding from message toggles (4eb916a)

## [v0.3.4] - 2026-03-24

- fix: align markdown copy buttons with header text (80e59ce)
- fix: render markdown images without streamdown wrapper controls (650851f)
- fix: remove code size-based rendering limits (42171e7)
- fix: remove contain-intrinsic-size that caused scroll jank (7942144)

## [v0.3.3] - 2026-03-24

- fix: resolve TypeScript errors in MarkdownRenderer for release (1abcdf1)
- fix: exclude task tool from compact inline permission mode (5f39aff)
- style: remove left accent line from TaskRenderer, restore badge status colors (1cb6044)
- style: refine TaskRenderer visual hierarchy (263b74b)
- fix: show tool description from input while running, not just after completion (b65d16e)
- fix: reduce excessive right padding in expanded reasoning content (885668d)
- fix: panel dropdown menu hover overflow — use inset padding with rounded items (02653bf)
- fix: table copy button pinned outside scroll, mobile always-visible copy buttons (2cdef17)
- style: unify tool output header height to h-8 (32px) (c566b1a)
- style: unify message flow border-radius to a tighter 3-tier system (4a8a89f)
- refactor: redesign markdown code blocks, tables, and inline code styles (11f6222)

## [v0.3.2] - 2026-03-24

- fix: align fullscreen diff test mocks with typed children (fdf1a74)
- fix: restore release validation after fullscreen refactor (ef2d755)
- fix: adjust outline index spacing for visual balance (fb98097)
- refactor: unify fullscreen components into generic FullscreenViewer (9e6d8ed)
- refactor: redesign settings UI with section-based layout and cleaner primitives (478351a)

## [v0.3.1] - 2026-03-23

- fix: unify chevron arrow direction - collapsed points right, expanded points down (3557e5a)
- feat: compact inline permission - hide duplicate content when tool body already renders (63d571b)
- refactor: redesign descriptive steps summary - merge categories, per-category errors, truncation (870f490)
- fix: move diff stats next to title and remove exit code from descriptive steps (74e69c0)
- fix: deferred permission unmount and multi-select question answer parsing (a8dc9bd)
- fix: auto-expand readable tools that finish instantly in immersive mode (06dd4d4)

## [v0.3.0] - 2026-03-22

- fix: lint warnings, error tool diff stats, descriptive steps partial error coloring (ea53836)
- feat: add diff stats summary to descriptive steps, fix write tool diff display (ce29807)
- fix: immersive mode keeps non-readable tool groups collapsed even during execution (be61de2)
- fix: resolve lint errors and remove unused eslint-disable directives (6037d19)
- feat: add immersive mode with smart tool expand/collapse (0d4252d)
- fix: skip QuestionRenderer when user dismissed or error (2029584)
- feat: add QuestionRenderer with InlineQuestion-style read-only answered view (207f0c6)
- fix: allow long bash commands to wrap in terminal view (8a7ddfd)
- simplify: BashRenderer remove buttons, click command to copy, inline exit code (72186b5)
- refactor: BashRenderer with fixed bottom bar, exit code, fullscreen, mobile-friendly buttons (cb7bb70)
- fix: restore height limit and fullscreen button in compact mode (8f8689d)
- feat: add BashRenderer with terminal style, Shiki highlighting, ANSI color support (856d74d)
- feat: descriptive steps default collapsed, show output status on tool row (b25a0f2)
- refactor: unify InlinePermission with tool output style, remove unused inline variant (ac510d7)
- feat: add compact tool output mode (hide input, no collapse, no height limit) (1036133)
- feat: add descriptive tool steps mode (d7e153f)
- refactor: remove ambient tool mode and make inline requests opt-in (06034a2)

## [v0.2.10] - 2026-03-21

- feat: restore forked prompts in the composer (0792cf6)
- fix: keep folder recents aligned with live updates (a0c8899)
- fix: improve long duration formatting (62e6d94)

## [v0.2.9] - 2026-03-19

- fix: preserve custom audio when switching to builtin sounds (57119da)
- fix: resolve all eslint warnings across codebase (4b31da3)
- feat: add notification sound system with per-event configuration (b6019e2)
- perf: defer offscreen chat message rendering (52d8ba8)
- refactor: unify file and changes preview panels (9f315d8)

## [v0.2.8] - 2026-03-18

- fix: wrap panel tab label case blocks (d353b80)
- feat: expand right panel resize range (3e67623)
- feat: add tabbed session changes workspaces (ace0259)
- feat: add tabbed file preview workspaces (ffad629)
- fix: stabilize mobile terminal toolbar layout (1eb23b7)
- feat: refine mobile terminal extra keys behavior (6e04254)
- feat: add mobile extra keys toolbar for terminal (Termux-style) (2b185ac)
- feat: show collapsed folder activity status (0bd1378)
- feat: mark completed sessions as unread in recents (90cf8c3)

## [v0.2.7] - 2026-03-18

- feat: add markdown reasoning display mode (20fa476)
- fix: avoid action overlap in folder recents on mobile (83b40b9)
- feat: animate folder recents expansion (1b8ea13)
- fix: preserve folder recents expansion across tab switches (058c289)
- fix: limit streaming layout animation to bottom-follow mode (95c6aca)
- fix: restore reasoning thinking shimmer transition (5c631c8)
- feat: refine reasoning markdown presentation (71a012a)
- fix(chat): extract formatDuration to shared formatUtils (c405092)
- fix(chat): preserve aborted turn durations (13633fb)
- feat: add diff gutter style setting (markers vs change bars) (4c5e7b8)
- fix(i18n): improve permission dialog labels for request/rule clarity (e3730d5)
- refactor: replace react-markdown with Streamdown for streaming-optimized markdown rendering (fcf3307)
- refactor: extract useResponsiveMaxHeight hook for shared viewport-aware sizing (1993eb8)
- fix: make ContentBlock maxHeight responsive to viewport size (b584071)
- fix: resolve drag-to-reorder race condition causing stale closures (b08a763)

## [v0.2.6] - 2026-03-17

- refactor: redesign folder recents with drag-to-reorder and compact session items (88b4139)
- fix: resolve bugs introduced by Python-to-Rust router migration (335b82e)
- refactor: migrate gateway router from Python to Rust (290087f)
- Feature: Add ability for router to read config from environment variables (bddc46b)
- refactor: create new Rust project opencodeui-router (dd96377)
- Update image previews in README.md (be84586)
- fix: 服务器编辑/删除按钮始终可见 (0037a17)

## [v0.2.5] - 2026-03-16

- fix: 修复胶囊按钮和弹窗 header 图标与文字对齐 (a65e34e)
- fix: 工具 icon 光晕不再被父容器裁切 (c946f19)
- fix: 移动端设置 tab 选中态被 overflow 裁切 (027fcf9)
- refactor: 设置界面优化 — 修复双滚动条、服务器编辑/删除确认 (ec75fad)
- fix(i18n): 保留开发者工具常见英文术语不翻译 (f4a6022)
- fix(i18n): 修正中文翻译质量 (f2bd269)
- feat: add full i18n support with react-i18next (en + zh-CN) (bcd9850)

## [v0.2.4] - 2026-03-16

- fix: 会话级 Full Auto 恢复原有行为 — 只在当前所在页面的 session 生效，切走后不再自动放行 (e98bd4e)
- fix: Full Auto 全局模式在 SSE 事件层拦截，确保非当前会话的权限请求也能自动放行 (1046837)
- feat: Full Auto 三态模式 — 单击循环 off/会话级(黄)/全局(红)，会话级只放行当前会话，全局放行所有，纯内存刷新即清 (db95fc7)
- fix: 去掉 steps header 入场动画，保持与其他元素一致不做特殊处理 (1e725a5)
- fix: 虚拟滚动横向滚动条修复 — 去掉 probe 元素改用 scrollWidth 历史最大值追踪，SplitDiffView proxy scrollbar 加 gutter 占位对齐 (beee631)

## [v0.2.3] - 2026-03-15

- fix: probe 最长行选取改用 monoDisplayWidth 估算渲染宽度，CJK/全角字符按双倍计，修复含中文注释时横向滚动不到位 (d1fb35a)
- Revert "fix: probe 元素去掉 overflow:hidden 修复横向滚动不到位 — hidden 在两个方向截断内容导致 scrollWidth 偏小" (0e5353f)
- fix: probe 元素去掉 overflow:hidden 修复横向滚动不到位 — hidden 在两个方向截断内容导致 scrollWidth 偏小 (c9788fc)
- fix: lint warnings — ref 写入移入 useEffect，CodePreview 提取 tokens 避免 render 期间读 ref，修复 CodePreview 测试，清理多余依赖和 eslint-disable (96955f7)
- fix: 消除胶囊⇄输入框切换闪烁 — FloatingActions 改为同一 DOM 切换定位避免 remount，胶囊去掉入场动画和防抖回归纯 UI (bc3cc0c)
- fix: 移动端胶囊⇄输入框过渡优化 — 胶囊退场不延迟避免与输入框重叠闪烁，收起方向加 120ms 防抖消除滚动边界抖动 (4060e83)
- refactor: 统一动画体系 — UndoStatus 去自带动画改由 PresenceItem 控制，CollapsedCapsule 从 CSS animate-in 换成 usePresence，PresenceItem 加 shrink-0 防挤压，清理 CSS 死代码 (5106ac0)
- fix: probe 元素精确撑开 scrollWidth 修复横向滚动不到位，去掉 backdrop-blur (0f3b764)
- Revert "fix: 代码预览/diff 横向滚动重构 — CodePreview/UnifiedDiffView 改原生滚动+sticky gutter，SplitDiffView 用 probe 元素精确撑宽，去掉 backdrop-blur" (9d12d72)
- fix: 代码预览/diff 横向滚动重构 — CodePreview/UnifiedDiffView 改原生滚动+sticky gutter，SplitDiffView 用 probe 元素精确撑宽，去掉 backdrop-blur (9e37646)
- feat: usePresence hook + 浮动按钮/权限框/提问框入场退场动画 — 命令式 animate() 零额外 bundle (fb8c59f)
- fix: 消息流底部间距增大，为浮动按钮预留空间 (7f32fa2)
- fix: 删除 Output 的 Running... 文字，Input/Output spinner 统一无文字对齐 (e8c409e)
- fix: 单工具调用始终 compact 布局，消除流结束时的缩进跳变 — SmoothHeight 平滑过渡 + steps header 入场动画 (031502f)
- fix: 代码预览和 diff 行号背景色统一 — gutter 去掉硬编码背景，继承父容器颜色 (9ef8223)

## [v0.2.2] - 2026-03-15

- ci: 恢复 codegen-units=1 减小产物体积，Rust cache 按平台隔离，精简工作流 (5018e3b)
- chore: 清理 suppressAutoScroll 死代码 (d47085e)
- fix: loadMore 不跳变 — 去掉 inner wrapper，消息反序直接作为 flex 子元素，prepend 时临时禁用 content-visibility (657e7a4)
- refactor: 用 column-reverse 替代 ResizeObserver 实现原生 stick-to-bottom (591a8eb)
- refactor: DiffView 复用 DiffViewer 组件，删除 150 行重复 diff 渲染代码 (e78d987)

## [v0.2.1] - 2026-03-14

- refactor: 用 ResizeObserver 替代 RAF 轮询实现流式自动滚动 (10d9e6a)
- fix: 空消息不参与可见列表，消除 abort 时的滚动跳变 (9dbaa4d)

## [v0.2.0] - 2026-03-14

- feat: RECENTS 列表标记活跃 session 状态 (closes #25) (98ecce9)
- fix: motion animate() 类型歧义 — 改用 motion/mini 单签名 API 解决 tsc -b TS2769 (7927bcf)
- fix: 移除 ContentBlock loading skeleton 骨架条，避免输出短于占位时的负增长跳变 (f6db986)
- feat: 消息入场生长动画 — 用户和助手消息统一从 height 0 平滑展开 (ce055fb)
- fix: SmoothHeight 激活时锁定 outer 高度，修复动画不触发的问题 (e5f6cf5)
- feat: 命令式 animate() 动画方案 — 高性能 + 零 React 组件开销 (4481aba)
- fix: 修复流结束后闪烁回弹问题 (192944e)
- fix: 修复流式文本不实时渲染的问题，移除 useSmoothStream (005b6bf)
- refactor: 连续助手消息分组渲染，共享容器浑然一体 (cfadad0)
- Revert "fix: 复制按钮始终占位，避免 text 到达时布局跳变" (1af197a)
- fix: 移除未使用的 hasMoreHistory 解构变量，修复 TS6133 编译错误 (cf9419b)
- fix: 复制按钮始终占位，避免 text 到达时布局跳变 (d51e7a8)
- fix: 移除 'Beginning of conversation' 常驻提示，仅保留加载中 spinner (11484c6)

## [v0.1.18] - 2026-03-13

- ci: 加速 release 编译 — Rust 多线程 codegen + Android 双架构并行 (2398c54)
- fix: FloatingActions 高度抖动、滚动按钮误显示 (466f4ea)
- refactor: gutter/content 分离架构 + 水平滚动独立化 + FullscreenViewer 确定高度 (e327e59)
- perf: streaming 渲染地基优化 — rAF 滚动、delta 批量化、布局稳定性 (f689910)

## [v0.1.17] - 2026-03-11

- fix: update CodePreview test mock to use useSyntaxHighlightRef (a10075f)
- fix: move history loading indicator below top spacing so it's visible (4cfc71c)
- fix: remove MAX_HISTORY_MESSAGES cap and restore loading UI (43d2273)
- perf: reduce sidebar resize lag with CSS containment and DOM-only sidebar drag (63bc0c5)
- fix: enable virtual scrolling in CodePreview by adding height constraint (43c9e3a)
- fix: mobile input collapses when tapping FloatingActions buttons (a777334)
- refactor: simplify loadMore pagination and remove prependedCount (8614df4)
- refactor: rewrite messageStore and ChatArea, remove IndexedDB cache layer (eecdeaf)
- refactor: remove loading spinners/skeletons and reduce scroll-related re-renders (eb7ebff)

## [v0.1.16] - 2026-03-11

- fix: scroll jitter after streaming ends caused by content-visibility height mismatch (765052a)
- fix: stop auto-scroll jitter when user scrolls slightly during streaming (171a62e)

## [v0.1.15] - 2026-03-10

- fix: default revertSteps to 0 in FloatingActions (400fbb4)
- chore: bump version to 0.1.15 (3f57df2)
- fix: slow scroll during streaming causes jitter by pulling user back to bottom (860683e)
- fix: isFocused stuck after toolbar button click prevents capsule collapse (aaaa727)
- refactor: extract FloatingActions and CollapsedCapsule components from InputBox (273bd98)
- refactor: extract useInputHistory hook from InputBox (d920da9)
- refactor: extract useAttachmentRail hook from InputBox (2150d82)
- refactor: extract useMobileCollapse hook from InputBox (c5fd39b)
- fix: mobile input capsule state not resetting on session switch + blur collapsing on toolbar interaction (474938e)

## [v0.1.14] - 2026-03-10

- fix: session switch scroll + eliminate all content flicker during load (d823799)
- fix: infinite history loading loop + stabilize observer + cleaner scroll-to-bottom (fe28777)
- fix: smooth shimmer gradient + disable browser scroll restoration + multi-frame scroll-to-bottom (2144260)
- fix: shimmer highlight sweep + remove unused visibleMessageIds state (ae767ca)
- fix: outline click retract, prepend scroll preservation, cross-message merge continuation (e3ca11a)
- fix: desktop label click navigation + mobile passive touch events in OutlineIndex (f35f758)
- refactor: rewrite OutlineIndex with clean fisheye engine (1057c1c)
- refactor: replace react-virtuoso with native scroll + content-visibility (2dc550a)
- fix: correct shimmer animation direction (left-to-right) and use linear timing (16bc419)
- fix: endsWithTool skips empty reasoning/text so cross-message tool merging works correctly (fdedbcd)
- style: replace thinking breath-bar with shimmer text animation in italic mode (1bed06b)

## [v0.1.13] - 2026-03-10

- fix: SSE reconnect race conditions and stale timeout constant (7614d53)
- test: add unit tests for HTTP module and Tauri environment detection (79b77af)
- chore: eliminate all 8 lint warnings (0 errors, 0 warnings) (b312bb6)
- fix: URL-encode query string values in buildQueryString (f6a434e)
- fix: add AbortController-based timeout to HTTP request() (7962278)
- fix: pending permission/question cache supports multiple requests per session (b421172)
- fix: SSE parser now handles CRLF line endings and multi-line data correctly (d4553d5)
- chore: remove dead storage key exports (WIDE_MODE, THEME_MODE, SIDEBAR_WIDTH, MODEL_VARIANT_PREFIX) (2901c99)
- refactor: replace bare console.error with unified error handlers across 14 files (7a0c86c)
- refactor: move theme/wideMode into themeStore, eliminate prop drilling through Sidebar and SettingsDialog (9c8b2d7)
- refactor: split messageStore into store, types, and React hooks layers (caef036)
- refactor: extract App.tsx hooks (useViewportHeight, useCancelHint, useCloseServiceDialog) (2dd70e3)
- refactor: split SidePanel into focused sidebar components (673db54)
- refactor: extract InputBox utility functions to input/inputUtils.ts (a1c0eee)
- refactor: split SettingsDialog into focused component files (72f5ed4)
- refactor: consolidate duplicated formatting functions into utils/formatUtils.ts (a981c89)
- refactor: deduplicate diff content extraction (fad37d4)
- refactor: extract ModalShell to unify modal overlay infrastructure (ae9f96e)
- chore: remove unnecessary eslint-disable in logger.ts (118740c)
- chore: clean up dependencies (0c50ac0)
- refactor: add dev-only logger, replace bare console.log with logger.log (91fc303)
- refactor: remove dead code files (test-shiki.ts, editorUtils.ts, toolUtils.ts) (3a3f37a)

## [v0.1.12] - 2026-03-09

- fix: preserve changelog ordering during release prep (039b906)
- chore: ignore generated tauri assets in lint (071e2db)
- fix: keep slash command composer responsive (42cdcf6)
- fix: restore cross-platform Tauri app handling (6b84717)
- perf: replace std default hasher with rapidhash (c6d5bdb)
- refactor: reorganize the file structure of Tauri backend (fa5edf6)
- perf: refactor OpenDirectoryState with papaya HashMap to reduce lock contention (6efd2a0)
- perf: optimize ServiceState.child_pid with AtomicU32 to reduce Mutex contention (a42df0b)
- perf: optimize SseState implementation - replace Mutex+Hashmap with papaya library to reduce contention and improve performance (f586a84)

## [v0.1.11] - 2026-03-08

- feat: add an optional folder-style Recent view while preserving the original session row details and per-folder ordering controls
- feat: aggregate Active sessions across all saved projects instead of limiting the list to the currently selected directory

## [v0.1.10] - 2026-03-08

- fix: harden session message sync and failed sends (b788dce)
- chore: add validated release preparation flow (010ffbe)
- docs: consolidate v0.1.9 release notes (79113da)

## [v0.1.9] - 2026-03-08

- fix: restore message attachment expand animation (2975fe3)
- fix: streamline composer attachment rail interactions (99db58a)
- fix: constrain expanded attachments and preserve composer blank lines (dd2d7ba)
- fix: harden composer attachment rail scrolling (b2bac29)

## [v0.1.7] - 2026-03-08

- fix: truncate tool description overflow in tool call row (3782c67)
- fix: tighten mobile model menu and attachment width (60b34a2)
- fix: preserve utf-8 across tauri stream chunks (1dcb15a)

## [v0.1.6] - 2026-03-07

- fix: restore tauri mobile file attachments (ffe3398)

## [v0.1.5] - 2026-03-07

- chore: keep tauri config formatted on release (48f6045)
- fix: sync settings version with app release (b815d18)
- chore: format release workflow (aef533b)
- ci: add build validation workflow (491a544)
- other: add "zed/\*" as ignored file (8f32b7d)

## [v0.1.4] - 2026-03-07

- fix: split frontend and api slash commands (bdb2e33)
- fix: support clipboard fallback in insecure contexts (edf4dd0)
- fix: align slash command descriptions (9d84a78)

## [v0.1.3] - 2026-03-07

- chore: restore release workflow formatting (73a41a4)
- perf: split code preview from file explorer (b94bfc5)
- perf: lazy load optional panels and split vendor chunks (9e0f7d6)
- chore: add test baseline and clean lint debt (0d5f175)
- chore: establish lint and formatting baseline (762786d)
- fix: shorten input footer disclaimer copy (d691b7b)
- chore: automate lockfile updates in release script (e678349)

## [v0.1.2] - 2026-03-07

- fix: scope active session state to the current directory (2503c6b)

## [v0.1.1] - 2026-03-07

Patch release focused on chat input polish, session list consistency, and smoother permission handling.

### Fixes

- Restored collapsed input dock bottom spacing
- Kept the session list in sync across directory filters and live updates
- Returned gracefully to a new chat after deleting the currently open session
- Aligned the todo popover with the input dock for desktop and mobile
- Removed extra polling from permission/question flows and synced reply state immediately

### Improvements

- Preloaded `@` root listing and `/` command data when entering a session to reduce first-open lag

## [v0.1.0] - 2026-03-05

First stable release of OpenCodeUI.

### Features

- Drag-and-drop file attachment support (desktop & mobile)
- Material file icons for file/folder display
- File @mention from explorer sidebar
- Context breakdown visualization in sidebar
- Live retry status display with expand/collapse
- Attachment detail viewer with copy/save functionality
- Capability-based file attachment upload

### Fixes

- Aligned capsule thinking chevron with italic/tool toggle arrows
- Stabilized Tauri desktop file drag-and-drop handling
- Fixed multiple task windows rendering the latest child session
- Eliminated scroll jank from high-frequency re-renders
- Fixed mobile overflow in project and diff headers
- Fixed sidebar notification/session meta row overflow
- Fixed attachment pill truncation and compact tool layout

### Improvements

- Migrated all icons to lucide-react
- Unified message part spacing and alignment
- Added Docker support with material icons build step
