import { useState } from "react";
import { AppLayout, type AdminTab } from "./components/Layout";
import { DashboardView } from "./features/DashboardView";
import { LoginScreen } from "./components/LoginScreen";
import { DriverBoard } from "./features/DriverBoard";
import { ExportView } from "./features/ExportView";
import { FieldTaskBoard } from "./features/FieldTaskBoard";
import { HistoryDataView } from "./features/HistoryDataView";
import { ImportPreviewView } from "./features/ImportPreviewView";
import { LoadingItemManagement } from "./features/LoadingItemManagement";
import { MasterManagement } from "./features/MasterManagement";
import { OperationLogView } from "./features/OperationLogView";
import { PerformanceAnalysisView } from "./features/PerformanceAnalysisView";
import { RouteLinkManagement } from "./features/RouteLinkManagement";
import { RouteManagement } from "./features/RouteManagement";
import { TaskManagement } from "./features/TaskManagement";
import { TemplateGenerationView } from "./features/TemplateGenerationView";
import { UserManagement } from "./features/UserManagement";
import { useAuthUser } from "./hooks/useAuthUser";
import { getDefaultBusinessDate } from "./utils/date";

export default function App() {
  const { appUser, loading, error, login, logout } = useAuthUser();
  const [businessDate, setBusinessDate] = useState(getDefaultBusinessDate());
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");

  if (!appUser) {
    return <LoginScreen error={error} loading={loading} onLogin={login} />;
  }

  const content =
    appUser.role === "admin" ? (
      <>
        {activeTab === "dashboard" ? <DashboardView user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "analysis" ? <PerformanceAnalysisView user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "history" ? <HistoryDataView user={appUser} /> : null}
        {activeTab === "templates" ? <TemplateGenerationView user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "routes" ? <RouteManagement user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "tasks" ? <TaskManagement user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "links" ? <RouteLinkManagement user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "driver" ? <DriverBoard user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "exports" ? <ExportView user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "imports" ? <ImportPreviewView user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "loadingItems" ? <LoadingItemManagement user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "stations" ? <MasterManagement kind="stations" user={appUser} /> : null}
        {activeTab === "lanes" ? <MasterManagement kind="lanes" user={appUser} /> : null}
        {activeTab === "workers" ? <MasterManagement kind="workers" user={appUser} /> : null}
        {activeTab === "users" ? <UserManagement user={appUser} /> : null}
        {activeTab === "field" ? <FieldTaskBoard user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "logs" ? <OperationLogView user={appUser} businessDate={businessDate} /> : null}
      </>
    ) : (
      <FieldTaskBoard user={appUser} businessDate={businessDate} />
    );

  return (
    <AppLayout
      user={appUser}
      businessDate={businessDate}
      onBusinessDateChange={setBusinessDate}
      onLogout={logout}
      activeTab={appUser.role === "admin" ? activeTab : undefined}
      onTabChange={appUser.role === "admin" ? setActiveTab : undefined}
    >
      {content}
    </AppLayout>
  );
}
