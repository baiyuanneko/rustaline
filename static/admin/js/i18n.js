// i18n：运行期字典 + t() 取值 + 静态 HTML 填充（data-i18n）。
//
// - 支持语言见 SUPPORTED；新增语言 = 在 DICTS 里补一个同构字典对象，逻辑零改动。
// - 取值回退链：当前语言 → zh-CN（主语言）→ key 本身（便于发现漏翻）。
// - 字典值支持两种形态：字符串（{name} 占位插值）或函数 fn(vars) => string（处理单复数）。
// - 语言判定：localStorage rustaline-lang > navigator.language（zh* → zh-CN，其余 → en）。

const STORAGE_KEY = "rustaline-lang";

export const SUPPORTED = ["zh-CN", "en"];

const DICTS = {
  "zh-CN": {
    // ---- 通用 ----
    "common.loading": "加载中…",
    "common.empty": "暂无数据",
    "common.noRecords": "无记录",
    "common.pageInfo": ({ from, to, total }) => `${from}–${to} / 共 ${total} 条`,
    "common.prevPage": "上一页",
    "common.nextPage": "下一页",
    "common.confirmTitle": "确认操作",
    "common.ok": "确定",
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.done": "完成",
    "common.detail": "详情",
    "common.loadFailed": "加载失败",
    "common.opSuccess": "操作成功",
    "common.opFailed": "操作失败",
    "common.anonymous": "Anonymous",
    "common.yes": "是",
    "common.no": "否",

    // ---- 评论状态 ----
    "status.approved": "已通过",
    "status.pending": "待审核",
    "status.spam": "垃圾",
    "status.unknown": "未知",

    // ---- 相对时间 ----
    "time.secondsAgo": (n) => `${n} 秒前`,
    "time.minutesAgo": (n) => `${n} 分钟前`,
    "time.hoursAgo": (n) => `${n} 小时前`,
    "time.daysAgo": (n) => `${n} 天前`,

    // ---- API 层 ----
    "api.networkError": ({ msg }) => `网络错误：${msg}`,
    "api.networkDown": "无法连接服务器",
    "api.unauthorized": "未授权或登录已过期",
    "api.requestFailed": ({ status }) => `请求失败（HTTP ${status}）`,

    // ---- 外壳 / 导航 ----
    "app.title": "rustaline · 管理面板",
    "app.subtitle": "/ 管理面板",
    "nav.dashboard": "仪表盘",
    "nav.comments": "评论管理",
    "nav.import": "Valine 导入",
    "nav.settings": "设置",
    "nav.debug": "调试 SDK",

    // ---- 调试页 ----
    "debug.title": "调试",
    "debug.subtitle": "自定义 SDK 构造参数，右侧实时预览评论实例；任一参数变更即销毁重建",
    "debug.lang": "语言",
    "debug.dark": "明暗",
    "debug.color": "主题色",
    "debug.customColor": "自定义颜色",
    "debug.loadFailed": "SDK 加载失败",
    "nav.toggle": "切换导航",
    "nav.backToDashboard": "返回仪表盘",
    "nav.swagger": "Swagger UI ↗",
    "nav.demo": "演示页 ↗",
    "nav.demoDisabledTitle": "演示页已禁用",
    "nav.demoDisabled": "演示页已被环境变量禁用",
    "nav.swaggerDisabledTitle": "Swagger UI 已禁用",
    "nav.swaggerDisabled": "Swagger UI 已被环境变量禁用，API 文档不可访问",

    // ---- 外观 / 偏好 ----
    "prefs.openLabel": "外观设置",
    "prefs.title": "外观",
    "prefs.themeColor": "主题色",
    "prefs.darkMode": "明暗模式",
    "prefs.modeAuto": "跟随系统",
    "prefs.modeLight": "浅色",
    "prefs.modeDark": "深色",
    "prefs.language": "语言",
    "prefs.colorLabel": ({ name }) => `主题色 ${name}`,
    "color.blue": "蓝",
    "color.indigo": "靛蓝",
    "color.purple": "紫",
    "color.pink": "粉",
    "color.red": "红",
    "color.orange": "橙",
    "color.green": "绿",
    "color.teal": "青",

    // ---- 认证 ----
    "auth.loginTitle": "管理面板登录",
    "auth.username": "用户名",
    "auth.password": "密码",
    "auth.login": "登录",
    "auth.logout": "登出",
    "auth.initialHint":
      "初始账号由环境变量 APP_INITIAL_ADMIN_USERNAME / APP_INITIAL_ADMIN_PASSWORD 在首次启动时写入；改密码请在设置页操作",
    "auth.requiredFields": "请输入用户名和密码",
    "auth.loggedOut": "已登出",
    "auth.sessionCleared": "登录状态已清除",
    "auth.sessionExpired": "登录已失效",
    "auth.loginAgain": "请重新登录",

    // ---- 仪表盘 ----
    "dash.title": "仪表盘",
    "dash.subtitle": "评论系统总览与各页面热度",
    "dash.refresh": "刷新",
    "dash.loading": "加载统计数据…",
    "dash.loadFailed": "统计数据加载失败",
    "dash.total": "评论总数",
    "dash.todayNew": "今日新增",
    "dash.cardHint": "点击查看对应评论",
    "dash.rankTitle": "URL 评论数排行",
    "dash.rankSubtitle": "按文章评论数倒序，取前 10",
    "dash.debugSdk": "调试 SDK",
    "dash.debugSdkTitle": "在调试页打开该 URL 的评论实例",
    "dash.rankEmptyHint": "尚无评论或未生成统计",
    "dash.emptyUrl": "(空 URL)",
    "dash.itemCount": (n) => `${n} 条`,

    // ---- 评论筛选 ----
    "filter.status": "状态",
    "filter.allStatus": "全部状态",
    "filter.keyword": "关键词",
    "filter.keywordPlaceholder": "搜索昵称 / 邮箱 / 评论内容",
    "filter.search": "查询",
    "filter.reset": "重置",
    "filter.url": "URL",
    "filter.urlPlaceholder": "输入 URL，支持筛选或直接输入任意 URL",
    "filter.allUrls": "全部 URL",
    "filter.noMatchedUrl": "没有匹配的 URL",
    "filter.useThisUrl": "按此 URL 筛选：{url}",
    "filter.from": "起始日期（UTC）",

    // ---- 评论管理 ----
    "comments.title": "评论管理",
    "comments.subtitle": "审核、删除、按状态/文章/关键词筛选",
    "comments.loadFailed": "加载评论失败",
    "comments.filterBannerPrefix": "当前正在查看在特定筛选条件下的评论列表，若需查看全部评论，请",
    "comments.filterBannerAction": "点此重置筛选条件",
    "comments.noMatch": "没有匹配的评论",
    "comments.noMatchHint": "尝试调整筛选条件，或前往导入页导入历史数据",
    "comments.colAuthor": "作者",
    "comments.colContent": "评论内容",
    "comments.colUrl": "URL",
    "comments.colStatus": "状态",
    "comments.colTime": "时间",
    "comments.colActions": "操作",
    "comments.mailTitle": ({ mail }) => `邮箱：${mail}`,
    "comments.viewFull": "点击查看完整内容",
    "comments.replyTo": ({ nick }) => `回复 @${nick}`,
    "comments.replyToDeleted": "回复一条评论",
    "comments.mdImage": "图片",
    "comments.mdImageError": "图片加载失败：",
    "comments.parentIdTitle": ({ pid }) => `父评论 ID：${pid}`,
    "comments.detailTitle": "评论详情",
    "comments.noMail": "(无邮箱)",
    "comments.emptyComment": "(空评论)",

    // ---- 评论操作 ----
    "action.approve": "通过",
    "action.markSpam": "标垃圾",
    "action.markSpamFull": "标为垃圾",
    "action.restore": "恢复",
    "action.backToPending": "退回待审",
    "action.delete": "删除",
    "action.statusUpdated": ({ label }) => `已更新状态为「${label}」`,
    "action.deleteConfirmTitle": "确认删除该评论？",
    "action.deleteConfirmBody": "删除后不可恢复。子评论会自动降级为根评论（不连坐整楼）。",
    "action.deleted": "已删除",
    "action.deletedMsg": "评论已移除",
    "action.deleteFailed": "删除失败",

    // ---- 评论详情字段 ----
    "detail.commentId": "评论 ID",
    "detail.url": "URL",
    "detail.pid": "父评论 pid",
    "detail.rid": "根评论 rid",
    "detail.link": "个人链接",
    "detail.qqAvatar": "QQ 头像",
    "detail.ip": "IP",
    "detail.uaSummary": "评论者环境",
    "detail.linkConfirmTitle": "打开外部链接",
    "detail.linkConfirmText": "即将在新标签页打开外部链接，确定继续吗？",
    "detail.linkConfirmProceed": "继续访问",
    "detail.ua": "User-Agent",
    "detail.insertedAt": "插入时间",
    "detail.createdAt": "创建时间",
    "detail.updatedAt": "更新时间",
    "detail.notified": "已通知",

    // ---- Valine 导入 ----
    "import.title": "Valine 数据导入",
    "import.subtitle": "支持 LeanCloud 导出 JSON：分批上传、实时进度、汇总报告",
    "import.dropzoneLabel": "选择或拖入 JSON 文件",
    "import.dropzoneTitle": "点击选择 JSON 文件，或拖入此处",
    "import.dropzoneHint": ({ batch }) => `支持 .json；每批 ${batch} 条顺序上传，可处理十万级数据`,
    "import.pasteTitle": "或粘贴 JSON 内容",
    "import.jsonContent": "JSON 内容",
    "import.parse": "解析粘贴内容",
    "import.noContent": "无内容",
    "import.noContentMsg": "请粘贴 JSON 文本",
    "import.noValidData": "无有效数据",
    "import.emptyResult": "解析结果为空数组",
    "import.parseFailed": "JSON 解析失败",
    "import.parseErrorPos": ({ pos, msg }) => `位置 ${pos}：${msg}`,
    "import.errorLine": ({ line }) => `行 ${line}`,
    "import.pasteSource": "粘贴内容",
    "import.unsupportedType": "文件类型不支持",
    "import.unsupportedTypeMsg": ({ type }) => `文件类型 ${type} 不被支持，请选择 JSON 文件`,
    "import.unknownType": "未知",
    "import.reading": ({ name, size }) => `正在读取 ${name}（${size}）…`,
    "import.noImportable": "无可导入数据",
    "import.noResultsMsg": "JSON 中未找到 results 数组或顶层并非数组",
    "import.parsed": ({ n }) => `已解析 ${n} 条记录，准备导入…`,
    "import.parseErrorMsg": ({ msg }) => `解析失败：${msg}`,
    "import.readFailed": "文件读取失败",
    "import.fileReaderError": "FileReader 错误",
    "import.parseDone": "解析完成",
    "import.batchPlan": ({ total, batches, source }) => `共 ${total} 条，将分 ${batches} 批导入（来源：${source}）`,
    "import.stagedMsg": ({ total, batches, source }) =>
      `已暂存 ${total} 条 / ${batches} 批（来源：${source}）。向下滚动点击「开始导入」`,
    "import.startImport": ({ total }) => `开始导入（${total} 条）`,
    "import.progressTitle": "导入进度",
    "import.cancelConfirmTitle": "确认取消剩余批次导入？",
    "import.cancelConfirmBody": "已完成批次不会回滚。",
    "import.cancelConfirm": "取消导入",
    "import.cancelAbort": "继续导入",
    "import.preparing": "准备中…",
    "import.batchLog": "批次日志",
    "import.reportTitle": "导入汇总报告",
    "import.clear": "清除",
    "import.errorDetails": "错误明细（前 20 条）",
    "import.importing": "导入中…",
    "import.logStart": ({ total, batches }) => `开始导入 ${total} 条 / ${batches} 批`,
    "import.logCancelled": ({ from, left }) => `用户取消，跳过第 ${from} 批及之后 ${left} 批`,
    "import.logBatchStart": ({ index, total, size }) => `→ 第 ${index} / ${total} 批（${size} 条）`,
    "import.logBatchDone": ({ index, imported, duplicates, invalid, ms }) =>
      `✓ 第 ${index} 批完成：导入 ${imported} / 重复 ${duplicates} / 无效 ${invalid}（耗时 ${ms}ms）`,
    "import.logBatchCancelled": ({ index }) => `第 ${index} 批已取消`,
    "import.logBatchFailed": ({ index, msg }) => `✗ 第 ${index} 批失败：${msg}`,
    "import.batchTag": ({ index }) => `[批次 ${index}]`,
    "import.cancelled": "已取消",
    "import.done": "完成",
    "import.reimport": "重新导入",
    "import.logEnd": ({ imported, duplicates, invalid, errors }) =>
      `导入结束：成功 ${imported} / 重复 ${duplicates} / 无效 ${invalid} / 错误 ${errors}`,
    "import.cancelledToast": "已取消",
    "import.cancelledToastMsg": ({ imported }) => `已停止剩余批次。本次成功导入 ${imported} 条`,
    "import.doneToast": "导入完成",
    "import.doneToastMsg": ({ imported, duplicates }) => `成功 ${imported} 条，重复跳过 ${duplicates} 条`,

    // ---- 导入报告 ----
    "report.total": "总记录数",
    "report.imported": "成功导入",
    "report.duplicates": "重复跳过",
    "report.invalid": "无效跳过",
    "report.errors": "错误明细",
    "report.status": "状态",
    "report.noErrors": "无错误",
    "report.moreErrors": ({ n }) => `… 还有 ${n} 条未显示`,

    // ---- 设置 ----
    "settings.title": "设置",
    "settings.subtitle": "评论模块当前生效配置（只读）",
    "settings.loading": "加载配置…",
    "settings.loadFailed": "配置加载失败",
    "settings.commentConfig": "comment 配置",
    "settings.hintModeration": "新评论是否需要审核（true 时为 pending，否则直接 approved）",
    "settings.hintMaxLength": "评论最大字符数",
    "settings.hintRateLimit": "单 IP 每分钟最多提交数",
    "settings.hintDefaultNick": "未提供昵称时的默认值",
    "settings.hintAvatarCdn": "邮箱头像 CDN（gravatar 协议镜像）；空 = 禁用邮箱头像层",
    "settings.hintDisplayUa": "是否在公共评论响应中下发 UA 解析摘要（ua_summary）；开启后 SDK 在评论旁显示评论者浏览器/系统徽章",
    "settings.hintVersion": "后端版本号",
    "settings.emptyValue": "(空)",
    "settings.configNotePre": "如需修改配置，请编辑 ",
    "settings.configNoteMid": " 或设置环境变量（如 ",
    "settings.configNotePost": "），重启服务后生效。",
    "settings.accountSecurity": "账号安全",
    "settings.passwordNote": "修改成功后所有已登录状态（包括当前会话）将立即失效，需要重新登录。",
    "settings.changePassword": "修改密码",
    "settings.currentPassword": "当前密码",
    "settings.newPassword": "新密码（至少 8 个字符）",
    "settings.confirmPassword": "确认新密码",
    "settings.updatePassword": "更新密码",
    "settings.fillAll": "请填写全部字段",
    "settings.tooShort": "新密码至少 8 个字符",
    "settings.mismatch": "两次输入的新密码不一致",
    "settings.updated": "密码已更新",
    "settings.updatedMsg": "请使用新密码重新登录",
  },

  en: {
    // ---- common ----
    "common.loading": "Loading…",
    "common.empty": "No data",
    "common.noRecords": "No records",
    "common.pageInfo": ({ from, to, total }) => `${from}–${to} of ${total}`,
    "common.prevPage": "Previous page",
    "common.nextPage": "Next page",
    "common.confirmTitle": "Confirm",
    "common.ok": "OK",
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.done": "Done",
    "common.detail": "Details",
    "common.loadFailed": "Load failed",
    "common.opSuccess": "Success",
    "common.opFailed": "Operation failed",
    "common.anonymous": "Anonymous",
    "common.yes": "Yes",
    "common.no": "No",

    // ---- status ----
    "status.approved": "Approved",
    "status.pending": "Pending",
    "status.spam": "Spam",
    "status.unknown": "Unknown",

    // ---- relative time ----
    "time.secondsAgo": (n) => (n === 1 ? "1 second ago" : `${n} seconds ago`),
    "time.minutesAgo": (n) => (n === 1 ? "1 minute ago" : `${n} minutes ago`),
    "time.hoursAgo": (n) => (n === 1 ? "1 hour ago" : `${n} hours ago`),
    "time.daysAgo": (n) => (n === 1 ? "1 day ago" : `${n} days ago`),

    // ---- api layer ----
    "api.networkError": ({ msg }) => `Network error: ${msg}`,
    "api.networkDown": "Cannot reach server",
    "api.unauthorized": "Unauthorized or session expired",
    "api.requestFailed": ({ status }) => `Request failed (HTTP ${status})`,

    // ---- shell / nav ----
    "app.title": "rustaline · Admin",
    "app.subtitle": "/ Admin",
    "nav.dashboard": "Dashboard",
    "nav.comments": "Comments",
    "nav.import": "Valine Import",
    "nav.settings": "Settings",
    "nav.debug": "Debug SDK",

    // ---- debug page ----
    "debug.title": "Debug",
    "debug.subtitle": "Customize SDK constructor options with a live comment preview on the right; rebuilt on every change",
    "debug.lang": "Language",
    "debug.dark": "Theme mode",
    "debug.color": "Theme color",
    "debug.customColor": "Custom color",
    "debug.loadFailed": "Failed to load the SDK",
    "nav.toggle": "Toggle navigation",
    "nav.backToDashboard": "Back to dashboard",
    "nav.swagger": "Swagger UI ↗",
    "nav.demo": "Demo ↗",
    "nav.demoDisabledTitle": "Demo page disabled",
    "nav.demoDisabled": "The demo page has been disabled by environment variable",
    "nav.swaggerDisabledTitle": "Swagger UI disabled",
    "nav.swaggerDisabled": "Swagger UI has been disabled by environment variable; API docs are unavailable",

    // ---- appearance / prefs ----
    "prefs.openLabel": "Appearance",
    "prefs.title": "Appearance",
    "prefs.themeColor": "Theme color",
    "prefs.darkMode": "Dark mode",
    "prefs.modeAuto": "System",
    "prefs.modeLight": "Light",
    "prefs.modeDark": "Dark",
    "prefs.language": "Language",
    "prefs.colorLabel": ({ name }) => `Color ${name}`,
    "color.blue": "Blue",
    "color.indigo": "Indigo",
    "color.purple": "Purple",
    "color.pink": "Pink",
    "color.red": "Red",
    "color.orange": "Orange",
    "color.green": "Green",
    "color.teal": "Teal",

    // ---- auth ----
    "auth.loginTitle": "Admin Sign In",
    "auth.username": "Username",
    "auth.password": "Password",
    "auth.login": "Sign in",
    "auth.logout": "Sign out",
    "auth.initialHint":
      "The initial account is seeded from APP_INITIAL_ADMIN_USERNAME / APP_INITIAL_ADMIN_PASSWORD on first launch; change your password on the Settings page",
    "auth.requiredFields": "Please enter username and password",
    "auth.loggedOut": "Signed out",
    "auth.sessionCleared": "Session cleared",
    "auth.sessionExpired": "Session expired",
    "auth.loginAgain": "Please sign in again",

    // ---- dashboard ----
    "dash.title": "Dashboard",
    "dash.subtitle": "Comment system overview and per-page activity",
    "dash.refresh": "Refresh",
    "dash.loading": "Loading stats…",
    "dash.loadFailed": "Failed to load stats",
    "dash.total": "Total comments",
    "dash.todayNew": "Today",
    "dash.cardHint": "Click to view the matching comments",
    "dash.rankTitle": "Top URLs by comments",
    "dash.rankSubtitle": "Top 10 URLs sorted by comment count",
    "dash.debugSdk": "Debug SDK",
    "dash.debugSdkTitle": "Open a comment instance for this URL in the debug page",
    "dash.rankEmptyHint": "No comments yet or stats unavailable",
    "dash.emptyUrl": "(empty URL)",
    "dash.itemCount": (n) => (n === 1 ? "1 comment" : `${n} comments`),

    // ---- comment filters ----
    "filter.status": "Status",
    "filter.allStatus": "All statuses",
    "filter.keyword": "Keyword",
    "filter.keywordPlaceholder": "Search nick / email / content",
    "filter.search": "Search",
    "filter.reset": "Reset",
    "filter.url": "URL",
    "filter.urlPlaceholder": "Type a URL to filter, or enter any URL",
    "filter.allUrls": "All URLs",
    "filter.noMatchedUrl": "No matching URL",
    "filter.useThisUrl": "Filter by this URL: {url}",
    "filter.from": "From date (UTC)",

    // ---- comments view ----
    "comments.title": "Comments",
    "comments.subtitle": "Moderate, delete, filter by status / URL / keyword",
    "comments.loadFailed": "Failed to load comments",
    "comments.filterBannerPrefix": "You are viewing comments under specific filters. To view all comments, ",
    "comments.filterBannerAction": "click here to reset the filters",
    "comments.noMatch": "No matching comments",
    "comments.noMatchHint": "Try adjusting the filters, or import legacy data on the Import page",
    "comments.colAuthor": "Author",
    "comments.colContent": "Comment",
    "comments.colUrl": "URL",
    "comments.colStatus": "Status",
    "comments.colTime": "Time",
    "comments.colActions": "Actions",
    "comments.mailTitle": ({ mail }) => `Email: ${mail}`,
    "comments.viewFull": "Click to view full content",
    "comments.replyTo": ({ nick }) => `Reply to @${nick}`,
    "comments.replyToDeleted": "Reply to a comment",
    "comments.mdImage": "image",
    "comments.mdImageError": "Failed to load image:",
    "comments.parentIdTitle": ({ pid }) => `Parent comment ID: ${pid}`,
    "comments.detailTitle": "Comment details",
    "comments.noMail": "(no email)",
    "comments.emptyComment": "(empty comment)",

    // ---- comment actions ----
    "action.approve": "Approve",
    "action.markSpam": "Spam",
    "action.markSpamFull": "Mark as spam",
    "action.restore": "Restore",
    "action.backToPending": "Back to pending",
    "action.delete": "Delete",
    "action.statusUpdated": ({ label }) => `Status updated to "${label}"`,
    "action.deleteConfirmTitle": "Delete this comment?",
    "action.deleteConfirmBody":
      "This cannot be undone. Child replies are kept and promoted to top level.",
    "action.deleted": "Deleted",
    "action.deletedMsg": "Comment removed",
    "action.deleteFailed": "Delete failed",

    // ---- comment detail fields ----
    "detail.commentId": "Comment ID",
    "detail.url": "URL",
    "detail.pid": "Parent pid",
    "detail.rid": "Root rid",
    "detail.link": "Website",
    "detail.qqAvatar": "QQ avatar",
    "detail.ip": "IP",
    "detail.uaSummary": "Commenter UA (parsed)",
    "detail.linkConfirmTitle": "Open external link",
    "detail.linkConfirmText": "The external link will open in a new tab. Continue?",
    "detail.linkConfirmProceed": "Continue",
    "detail.ua": "User-Agent",
    "detail.insertedAt": "Inserted at",
    "detail.createdAt": "Created at",
    "detail.updatedAt": "Updated at",
    "detail.notified": "Notified",

    // ---- Valine import ----
    "import.title": "Valine Data Import",
    "import.subtitle": "Import LeanCloud-exported JSON: batched upload, live progress, summary report",
    "import.dropzoneLabel": "Select or drop a JSON file",
    "import.dropzoneTitle": "Click to choose a JSON file, or drop it here",
    "import.dropzoneHint": ({ batch }) =>
      `.json supported; uploads in sequential batches of ${batch}; handles 100k+ records`,
    "import.pasteTitle": "Or paste JSON",
    "import.jsonContent": "JSON content",
    "import.parse": "Parse pasted content",
    "import.noContent": "Nothing pasted",
    "import.noContentMsg": "Please paste JSON text",
    "import.noValidData": "No valid data",
    "import.emptyResult": "Parsed result is an empty array",
    "import.parseFailed": "JSON parse failed",
    "import.parseErrorPos": ({ pos, msg }) => `at ${pos}: ${msg}`,
    "import.errorLine": ({ line }) => `line ${line}`,
    "import.pasteSource": "pasted content",
    "import.unsupportedType": "Unsupported file type",
    "import.unsupportedTypeMsg": ({ type }) => `File type ${type} is not supported; choose a JSON file`,
    "import.unknownType": "unknown",
    "import.reading": ({ name, size }) => `Reading ${name} (${size})…`,
    "import.noImportable": "Nothing to import",
    "import.noResultsMsg": "No results array found and top level is not an array",
    "import.parsed": ({ n }) => `Parsed ${n} records, ready to import…`,
    "import.parseErrorMsg": ({ msg }) => `Parse failed: ${msg}`,
    "import.readFailed": "Failed to read file",
    "import.fileReaderError": "FileReader error",
    "import.parseDone": "Parsed",
    "import.batchPlan": ({ total, batches, source }) =>
      `${total} records in ${batches} batches (source: ${source})`,
    "import.stagedMsg": ({ total, batches, source }) =>
      `Staged ${total} records / ${batches} batches (source: ${source}). Scroll down and click "Start import"`,
    "import.startImport": ({ total }) => `Start import (${total})`,
    "import.progressTitle": "Import progress",
    "import.cancelConfirmTitle": "Cancel remaining batches?",
    "import.cancelConfirmBody": "Completed batches will not be rolled back.",
    "import.cancelConfirm": "Cancel import",
    "import.cancelAbort": "Continue import",
    "import.preparing": "Preparing…",
    "import.batchLog": "Batch log",
    "import.reportTitle": "Import summary",
    "import.clear": "Clear",
    "import.errorDetails": "Error details (first 20)",
    "import.importing": "Importing…",
    "import.logStart": ({ total, batches }) => `Importing ${total} records in ${batches} batches`,
    "import.logCancelled": ({ from, left }) => `Cancelled by user; skipped batch ${from} and ${left} more`,
    "import.logBatchStart": ({ index, total, size }) => `→ Batch ${index} / ${total} (${size} records)`,
    "import.logBatchDone": ({ index, imported, duplicates, invalid, ms }) =>
      `✓ Batch ${index} done: ${imported} imported / ${duplicates} duplicates / ${invalid} invalid (${ms}ms)`,
    "import.logBatchCancelled": ({ index }) => `Batch ${index} cancelled`,
    "import.logBatchFailed": ({ index, msg }) => `✗ Batch ${index} failed: ${msg}`,
    "import.batchTag": ({ index }) => `[batch ${index}]`,
    "import.cancelled": "Cancelled",
    "import.done": "Done",
    "import.reimport": "Import again",
    "import.logEnd": ({ imported, duplicates, invalid, errors }) =>
      `Finished: ${imported} imported / ${duplicates} duplicates / ${invalid} invalid / ${errors} errors`,
    "import.cancelledToast": "Cancelled",
    "import.cancelledToastMsg": ({ imported }) =>
      `Remaining batches stopped. ${imported} imported this run`,
    "import.doneToast": "Import complete",
    "import.doneToastMsg": ({ imported, duplicates }) =>
      `${imported} imported, ${duplicates} duplicates skipped`,

    // ---- import report ----
    "report.total": "Total records",
    "report.imported": "Imported",
    "report.duplicates": "Duplicates",
    "report.invalid": "Invalid",
    "report.errors": "Errors",
    "report.status": "Status",
    "report.noErrors": "No errors",
    "report.moreErrors": ({ n }) => `… ${n} more not shown`,

    // ---- settings ----
    "settings.title": "Settings",
    "settings.subtitle": "Current comment-module configuration (read-only)",
    "settings.loading": "Loading config…",
    "settings.loadFailed": "Failed to load config",
    "settings.commentConfig": "comment configuration",
    "settings.hintModeration": "Whether new comments need moderation (true = pending, otherwise approved)",
    "settings.hintMaxLength": "Maximum comment length",
    "settings.hintRateLimit": "Max submissions per IP per minute",
    "settings.hintDefaultNick": "Default nick when none provided",
    "settings.hintAvatarCdn": "Email avatar CDN (gravatar-compatible mirror); empty = disable email avatars",
    "settings.hintDisplayUa": "Whether to include the parsed UA summary (ua_summary) in public comment responses; when enabled the SDK shows a browser/OS badge next to comments",
    "settings.hintVersion": "Backend version",
    "settings.emptyValue": "(empty)",
    "settings.configNotePre": "To change configuration, edit ",
    "settings.configNoteMid": " or set environment variables (e.g. ",
    "settings.configNotePost": "), then restart the service.",
    "settings.accountSecurity": "Account security",
    "settings.passwordNote":
      "After a successful change, all sessions (including this one) are revoked immediately; sign in again.",
    "settings.changePassword": "Change password",
    "settings.currentPassword": "Current password",
    "settings.newPassword": "New password (at least 8 characters)",
    "settings.confirmPassword": "Confirm new password",
    "settings.updatePassword": "Update password",
    "settings.fillAll": "Please fill in all fields",
    "settings.tooShort": "New password must be at least 8 characters",
    "settings.mismatch": "The two new passwords do not match",
    "settings.updated": "Password updated",
    "settings.updatedMsg": "Please sign in with your new password",
  },
};

/** 语言判定：localStorage > navigator.language（zh* → zh-CN，其余 → en） */
export function getLang() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
  if (saved && SUPPORTED.includes(saved)) return saved;
  const nav = (navigator.language || "").toLowerCase();
  return nav.startsWith("zh") ? "zh-CN" : "en";
}

export function setLang(code) {
  if (!SUPPORTED.includes(code)) return;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch (_) {
    /* ignore */
  }
  applyStaticTexts();
}

/**
 * 取文案。字典值：字符串走 {name} 插值；函数以 vars 对象调用（处理单复数）。
 * 回退：当前语言 → zh-CN → key 本身。
 */
export function t(key, vars) {
  const lang = getLang();
  const v = (DICTS[lang] && DICTS[lang][key]) ?? DICTS["zh-CN"][key] ?? key;
  if (typeof v === "function") return v(vars == null ? {} : vars);
  if (typeof v === "string" && vars) {
    return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  return v;
}

/** 填充静态 HTML：[data-i18n] → textContent；[data-i18n-aria] → aria-label */
export function applyStaticTexts(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria")));
  });
  document.documentElement.lang = getLang();
  document.title = t("app.title");
}
