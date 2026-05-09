import { useState } from "react";
import { AppLayout, type AdminTab } from "./components/Layout";
import { LoginScreen } from "./components/LoginScreen";
import { DriverBoard } from "./features/DriverBoard";
import { FieldTaskBoard } from "./features/FieldTaskBoard";
import { MasterManagement } from "./features/MasterManagement";
import { OperationLogView } from "./features/OperationLogView";
import { RouteLinkManagement } from "./features/RouteLinkManagement";
import { RouteManagement } from "./features/RouteManagement";
import { TaskManagement } from "./features/TaskManagement";
import { UserManagement } from "./features/UserManagement";
import { useAuthUser } from "./hooks/useAuthUser";
import { getDefaultBusinessDate } from "./utils/date";

export default function App() {
  const { appUser, loading, error, login, logout } = useAuthUser();
  const [businessDate, setBusinessDate] = useState(getDefaultBusinessDate());
  const [activeTab, setActiveTab] = useState<AdminTab>("routes");

  if (!appUser) {
    return <LoginScreen error={error} loading={loading} onLogin={login} />;
  }

  const content =
    appUser.role === "admin" ? (
      <>
        {activeTab === "routes" ? <RouteManagement user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "tasks" ? <TaskManagement user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "links" ? <RouteLinkManagement user={appUser} businessDate={businessDate} /> : null}
        {activeTab === "driver" ? <DriverBoard user={appUser} businessDate={businessDate} /> : null}
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
