import { useEffect, useMemo, useState } from "react";
import { where } from "firebase/firestore";
import { Card, EmptyState, Field } from "../components/ui";
import { subscribeCollection } from "../services/firestoreService";
import type { AppUser, OperationLog, Route, Task } from "../types";
import { getDefaultBusinessDate, toDateInputValue } from "../utils/date";

type HistoryRow = {
  businessDate: string;
  routeTotal: number;
  routeCompleted: number;
  taskTotal: number;
  taskCompleted: number;
  taskStarted: number;
  logTotal: number;
};

export function HistoryDataView({ user }: { user: AppUser }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [error, setError] = useState("");
  const [endDate, setEndDate] = useState(getDefaultBusinessDate());
  const [startDate, setStartDate] = useState(() => shiftDate(getDefaultBusinessDate(), -13));

  useEffect(
    () => subscribeCollection<Route>("routes", [where("siteId", "==", user.siteId)], setRoutes, setError),
    [user.siteId],
  );
  useEffect(
    () => subscribeCollection<Task>("tasks", [where("siteId", "==", user.siteId)], setTasks, setError),
    [user.siteId],
  );
  useEffect(
    () => subscribeCollection<OperationLog>("operationLogs", [where("siteId", "==", user.siteId)], setLogs, setError),
    [user.siteId],
  );

  const rows = useMemo(() => buildRows(routes, tasks, logs, startDate, endDate), [routes, tasks, logs, startDate, endDate]);
  const summary = useMemo(
    () => ({
      days: rows.length,
      routeTotal: rows.reduce((sum, row) => sum + row.routeTotal, 0),
      taskTotal: rows.reduce((sum, row) => sum + row.taskTotal, 0),
      completedTasks: rows.reduce((sum, row) => sum + row.taskCompleted, 0),
      logTotal: rows.reduce((sum, row) => sum + row.logTotal, 0),
    }),
    [rows],
  );
  const hasDateError = startDate > endDate;
  const filteredRows = hasDateError ? [] : rows;

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>過去データ確認</h2>
        </div>
      </div>
      <p className="helper-text">
        便・タスク・操作履歴は対象日ごとに残ります。期間を指定して、日別の件数と実績状況を確認できます。
      </p>
      {error ? <p className="alert">{error}</p> : null}
      <div className="filter-bar">
        <Field label="開始日">
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </Field>
        <Field label="終了日">
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </Field>
      </div>
      {hasDateError ? <p className="alert">開始日は終了日以前にしてください。</p> : null}

      <div className="dashboard-grid">
        <Metric label="対象日数" value={`${summary.days}日`} note={`${startDate} - ${endDate}`} />
        <Metric label="便" value={`${summary.routeTotal}件`} note="期間内の便数" />
        <Metric label="タスク" value={`${summary.taskTotal}件`} note={`完了 ${summary.completedTasks}件`} />
        <Metric label="操作履歴" value={`${summary.logTotal}件`} note="期間内の記録数" />
      </div>

      {filteredRows.length === 0 && !hasDateError ? <EmptyState message="この期間の便・タスク・操作履歴はありません。" /> : null}
      {filteredRows.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>対象日</th>
                <th>便</th>
                <th>便完了</th>
                <th>タスク</th>
                <th>タスク完了</th>
                <th>実績開始</th>
                <th>操作履歴</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.businessDate}>
                  <td>{row.businessDate}</td>
                  <td>{row.routeTotal}</td>
                  <td>{row.routeCompleted}</td>
                  <td>{row.taskTotal}</td>
                  <td>{row.taskCompleted}</td>
                  <td>{row.taskStarted}</td>
                  <td>{row.logTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <section className="metric-panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}

function buildRows(routes: Route[], tasks: Task[], logs: OperationLog[], startDate: string, endDate: string): HistoryRow[] {
  if (startDate > endDate) return [];
  const dates = new Set<string>();
  routes.forEach((route) => addDateIfInRange(dates, route.businessDate, startDate, endDate));
  tasks.forEach((task) => addDateIfInRange(dates, task.businessDate, startDate, endDate));
  logs.forEach((log) => addDateIfInRange(dates, log.businessDate, startDate, endDate));

  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((businessDate) => {
      const dailyRoutes = routes.filter((route) => route.businessDate === businessDate);
      const dailyTasks = tasks.filter((task) => task.businessDate === businessDate);
      const dailyLogs = logs.filter((log) => log.businessDate === businessDate);
      return {
        businessDate,
        routeTotal: dailyRoutes.length,
        routeCompleted: dailyRoutes.filter((route) => route.status === "completed").length,
        taskTotal: dailyTasks.length,
        taskCompleted: dailyTasks.filter((task) => task.status === "completed").length,
        taskStarted: dailyTasks.filter((task) => task.actualStartAt).length,
        logTotal: dailyLogs.length,
      };
    });
}

function addDateIfInRange(dates: Set<string>, businessDate: string, startDate: string, endDate: string) {
  if (businessDate >= startDate && businessDate <= endDate) {
    dates.add(businessDate);
  }
}

function shiftDate(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}
