export const SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en-US";
export const LOCALE_COOKIE = "agwmngr.locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const MESSAGES = {
  "app.description": {
    "en-US": "Management dashboard for the agent gateway",
    "zh-CN": "Agent Gateway 管理控制台",
  },
  "language.label": { "en-US": "Language", "zh-CN": "语言" },
  "language.english": { "en-US": "English", "zh-CN": "English" },
  "language.chinese": { "en-US": "简体中文", "zh-CN": "简体中文" },
  "common.admin": { "en-US": "Admin", "zh-CN": "管理员" },
  "common.cancel": { "en-US": "Cancel", "zh-CN": "取消" },
  "common.close": { "en-US": "Close", "zh-CN": "关闭" },
  "common.loadingAccess": { "en-US": "Loading access…", "zh-CN": "正在加载访问权限…" },
  "common.dismiss": { "en-US": "Dismiss", "zh-CN": "关闭通知" },
  "common.loading": { "en-US": "Loading…", "zh-CN": "正在加载…" },
  "common.refresh": { "en-US": "Refresh", "zh-CN": "刷新" },
  "common.refreshing": { "en-US": "Refreshing…", "zh-CN": "正在刷新…" },
  "common.retry": { "en-US": "Retry", "zh-CN": "重试" },
  "common.off": { "en-US": "Off", "zh-CN": "关闭" },
  "common.disabled": { "en-US": "disabled", "zh-CN": "已禁用" },
  "common.updatedJustNow": { "en-US": "updated just now", "zh-CN": "刚刚更新" },
  "common.updatedSeconds": { "en-US": "updated {count}s ago", "zh-CN": "{count} 秒前更新" },
  "common.updatedMinutes": { "en-US": "updated {count}m ago", "zh-CN": "{count} 分钟前更新" },
  "common.updatedHours": { "en-US": "updated {count}h ago", "zh-CN": "{count} 小时前更新" },
  "common.auto": { "en-US": "Auto", "zh-CN": "自动" },
  "auth.signInPrompt": { "en-US": "Sign in to your dashboard", "zh-CN": "登录管理控制台" },
  "auth.username": { "en-US": "Username", "zh-CN": "用户名" },
  "auth.password": { "en-US": "Password", "zh-CN": "密码" },
  "auth.signIn": { "en-US": "Sign in", "zh-CN": "登录" },
  "auth.signingIn": { "en-US": "Signing in…", "zh-CN": "正在登录…" },
  "auth.loginFailed": { "en-US": "Login failed", "zh-CN": "登录失败" },
  "auth.dashboard": { "en-US": "AGW Manager Dashboard", "zh-CN": "AGW Manager 管理控制台" },
  "header.operational": { "en-US": "All systems operational", "zh-CN": "所有系统运行正常" },
  "header.userSettings": { "en-US": "User settings", "zh-CN": "用户设置" },
  "header.toggleMenu": { "en-US": "Toggle menu", "zh-CN": "切换菜单" },
  "gateway.select": { "en-US": "Select gateway", "zh-CN": "选择 Gateway" },
  "gateway.loading": { "en-US": "Loading gateways…", "zh-CN": "正在加载 Gateway…" },
  "gateway.none": { "en-US": "No gateways", "zh-CN": "没有可用的 Gateway" },
  "gateway.switchFailed": { "en-US": "Failed to switch gateway", "zh-CN": "切换 Gateway 失败" },
  "gateway.active": { "en-US": "Active Gateway", "zh-CN": "当前 Gateway" },
  "role.platformAdmin": { "en-US": "Platform Admin", "zh-CN": "平台管理员" },
  "role.gatewayAdmin": { "en-US": "Gateway Admin", "zh-CN": "Gateway 管理员" },
  "role.member": { "en-US": "Member", "zh-CN": "成员" },
  "auth.backendUnavailable": {
    "en-US": "Cannot connect to the backend. Please check that the gateway is running.",
    "zh-CN": "无法连接后端，请确认 Gateway 正在运行。",
  },
  "theme.toLight": { "en-US": "Switch to light theme", "zh-CN": "切换到浅色主题" },
  "theme.toDark": { "en-US": "Switch to dark theme", "zh-CN": "切换到深色主题" },
  "access.noGatewayTitle": { "en-US": "No gateway resource access", "zh-CN": "无 Gateway 资源访问权限" },
  "access.noGatewayBody": {
    "en-US": "Your membership in this gateway is active, but the Member role does not grant gateway-wide access. Ask a Platform Admin to assign the Gateway Admin role.",
    "zh-CN": "你在此 Gateway 中的成员身份有效，但 Member 角色不具备 Gateway 范围的访问权限。请联系平台管理员分配 Gateway Admin 角色。",
  },
  "nav.overview": { "en-US": "Overview", "zh-CN": "概览" },
  "nav.agents": { "en-US": "Agents", "zh-CN": "Agent" },
  "nav.agentRoutes": { "en-US": "Agent Routes", "zh-CN": "Agent 路由" },
  "nav.interactions": { "en-US": "Interactions", "zh-CN": "调用链" },
  "nav.usage": { "en-US": "Usage", "zh-CN": "用量" },
  "nav.virtualKeys": { "en-US": "Virtual Keys", "zh-CN": "虚拟密钥" },
  "nav.credentials": { "en-US": "Credentials", "zh-CN": "凭据" },
  "nav.llm": { "en-US": "LLM", "zh-CN": "LLM" },
  "nav.mcp": { "en-US": "MCP", "zh-CN": "MCP" },
  "nav.providers": { "en-US": "Providers", "zh-CN": "提供商" },
  "nav.models": { "en-US": "Models", "zh-CN": "模型" },
  "nav.routes": { "en-US": "Routes", "zh-CN": "路由" },
  "nav.services": { "en-US": "Services", "zh-CN": "服务" },
  "nav.runtimes": { "en-US": "Runtimes", "zh-CN": "运行时" },
  "nav.acpRuntime": { "en-US": "ACP Runtime", "zh-CN": "ACP 运行时" },
  "nav.builtinRuntime": { "en-US": "Builtin Runtime", "zh-CN": "内置运行时" },
  "nav.configuration": { "en-US": "Configuration", "zh-CN": "配置" },
  "nav.bundle": { "en-US": "Bundle", "zh-CN": "配置包" },
  "nav.servers": { "en-US": "Servers", "zh-CN": "服务器" },
  "nav.platform": { "en-US": "Platform", "zh-CN": "平台" },
  "nav.users": { "en-US": "Users", "zh-CN": "用户" },
  "nav.gateways": { "en-US": "Gateways", "zh-CN": "Gateway" },
  "nav.auditLog": { "en-US": "Audit Log", "zh-CN": "审计日志" },
  "nav.expand": { "en-US": "Expand sidebar", "zh-CN": "展开侧边栏" },
  "nav.collapse": { "en-US": "Collapse sidebar", "zh-CN": "收起侧边栏" },
  "account.dashboardAccount": { "en-US": "Dashboard Account", "zh-CN": "控制台账户" },
  "account.closePanel": { "en-US": "Close panel", "zh-CN": "关闭面板" },
  "account.sessionActive": { "en-US": "Session active", "zh-CN": "会话有效" },
  "account.changePassword": { "en-US": "Change Password", "zh-CN": "修改密码" },
  "account.currentPassword": { "en-US": "Current Password", "zh-CN": "当前密码" },
  "account.newPassword": { "en-US": "New Password", "zh-CN": "新密码" },
  "account.confirmPassword": { "en-US": "Confirm New Password", "zh-CN": "确认新密码" },
  "account.minimumCharacters": { "en-US": "Minimum 8 characters", "zh-CN": "至少 8 个字符" },
  "account.updatePassword": { "en-US": "Update Password", "zh-CN": "更新密码" },
  "account.logout": { "en-US": "Logout", "zh-CN": "退出登录" },
  "date.locale": { "en-US": "en-US", "zh-CN": "zh-CN" },
} as const;

export type MessageKey = keyof typeof MESSAGES;
export type MessageValues = Record<string, string | number>;

export function resolveLocale(value: unknown): Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? value as Locale
    : DEFAULT_LOCALE;
}

export function translate(locale: Locale, key: MessageKey, values: MessageValues = {}): string {
  return MESSAGES[key][locale].replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}
