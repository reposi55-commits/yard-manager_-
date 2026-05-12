import { Archive, BarChart3, CalendarDays, ClipboardList, Download, History, LogOut, MapPinned, RouteIcon, Smartphone, TrendingUp, Truck, Upload, UserCog, Users } from "lucide-react";
import type { PropsWithChildren } from "react";
import { DateSelector, SecondaryButton } from "./ui";
import type { AppUser } from "../types";

export type AdminTab = "dashboard" | "analysis" | "history" | "templates" | "routes" | "tasks" | "links" | "driver" | "exports" | "imports" | "loadingItems" | "loadingItemImports" | "stations" | "lanes" | "workers" | "users" | "field" | "logs";
type AdminMenuGroupId = "daily" | "masters" | "analysis";

const adminItems: Array<{ id: AdminTab; label: string; icon: typeof Truck }> = [
  { id: "dashboard", label: "ダッシュボード", icon: BarChart3 },
  { id: "analysis", label: "実績分析", icon: TrendingUp },
  { id: "history", label: "過去データ", icon: Archive },
  { id: "templates", label: "テンプレート", icon: CalendarDays },
  { id: "routes", label: "便管理", icon: Truck },
  { id: "tasks", label: "タスク管理", icon: ClipboardList },
  { id: "links", label: "便紐付け", icon: RouteIcon },
  { id: "driver", label: "ドライバー", icon: CalendarDays },
  { id: "exports", label: "CSV出力", icon: Download },
  { id: "imports", label: "CSV取込", icon: Upload },
  { id: "loadingItems", label: "積み付け情報", icon: ClipboardList },
  { id: "loadingItemImports", label: "積み付けCSV取込", icon: Upload },
  { id: "stations", label: "ステーション", icon: MapPinned },
  { id: "lanes", label: "レーン", icon: RouteIcon },
  { id: "workers", label: "作業員", icon: Users },
  { id: "users", label: "ユーザー管理", icon: UserCog },
  { id: "field", label: "作業カード", icon: Smartphone },
  { id: "logs", label: "操作履歴", icon: History },
];

const adminMenuGroups: Array<{ id: AdminMenuGroupId; label: string; description: string; tabs: AdminTab[] }> = [
  {
    id: "daily",
    label: "日次メニュー",
    description: "当日の進捗確認と計画調整",
    tabs: ["dashboard", "routes", "tasks", "loadingItems", "driver", "field"],
  },
  {
    id: "masters",
    label: "マスタ管理メニュー",
    description: "週次・月次の設定と一括登録",
    tabs: ["links", "templates", "imports", "loadingItemImports", "stations", "lanes", "workers", "users"],
  },
  {
    id: "analysis",
    label: "分析・履歴確認メニュー",
    description: "実績分析、控え出力、履歴確認",
    tabs: ["analysis", "history", "exports", "logs"],
  },
];

const adminItemById = new Map(adminItems.map((item) => [item.id, item]));

function getActiveGroup(activeTab: AdminTab) {
  return adminMenuGroups.find((group) => group.tabs.includes(activeTab)) || adminMenuGroups[0];
}

export function AppLayout({
  user,
  businessDate,
  onBusinessDateChange,
  onLogout,
  activeTab,
  onTabChange,
  children,
}: PropsWithChildren<{
  user: AppUser;
  businessDate: string;
  onBusinessDateChange: (value: string) => void;
  onLogout: () => void;
  activeTab?: AdminTab;
  onTabChange?: (tab: AdminTab) => void;
}>) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">YardManager Phase 2</p>
          <h1>{user.role === "admin" ? "管理画面" : "作業員画面"}</h1>
        </div>
        <div className="header-actions">
          <DateSelector value={businessDate} onChange={onBusinessDateChange} />
          <div className="user-chip">
            <span>{user.displayName}</span>
            <small>{user.role === "admin" ? "管理者" : "一般ユーザー"}</small>
          </div>
          <SecondaryButton type="button" onClick={onLogout}>
            <LogOut size={18} aria-hidden /> ログアウト
          </SecondaryButton>
        </div>
      </header>
      {user.role === "admin" && activeTab && onTabChange ? (
        <nav className="admin-menu" aria-label="管理メニュー">
          <div className="menu-groups" role="tablist" aria-label="メニュー分類">
            {adminMenuGroups.map((group) => {
              const isActiveGroup = getActiveGroup(activeTab).id === group.id;
              return (
                <button
                  key={group.id}
                  className={isActiveGroup ? "active" : ""}
                  type="button"
                  onClick={() => onTabChange(group.tabs[0])}
                >
                  <strong>{group.label}</strong>
                  <span>{group.description}</span>
                </button>
              );
            })}
          </div>
          <div className="main-nav" aria-label={`${getActiveGroup(activeTab).label}内メニュー`}>
            {getActiveGroup(activeTab).tabs.map((tabId) => {
              const item = adminItemById.get(tabId);
              if (!item) return null;
              const Icon = item.icon;
              return (
                <button key={item.id} className={activeTab === item.id ? "active" : ""} type="button" onClick={() => onTabChange(item.id)}>
                  <Icon size={18} aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}
      <main className={user.role === "admin" ? "app-main" : "app-main field-main"}>{children}</main>
    </div>
  );
}
