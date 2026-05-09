import { CalendarDays, ClipboardList, History, LogOut, MapPinned, RouteIcon, Smartphone, Truck, UserCog, Users } from "lucide-react";
import type { PropsWithChildren } from "react";
import { DateSelector, SecondaryButton } from "./ui";
import type { AppUser } from "../types";

export type AdminTab = "routes" | "tasks" | "links" | "driver" | "stations" | "lanes" | "workers" | "users" | "field" | "logs";

const adminItems: Array<{ id: AdminTab; label: string; icon: typeof Truck }> = [
  { id: "routes", label: "便管理", icon: Truck },
  { id: "tasks", label: "タスク管理", icon: ClipboardList },
  { id: "links", label: "便紐付け", icon: RouteIcon },
  { id: "driver", label: "ドライバー", icon: CalendarDays },
  { id: "stations", label: "ステーション", icon: MapPinned },
  { id: "lanes", label: "レーン", icon: RouteIcon },
  { id: "workers", label: "作業員", icon: Users },
  { id: "users", label: "ユーザー管理", icon: UserCog },
  { id: "field", label: "作業カード", icon: Smartphone },
  { id: "logs", label: "操作履歴", icon: History },
];

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
          <p className="eyebrow">YardManager Phase 1</p>
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
        <nav className="main-nav" aria-label="管理メニュー">
          {adminItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={activeTab === item.id ? "active" : ""} type="button" onClick={() => onTabChange(item.id)}>
                <Icon size={18} aria-hidden />
                {item.label}
              </button>
            );
          })}
        </nav>
      ) : null}
      <main className={user.role === "admin" ? "app-main" : "app-main field-main"}>{children}</main>
    </div>
  );
}
