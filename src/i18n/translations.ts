/**
 * 中英文翻译词典（纯模块，不依赖任何 store）。
 * zh 为 key 真源（as const），en 用 Record<TKey, string> 保证 key 与 zh 完全一致。
 * 插值语法：{name} / {count} 等占位符，由 translate() 替换。
 *
 * 范围边界：只覆盖 UI 界面层。LLM 系统提示词、生成数据（房间/家具名）、示例模型名、
 * 品牌「言筑」等不在此列（见 docs/notes.md §3.6 坑 30）。
 */

export type Lang = 'zh' | 'en'

export const zh = {
  // ---------- 应用外壳 ----------
  'app.title': '言筑 WordCraft',
  'app.desc': '言筑 WordCraft —— 通过自然语言对话快速生成 3D 空间结构模型的纯前端 Web 应用',
  'nav.home': '首页',
  'nav.settings': '设置',
  'nav.label': '页面导航',
  'lang.switchToZh': '切换为中文',
  'lang.switchToEn': '切换为英文',

  // ---------- HomePage 工具栏 ----------
  'home.loadSample': '示例',
  'home.loadSampleTitle': '加载示例模型',
  'home.clearScene': '清空场景',
  'home.clearSceneTitle': '清空当前场景',
  'home.undo': '撤销',
  'home.undoTitle': '撤销 (Ctrl+Z)',
  'home.redo': '重做',
  'home.redoTitle': '重做 (Ctrl+Y / Ctrl+Shift+Z)',
  'home.save': '保存',
  'home.saveTitleDirty': '保存到本地项目库（有未保存的修改）',
  'home.saveTitle': '保存到本地项目库',
  'home.library': '项目库',
  'home.share': '分享',
  'home.help': '操作说明',
  'home.chat': '对话',
  'home.chatExpandTitle': '展开对话',
  'home.chatCollapseTitle': '收起对话',
  'home.screenshot': '截图',
  'home.screenshotTitle': '截图保存当前视角为 PNG 图片',
  'home.screenshotFailed': '截图失败（当前环境不支持截图）',
  'home.backToHouse': '返回整屋',
  'home.apiOk': 'API Key 已配置',
  'home.apiMissing': '未配置 API Key · 前往设置',

  // ---------- 对话面板 ----------
  'chat.title': '对话生成',
  'chat.undoGen': '撤销生成',
  'chat.undoGenTitle': '撤销最近一次生成，回到生成前的场景（并移除对应对话）',
  'chat.clear': '清空对话',
  'chat.hint': '在下方输入需求开始生成 3D 模型，支持多轮对话逐步完善细节。',
  'chat.roleMe': '我',
  'chat.roleAssistant': '言筑',
  'chat.roleError': '错误',
  'chat.generating': '正在生成模型…（已 {elapsed} 秒）',
  'chat.generatingBtn': '生成中…（已 {elapsed}s）',
  'chat.generateBtn': '生成模型',
  'chat.placeholder': '例如：帮我设计一个 3×3 米的卧室，放一张双人床…',
  'chat.ariaLog': '对话记录',
  'chat.apiMissingHint': '尚未配置 API Key，暂时无法生成。',
  'chat.generatedModel':
    '已生成「{name}」模型，共 {count} 个模块。可点击模块编辑尺寸，或切换到平面图自由编辑。',

  // ---------- 空态引导 ----------
  'home.emptyTitle': '用一句话，生成你的房子',
  'home.emptyDesc': '描述房间、风格与朝向，AI 会为你搭建 3D 模型，之后可随时微调。试试这些：',
  'home.emptyFoot': '数据全在本地 · 隐私安全',
  'home.emptyApiHint': '尚未配置 API Key，可先加载示例模型体验：',
  'home.example1': '三室一厅一厨，主卧带卫生间',
  'home.example1Label': '三室一厅一厨',
  'home.example2': '现代简约独栋小屋，两室一厅，朝南',
  'home.example2Label': '现代简约小屋',
  'home.example3': '一个带大窗户的书房工作室',
  'home.example3Label': '书房工作室',

  // ---------- 视图切换 ----------
  'home.viewModeAria': '视图模式',
  'home.viewPlan': '平面图',
  'home.viewPlanTitle': '切换至俯视平面图',
  'plan.tools': '工具',
  'plan.toolsTitle': '打开平面图编辑工具列表',

  // ---------- 调试面板 ----------
  'home.debugLog': '调试日志',
  'home.debugCount': '{count} 条',
  'home.copy': '复制',
  'home.downloadTitle': '下载 .log 文件（保存到浏览器下载目录）',
  'home.download': '下载',
  'home.clear': '清空',
  'home.debugEmpty': '暂无日志（调试模式已开启，生成模型或检测连通性时会记录）',

  // ---------- 状态栏 ----------
  'home.breadcrumbAria': '当前位置',
  'home.selectedInfo': '已选：{name} · 长 {l}m × 宽 {w}m × 高 {h}m · 中心 ({x}, {z})',
  'home.selectedChildren': ' · {count} 个子模块',
  'home.focusedHint': '已进入房间聚焦视图',
  'home.selectHint': '点击模型模块查看尺寸信息',

  // ---------- HomePage 确认/提示 ----------
  'home.confirmDiscardProject': '当前项目有未保存的修改，此操作将放弃这些修改，确定继续吗？',
  'home.confirmDiscardScene': '当前场景尚未保存到项目库，此操作将覆盖当前场景，确定继续吗？',
  'home.alertCorrupt': '项目数据损坏，无法打开',
  'home.alertInvalid': '项目数据格式不正确，无法打开',
  'home.noApiKey': '尚未配置 API Key，请先前往设置页配置后再试。',
  'home.genFailed': '生成失败，请重试',
  'home.genConflictApply':
    '生成期间你手动编辑了场景。仍要应用生成结果覆盖当前编辑吗？（建议选「取消」以保留你的修改）',
  'home.genConflictAborted': '生成结果已丢弃：生成期间场景发生了变化，已保留你的手动编辑',

  // ---------- 设置页 ----------
  'settings.title': '设置',
  'settings.apiSection': 'API Key 配置',
  'settings.apiDesc':
    'Key 仅保存在浏览器本地，用于调用大模型生成模型。支持 OpenAI / DeepSeek / LocalAI 等兼容接口。',
  'settings.defaultBaseUrl': '全局默认 Base URL（可选）',
  'settings.baseUrlPlaceholder': '如 https://api.deepseek.com，留空使用默认 DeepSeek 接口',
  'settings.defaultModel': '默认模型名',
  'settings.modelPlaceholder': '如 deepseek-v4-flash，由你的服务商决定',
  'settings.thinking': '深度思考',
  'settings.thinkingFast': '快速生成（推荐）',
  'settings.thinkingDeep': '深度思考',
  'settings.thinkingFollow': '跟随模型',
  'settings.thinkingHint':
    '推理型模型（如 DeepSeek v4）默认会先思考再回答，较慢但更聪明；关闭后响应更实时。',
  'settings.keyNamePlaceholder': '名称，如 DeepSeek 主账号',
  'settings.keyPlaceholder': 'API Key',
  'settings.keyBaseUrlPlaceholder': 'Base URL（可选，覆盖全局默认）',
  'settings.addKey': '添加',
  'settings.noKeys': '尚未添加 API Key。',
  'settings.currentTag': '当前',
  'settings.defaultBaseUrlFallback': '默认 Base URL',
  'settings.testing': '检测中…',
  'settings.testConnectivity': '检测连通性',
  'settings.delete': '删除',
  'settings.visualSection': '视觉偏好',
  'settings.colorMode': '颜色模式',
  'settings.colorStandard': '标准模式',
  'settings.colorColorblind': '色盲模式',
  'settings.showWireframe': '显示线框',
  'settings.wireframeWidth': '线框粗细',
  'settings.showShadows': '实时阴影',
  'settings.showShadowsHint': '家具/墙体落影，真实感提升明显；低端设备可关闭。',
  'settings.debugSection': '调试',
  'settings.debugMode': '开启调试模式',
  'settings.debugHint':
    '开启后，对话生成的全过程（请求参数、模型原始回复、v2 解析、布局平铺结果）会记录到首页的「调试日志」面板，便于排查问题。',
  'settings.clearLogs': '清空日志',

  // ---------- 操作说明 ----------
  'help.title': '操作说明',
  'help.rotate': '旋转视角',
  'help.rotateDesc': '鼠标左键拖拽（触屏单指拖动）',
  'help.pan': '平移视角',
  'help.panDesc': '鼠标右键 / 中键拖拽',
  'help.zoom': '缩放视角',
  'help.zoomDesc': '滚轮（触屏双指捏合）',
  'help.select': '选择模块',
  'help.selectDesc': '点击场景中的房间 / 家具，右侧弹出属性面板',
  'help.edit': '编辑属性',
  'help.editDesc':
    '在属性面板修改名称 / 长宽高 / X·Y·Z，Enter 或失焦生效；或用「位置微调」按钮按步长移动',
  'help.undoRedo': '撤销 / 重做',
  'help.undoRedoDesc': '工具栏按钮，或 Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做',
  'help.focus': '聚焦房间',
  'help.focusDesc': '点击房间进入其内部视图，内部家具实体化、其他房间虚化',
  'help.unfocus': '退出聚焦',
  'help.unfocusDesc': '点击整屋地板、面包屑「房屋」，或点空白处',
  'help.move': '移动视角',
  'help.moveDesc': '键盘方向键 / WASD 平移视角',
  'help.keys': '方向键 / WASD',
  'help.keysDesc': '←/→ 或 A/D 左右平移，↑/↓ 或 W/S 上下平移（输入框聚焦时不生效）',
  'help.resetView': '复位视角',
  'help.resetViewDesc': '按键盘 R 键恢复初始视角',
  'help.breadcrumb': '层级导航',
  'help.breadcrumbDesc': '底部面包屑可点击跳转到任意层级',
  'help.projects': '保存 / 项目库',
  'help.projectsDesc':
    '工具栏「保存」把当前场景存入本地项目库；「项目库」可新建 / 打开 / 重命名 / 删除多个方案',
  'help.undoGeneration': '撤销生成',
  'help.undoGenerationDesc':
    '多轮修改不满意时，点对话栏「撤销生成」回到本次生成前的场景并移除对应对话',
  'help.planView': '2D 平面图',
  'help.planViewDesc': '视口左上角「平面图」切换俯视平面图（正北朝上，可平移缩放），再点「3D」返回',
  'help.close': '知道了',

  // ---------- 项目库 ----------
  'project.title': '本地项目库',
  'project.namePlaceholder': '项目名称',
  'project.saveCurrent': '保存当前场景',
  'project.empty': '暂无项目。保存当前场景以创建第一个项目。',
  'project.currentTag': '当前',
  'project.roomCount': '{count} 个房间',
  'project.open': '打开',
  'project.rename': '重命名',
  'project.delete': '删除',
  'project.close': '关闭',
  'project.deleteConfirm': '确定删除项目「{name}」吗？删除后无法恢复。',

  // ---------- 属性面板 ----------
  'property.closeTitle': '关闭属性面板',
  'property.dragTitle': '按住拖拽移动面板位置',
  'property.name': '名称',
  'property.dimSection': '尺寸（米）',
  'property.length': '长',
  'property.width': '宽',
  'property.height': '高',
  'property.posSection': '位置（米）',
  'property.resetTitle': '回到加载时的初始位置',
  'property.resetUnavailable': '本次会话未记录初始位置',
  'property.reset': '复位位置',
  'property.nudgeSection': '位置微调',
  'property.nudgeWest': '向西移',
  'property.nudgeNorth': '向北移',
  'property.nudgeEast': '向东移',
  'property.nudgeSouth': '向南移',
  'property.nudgeUp': '向上移',
  'property.nudgeDown': '向下移',
  'property.west': '◀ 西',
  'property.north': '▲ 北',
  'property.east': '▶ 东',
  'property.south': '▼ 南',
  'property.up': '↑ 上',
  'property.down': '↓ 下',
  'compass.north': '北',
  'compass.east': '东',
  'compass.south': '南',
  'compass.west': '西',
  'property.typeHouse': '整屋',
  'property.typeRoom': '房间',
  'property.typeFurniture': '家具',
  'property.typeWall': '墙体',
  'property.gizmoMode': 'Gizmo 手柄',
  'property.gizmoTranslate': '移动',
  'property.gizmoScale': '缩放',

  // ---------- 2D 平面图 ----------
  'plan.length': '总长 {width}m',
  'plan.width': '总宽 {height}m',

  // ---------- 平面图编辑（P4） ----------
  'plan.toolAria': '平面图编辑工具',
  'plan.toolSelect': '选择',
  'plan.toolSelectTitle': '选择/查看模块',
  'plan.toolMove': '移动',
  'plan.toolMoveTitle': '拖动房间平移（贴墙自动吸附）',
  'plan.toolVertex': '顶点',
  'plan.toolVertexTitle': '拖动房间角点改足迹形状（正交约束 + 网格吸附）',
  'plan.toolOpening': '门窗',
  'plan.toolOpeningTitle': '点墙放门窗；点击已有门窗删除',
  'plan.toolSplit': '拆房',
  'plan.toolSplitTitle': '在矩形房间内画一条线切成两间（共墙自动开门）',
  'plan.toolMerge': '合并',
  'plan.toolMergeTitle': '先点保留的房间，再点相邻房间合并',
  'plan.kindDoor': '门',
  'plan.kindWindow': '窗',
  'plan.toggleDims': '尺寸',
  'plan.toggleDimsTitle': '显示/隐藏房间尺寸标注（避免遮挡房间）',
  'plan.hintMove': '拖住房间主体移动；靠近其他房间的墙时自动吸附对齐',
  'plan.hintVertex': '点击房间选中，再拖动角点修改形状；按住拖动时可吸附网格',
  'plan.hintOpening': '点实心墙放{kind}；点已有门窗将其删除',
  'plan.hintSplit': '在房间里按住拖动画一条线（水平/垂直），松开即拆成两间',
  'plan.hintMerge': '先点要保留的房间，再点与之相邻的房间完成合并',
  'plan.mergeFail': '两房间并集不是矩形，无法合并',
  'plan.splitFail': '只能拆分矩形房间，且切线两侧需各 ≥ 1m',
  'plan.openingFail': '该处无法开洞（不是实心墙）',

  // ---------- 分享与口令 ----------
  'share.title': '分享与口令',
  'share.screenshotAlt': '场景截图预览',
  'share.captureFailed': '截图失败，仍可复制口令分享',
  'share.noModel': '当前无模型。粘贴分享口令即可还原他人模型。',
  'share.codeLabel': '分享口令',
  'share.copy': '复制口令',
  'share.copied': '已复制',
  'share.restoreTitle': '粘贴口令还原',
  'share.placeholder': '粘贴分享口令…',
  'share.restore': '还原',
  'share.invalid': '口令无效，无法还原模型',
  'share.restored': '模型已还原',
  'share.historyTitle': '历史口令',
  'share.empty': '暂无历史口令。分享当前模型后口令会记录在此。',
  'share.unnamed': '未命名模型',
  'share.delete': '删除',
  'share.deleteConfirm': '删除这条历史口令吗？',
  'share.close': '关闭',

  // ---------- 竖屏横屏引导 ----------
  'orientation.title': '请旋转屏幕至横屏使用',
  'orientation.subtitle': '横屏模式提供最佳设计体验',

  // ---------- 错误消息 ----------
  'error.httpRequestFailed': '模型请求失败：{detail}。可在设置页点「检测连通性」定位问题。',
  'error.noJson': '模型返回内容中未找到 JSON，请重试',
  'error.invalidJson': '模型返回的 JSON 无法解析，请重试',
  'error.invalidSchema': '模型返回的 JSON 不符合 v2 数据结构（{issues}），请重试',
  'error.noOps': 'ops 为空或全部无效',
  'error.unknownFormat': '未知格式',
  'error.timeout': '请求超时，请检查网络或稍后重试',
  'error.requestFailed': '请求失败：{detail}',
  'error.httpStatus': 'HTTP {status}：{detail}',
  'error.httpNoDetail': 'HTTP {status}，无详细错误信息',
  'error.noStream': '网络错误：服务未返回数据流',
  'error.streamInterrupted': '网络错误：读取响应流中断（{detail}）',
  'error.network': '网络错误：{detail}',
  'error.networkFallback': '网络错误，无法连接服务',
  'error.connected': '连接成功：模型 {model}',
  'error.unknownModel': '未知',
  'error.authFailed': 'API Key 无效或无权限（401/403）',
  'error.modelMissing': 'API 可达，但模型不存在，请检查模型名与 Base URL',
  'error.boundaryTitle': '出错了',
  'error.boundaryDesc':
    '应用遇到意外错误（通常是本地数据损坏）。可以重试，或重置本地数据后重新开始。',
  'error.boundaryReset': '重置本地数据',
  'error.boundaryRetry': '重试',
} as const

export type TKey = keyof typeof zh

export const en: Record<TKey, string> = {
  // ---------- App shell ----------
  'app.title': 'WordCraft 言筑',
  'app.desc':
    'WordCraft 言筑 — a pure front-end web app that generates 3D spatial models from natural-language conversation',
  'nav.home': 'Home',
  'nav.settings': 'Settings',
  'nav.label': 'Page navigation',
  'lang.switchToZh': 'Switch to Chinese',
  'lang.switchToEn': 'Switch to English',

  // ---------- HomePage toolbar ----------
  'home.loadSample': 'Sample',
  'home.loadSampleTitle': 'Load the sample house',
  'home.clearScene': 'Clear scene',
  'home.clearSceneTitle': 'Clear the current scene',
  'home.undo': 'Undo',
  'home.undoTitle': 'Undo (Ctrl+Z)',
  'home.redo': 'Redo',
  'home.redoTitle': 'Redo (Ctrl+Y / Ctrl+Shift+Z)',
  'home.save': 'Save',
  'home.saveTitleDirty': 'Save to project library (unsaved changes)',
  'home.saveTitle': 'Save to project library',
  'home.library': 'Projects',
  'home.share': 'Share',
  'home.help': 'Help',
  'home.chat': 'Chat',
  'home.chatExpandTitle': 'Expand chat',
  'home.chatCollapseTitle': 'Collapse chat',
  'home.screenshot': 'Screenshot',
  'home.screenshotTitle': 'Save the current view as a PNG image',
  'home.screenshotFailed': 'Screenshot failed (not supported in this environment)',
  'home.backToHouse': 'Back to house',
  'home.apiOk': 'API Key configured',
  'home.apiMissing': 'No API Key · Go to Settings',

  // ---------- Chat panel ----------
  'chat.title': 'Chat',
  'chat.undoGen': 'Undo generation',
  'chat.undoGenTitle':
    'Undo the last generation, reverting to the scene before it (and removing that exchange)',
  'chat.clear': 'Clear chat',
  'chat.hint':
    'Describe what you need below to generate a 3D model. Supports multi-turn refinement.',
  'chat.roleMe': 'Me',
  'chat.roleAssistant': 'WordCraft',
  'chat.roleError': 'Error',
  'chat.generating': 'Generating model… ({elapsed}s elapsed)',
  'chat.generatingBtn': 'Generating… ({elapsed}s)',
  'chat.generateBtn': 'Generate',
  'chat.placeholder': 'e.g. Design a 3×3 m bedroom with a double bed…',
  'chat.ariaLog': 'Chat log',
  'chat.apiMissingHint': 'No API Key configured yet — generation is disabled.',
  'chat.generatedModel':
    'Generated "{name}" with {count} modules. Click a module to edit dimensions, or switch to the plan view for free-form editing.',

  // ---------- Empty state ----------
  'home.emptyTitle': 'Describe your house in one sentence',
  'home.emptyDesc':
    'Describe rooms, style and orientation — the AI builds a 3D model you can refine later. Try one:',
  'home.emptyFoot': 'All data stays local · Private by design',
  'home.emptyApiHint': 'No API Key configured yet — try the sample model first:',
  'home.example1': 'Three bedrooms, one living room, one kitchen, with an ensuite master bedroom',
  'home.example1Label': '3+1 with kitchen',
  'home.example2': 'A modern minimalist house, two bedrooms and a living room, south-facing',
  'home.example2Label': 'Modern minimalist house',
  'home.example3': 'A study studio with large windows',
  'home.example3Label': 'Study studio',

  // ---------- View toggle ----------
  'home.viewModeAria': 'View mode',
  'home.viewPlan': 'Plan',
  'home.viewPlanTitle': 'Switch to top-down plan view',
  'plan.tools': 'Tools',
  'plan.toolsTitle': 'Open plan editing tools',

  // ---------- Debug panel ----------
  'home.debugLog': 'Debug log',
  'home.debugCount': '{count} entries',
  'home.copy': 'Copy',
  'home.downloadTitle': 'Download .log file (saved to your downloads)',
  'home.download': 'Download',
  'home.clear': 'Clear',
  'home.debugEmpty':
    'No logs yet (debug mode is on; logs appear when generating or testing connectivity)',

  // ---------- Status bar ----------
  'home.breadcrumbAria': 'Current location',
  'home.selectedInfo': 'Selected: {name} · {l}m × {w}m × {h}m · center ({x}, {z})',
  'home.selectedChildren': ' · {count} sub-modules',
  'home.focusedHint': 'Inside room focus view',
  'home.selectHint': 'Click a module to see its dimensions',

  // ---------- HomePage confirms / alerts ----------
  'home.confirmDiscardProject': 'This project has unsaved changes. Discard them and continue?',
  'home.confirmDiscardScene':
    "The current scene isn't saved to the project library. Overwrite it and continue?",
  'home.alertCorrupt': "Project data is corrupted and can't be opened",
  'home.alertInvalid': 'Project data has an invalid format',
  'home.noApiKey': 'No API Key configured yet. Configure one on the Settings page first.',
  'home.genFailed': 'Generation failed, please try again',
  'home.genConflictApply':
    'The scene was edited while generating. Apply the generated result anyway and overwrite your edits? (Choose "Cancel" to keep your edits)',
  'home.genConflictAborted':
    'Generated result discarded: the scene changed during generation. Your manual edits were kept',

  // ---------- Settings ----------
  'settings.title': 'Settings',
  'settings.apiSection': 'API Key',
  'settings.apiDesc':
    'Keys are stored only in your browser and are used to call the LLM. Supports OpenAI / DeepSeek / LocalAI-compatible endpoints.',
  'settings.defaultBaseUrl': 'Global default Base URL (optional)',
  'settings.baseUrlPlaceholder':
    'e.g. https://api.deepseek.com — leave empty to use the default DeepSeek endpoint',
  'settings.defaultModel': 'Default model',
  'settings.modelPlaceholder': 'e.g. deepseek-v4-flash — depends on your provider',
  'settings.thinking': 'Deep thinking',
  'settings.thinkingFast': 'Fast (recommended)',
  'settings.thinkingDeep': 'Deep thinking',
  'settings.thinkingFollow': 'Follow model',
  'settings.thinkingHint':
    'Reasoning models (e.g. DeepSeek v4) think before answering — slower but smarter; disabling makes responses more immediate.',
  'settings.keyNamePlaceholder': 'Name, e.g. DeepSeek main account',
  'settings.keyPlaceholder': 'API Key',
  'settings.keyBaseUrlPlaceholder': 'Base URL (optional, overrides global default)',
  'settings.addKey': 'Add',
  'settings.noKeys': 'No API Key added yet.',
  'settings.currentTag': 'Current',
  'settings.defaultBaseUrlFallback': 'Default Base URL',
  'settings.testing': 'Testing…',
  'settings.testConnectivity': 'Test connectivity',
  'settings.delete': 'Delete',
  'settings.visualSection': 'Visuals',
  'settings.colorMode': 'Color mode',
  'settings.colorStandard': 'Standard',
  'settings.colorColorblind': 'Colorblind',
  'settings.showWireframe': 'Show wireframe',
  'settings.wireframeWidth': 'Wireframe width',
  'settings.showShadows': 'Real-time shadows',
  'settings.showShadowsHint':
    'Soft shadows under furniture and walls; turn off on low-end devices.',
  'settings.debugSection': 'Debug',
  'settings.debugMode': 'Enable debug mode',
  'settings.debugHint':
    'When enabled, the full generation pipeline (request params, raw model reply, v2 parse, layout result) is logged to the Debug log panel on the home page.',
  'settings.clearLogs': 'Clear logs',

  // ---------- Help dialog ----------
  'help.title': 'Help',
  'help.rotate': 'Rotate view',
  'help.rotateDesc': 'Drag with the left mouse button (one finger on touch)',
  'help.pan': 'Pan view',
  'help.panDesc': 'Drag with the right / middle mouse button',
  'help.zoom': 'Zoom',
  'help.zoomDesc': 'Mouse wheel (two-finger pinch on touch)',
  'help.select': 'Select',
  'help.selectDesc':
    'Click a room / furniture in the scene; the property panel slides out on the right',
  'help.edit': 'Edit properties',
  'help.editDesc':
    'Edit name / length·width·height / X·Y·Z in the property panel (Enter or blur commits); or use the nudge buttons to move by a step',
  'help.undoRedo': 'Undo / redo',
  'help.undoRedoDesc': 'Toolbar buttons, or Ctrl+Z undo / Ctrl+Y / Ctrl+Shift+Z redo',
  'help.focus': 'Focus room',
  'help.focusDesc':
    'Click a room to enter its interior view; interior furniture is solid, other rooms are ghosted',
  'help.unfocus': 'Exit focus',
  'help.unfocusDesc': 'Click the house floor, the "House" breadcrumb, or empty space',
  'help.move': 'Move view',
  'help.moveDesc': 'Use the arrow keys / WASD to pan',
  'help.keys': 'Arrow keys / WASD',
  'help.keysDesc':
    '←/→ or A/D pan horizontally, ↑/↓ or W/S pan vertically (ignored while typing in a field)',
  'help.resetView': 'Reset view',
  'help.resetViewDesc': 'Press R to reset the view',
  'help.breadcrumb': 'Breadcrumb',
  'help.breadcrumbDesc': 'The breadcrumb at the bottom jumps to any level',
  'help.projects': 'Save / Projects',
  'help.projectsDesc':
    'Toolbar Save stores the scene in the local project library; Projects creates / opens / renames / deletes saved designs',
  'help.undoGeneration': 'Undo generation',
  'help.undoGenerationDesc':
    'When a multi-turn modification isn\'t what you want, click "Undo generation" in the chat header to revert to the previous scene and remove that exchange',
  'help.planView': '2D plan view',
  'help.planViewDesc':
    'Toggle "Plan" at the viewport\'s top-left for the top-down plan (north up, pan + zoom), then "3D" to return',
  'help.close': 'Got it',

  // ---------- Project library ----------
  'project.title': 'Project library',
  'project.namePlaceholder': 'Project name',
  'project.saveCurrent': 'Save current scene',
  'project.empty': 'No projects yet. Save the current scene to create your first one.',
  'project.currentTag': 'Current',
  'project.roomCount': '{count} rooms',
  'project.open': 'Open',
  'project.rename': 'Rename',
  'project.delete': 'Delete',
  'project.close': 'Close',
  'project.deleteConfirm': 'Delete project "{name}"? This can\'t be undone.',

  // ---------- Property panel ----------
  'property.closeTitle': 'Close property panel',
  'property.dragTitle': 'Drag the header to move the panel',
  'property.name': 'Name',
  'property.dimSection': 'Dimensions (m)',
  'property.length': 'Length',
  'property.width': 'Width',
  'property.height': 'Height',
  'property.posSection': 'Position (m)',
  'property.resetTitle': 'Return to the initial position at load time',
  'property.resetUnavailable': 'No initial position recorded this session',
  'property.reset': 'Reset position',
  'property.nudgeSection': 'Nudge',
  'property.nudgeWest': 'Move west',
  'property.nudgeNorth': 'Move north',
  'property.nudgeEast': 'Move east',
  'property.nudgeSouth': 'Move south',
  'property.nudgeUp': 'Move up',
  'property.nudgeDown': 'Move down',
  'property.west': '◀ W',
  'property.north': '▲ N',
  'property.east': '▶ E',
  'property.south': '▼ S',
  'property.up': '↑ Up',
  'property.down': '↓ Down',
  'compass.north': 'N',
  'compass.east': 'E',
  'compass.south': 'S',
  'compass.west': 'W',
  'property.typeHouse': 'House',
  'property.typeRoom': 'Room',
  'property.typeFurniture': 'Furniture',
  'property.typeWall': 'Wall',
  'property.gizmoMode': 'Gizmo',
  'property.gizmoTranslate': 'Move',
  'property.gizmoScale': 'Scale',

  // ---------- 2D plan ----------
  'plan.length': 'Length {width}m',
  'plan.width': 'Width {height}m',

  // ---------- Plan editing (P4) ----------
  'plan.toolAria': 'Plan editing tools',
  'plan.toolSelect': 'Select',
  'plan.toolSelectTitle': 'Select / inspect modules',
  'plan.toolMove': 'Move',
  'plan.toolMoveTitle': 'Drag rooms around (auto-snaps to walls)',
  'plan.toolVertex': 'Vertex',
  'plan.toolVertexTitle': 'Drag room corners to reshape (orthogonal + grid snap)',
  'plan.toolOpening': 'Openings',
  'plan.toolOpeningTitle':
    'Click a wall to add a door/window; click an existing opening to remove it',
  'plan.toolSplit': 'Split',
  'plan.toolSplitTitle': 'Draw a line inside a rectangular room to split it (door auto-added)',
  'plan.toolMerge': 'Merge',
  'plan.toolMergeTitle': 'Click the room to keep, then click the adjacent room to merge',
  'plan.kindDoor': 'Door',
  'plan.kindWindow': 'Window',
  'plan.toggleDims': 'Dims',
  'plan.toggleDimsTitle': 'Show/hide room dimension annotations (declutter the plan)',
  'plan.hintMove': 'Drag a room body to move it; edges snap to nearby walls',
  'plan.hintVertex': 'Click a room to select it, then drag a corner to reshape (grid-snapped)',
  'plan.hintOpening': 'Click a solid wall to add a {kind}; click an existing opening to remove it',
  'plan.hintSplit':
    'Press and drag inside a room to draw a line (horizontal/vertical); release to split',
  'plan.hintMerge': 'Click the room to keep, then click the adjacent room to merge',
  'plan.mergeFail': 'The two rooms cannot merge: their union is not a rectangle',
  'plan.splitFail': 'Only rectangular rooms can be split, and each side must be ≥ 1m',
  'plan.openingFail': 'Cannot place an opening here (not a solid wall)',

  // ---------- Share & code ----------
  'share.title': 'Share & Code',
  'share.screenshotAlt': 'Scene screenshot preview',
  'share.captureFailed': 'Screenshot failed — you can still copy the code',
  'share.noModel': 'No model yet. Paste a share code to restore one.',
  'share.codeLabel': 'Share code',
  'share.copy': 'Copy code',
  'share.copied': 'Copied',
  'share.restoreTitle': 'Restore from code',
  'share.placeholder': 'Paste a share code…',
  'share.restore': 'Restore',
  'share.invalid': 'Invalid code — could not restore model',
  'share.restored': 'Model restored',
  'share.historyTitle': 'Code history',
  'share.empty': 'No saved codes yet. Codes are recorded after you share a model.',
  'share.unnamed': 'Unnamed model',
  'share.delete': 'Delete',
  'share.deleteConfirm': 'Delete this share record?',
  'share.close': 'Close',

  // ---------- Portrait orientation guard ----------
  'orientation.title': 'Please rotate your device to landscape',
  'orientation.subtitle': 'Landscape mode offers the best experience',

  // ---------- Error messages ----------

  // ---------- Errors ----------
  'error.httpRequestFailed':
    'Model request failed: {detail}. Test connectivity on the Settings page.',
  'error.noJson': "No JSON found in the model's reply, please retry",
  'error.invalidJson': "Couldn't parse the model's JSON, please retry",
  'error.invalidSchema': "The model's JSON doesn't match the v2 structure ({issues}), please retry",
  'error.noOps': 'ops are empty or all invalid',
  'error.unknownFormat': 'Unknown format',
  'error.timeout': 'Request timed out. Check your network or try again later',
  'error.requestFailed': 'Request failed: {detail}',
  'error.httpStatus': 'HTTP {status}: {detail}',
  'error.httpNoDetail': 'HTTP {status}, no detail available',
  'error.noStream': 'Network error: the service returned no data stream',
  'error.streamInterrupted': 'Network error: response stream interrupted ({detail})',
  'error.network': 'Network error: {detail}',
  'error.networkFallback': "Network error: couldn't reach the service",
  'error.connected': 'Connected: model {model}',
  'error.unknownModel': 'unknown',
  'error.authFailed': 'Invalid or unauthorized API Key (401/403)',
  'error.modelMissing':
    "API reachable, but the model doesn't exist — check the model name and Base URL",
  'error.boundaryTitle': 'Something went wrong',
  'error.boundaryDesc':
    'The app hit an unexpected error (usually corrupted local data). You can retry, or reset local data and start fresh.',
  'error.boundaryReset': 'Reset local data',
  'error.boundaryRetry': 'Retry',
}

/** 翻译：按语言取词典，{key} 插值替换；缺 key 回退 zh，再回退 key 本身 */
export function translate(lang: Lang, key: TKey, params?: Record<string, string | number>): string {
  const dict = lang === 'en' ? en : zh
  let str = dict[key] ?? zh[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.split(`{${k}}`).join(String(v))
    }
  }
  return str
}
