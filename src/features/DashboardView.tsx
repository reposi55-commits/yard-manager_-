import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState } from "../components/ui";
import { subscribeDaily } from "../services/firestoreService";
import type { AppUser, Route, RouteLink, Task } from "../types";

type ProgressRow = {
  label: string;
  total: number;
  completed: number;
  inProgress: number;
};

export function DashboardView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [links, setLinks] = useState<RouteLink[]>([]);
  const [error, setError] = useState("");

  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("tasks", user.siteId, businessDate, setTasks, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routeLinks", user.siteId, businessDate, setLinks, setError), [user.siteId, businessDate]);

  const blockedTaskIds = useMemo(() => {
    const result = new Set<string>();
    tasks.forEach((task) => {
      const relatedLinks = links.filter((link) => link.mainRouteId === task.targetMainRouteId);
      const blocked = relatedLinks.some((link) => routes.find((route) => route.id === link.subRouteId)?.status !== "completed");
      if (blocked && task.status !== "completed") result.add(task.id);
    });
    return result;
  }, [tasks, links, routes]);

  const routeSummary = useMemo(
    () => ({
      total: routes.length,
      waiting: routes.filter((route) => route.status === "waiting").length,
      inProgress: routes.filter((route) => route.status === "in_progress").length,
      completed: routes.filter((route) => route.status === "completed").length,
      actualStarted: routes.filter((route) => route.actualStartAt).length,
    }),
    [routes],
  );

  const taskSummary = useMemo(
    () => ({
      total: tasks.length,
      pending: tasks.filter((task) => task.status === "pending").length,
      ready: tasks.filter((task) => task.status === "ready").length,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      blocked: blockedTaskIds.size,
      actualStarted: tasks.filter((task) => task.actualStartAt).length,
    }),
    [tasks, blockedTaskIds],
  );

  const workerProgress = useMemo(
    () =>
      groupProgress(
        tasks,
        (task) => task.workerName || task.workerId || "未設定",
        (task) => task.status === "completed",
        (task) => task.status === "in_progress",
      ),
    [tasks],
  );

  const stationProgress = useMemo(
    () =>
      groupProgress(
        routes,
        (route) => route.stationName || "未設定",
        (route) => route.status === "completed",
        (route) => route.status === "in_progress",
      ),
    [routes],
  );

  const activeTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status === "in_progress")
        .sort((a, b) => a.plannedStartOffsetMin - b.plannedStartOffsetMin)
        .slice(0, 6),
    [tasks],
  );

  const upcomingTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== "completed" && task.status !== "in_progress")
        .sort((a, b) => a.plannedStartOffsetMin - b.plannedStartOffsetMin)
        .slice(0, 6),
    [tasks],
  );

  const hasPlan = routes.length > 0 || tasks.length > 0;

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>ダッシュボード</h2>
        </div>
      </div>
      {error ? <p className="alert">{error}</p> : null}
      {!hasPlan ? <EmptyState message="この対象日の便・タスクはまだありません。" /> : null}

      <div className="dashboard-grid">
        <MetricPanel label="便" value={routeSummary.total} note={`完了 ${routeSummary.completed} / 作業中 ${routeSummary.inProgress}`} />
        <MetricPanel label="タスク" value={taskSummary.total} note={`完了 ${taskSummary.completed} / 作業中 ${taskSummary.inProgress}`} />
        <MetricPanel label="前工程待ち" value={taskSummary.blocked} note="未完了のサブ便があるタスク" />
        <MetricPanel label="実績開始" value={taskSummary.actualStarted + routeSummary.actualStarted} note="便・タスク合計" />
      </div>

      <div className="dashboard-split">
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h3>作業員別タスク進捗</h3>
            <span>{completionRate(taskSummary.completed, taskSummary.total)}%</span>
          </div>
          <ProgressList rows={workerProgress} emptyMessage="タスクがありません。" />
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h3>ステーション別便進捗</h3>
            <span>{completionRate(routeSummary.completed, routeSummary.total)}%</span>
          </div>
          <ProgressList rows={stationProgress} emptyMessage="便がありません。" />
        </section>
      </div>

      <div className="dashboard-split">
        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h3>作業中タスク</h3>
            <span>{activeTasks.length}件</span>
          </div>
          <TaskMiniList tasks={activeTasks} emptyMessage="作業中のタスクはありません。" blockedTaskIds={blockedTaskIds} />
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h3>次の未完了タスク</h3>
            <span>{upcomingTasks.length}件</span>
          </div>
          <TaskMiniList tasks={upcomingTasks} emptyMessage="未完了タスクはありません。" blockedTaskIds={blockedTaskIds} />
        </section>
      </div>
    </Card>
  );
}

function MetricPanel({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <section className="metric-panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}

function ProgressList({ rows, emptyMessage }: { rows: ProgressRow[]; emptyMessage: string }) {
  if (rows.length === 0) return <p className="dashboard-empty">{emptyMessage}</p>;
  return (
    <div className="progress-list">
      {rows.map((row) => {
        const percent = completionRate(row.completed, row.total);
        return (
          <div className="progress-row" key={row.label}>
            <div className="progress-row-top">
              <strong>{row.label}</strong>
              <span>{row.completed}/{row.total}</span>
            </div>
            <div className="progress-track" aria-label={`${row.label} ${percent}%`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <small>作業中 {row.inProgress}件</small>
          </div>
        );
      })}
    </div>
  );
}

function TaskMiniList({ tasks, emptyMessage, blockedTaskIds }: { tasks: Task[]; emptyMessage: string; blockedTaskIds: Set<string> }) {
  if (tasks.length === 0) return <p className="dashboard-empty">{emptyMessage}</p>;
  return (
    <div className="mini-list">
      {tasks.map((task) => (
        <div className="mini-list-item" key={task.id}>
          <div>
            <strong>{task.taskName}</strong>
            <span>{task.workerName} / {task.laneName}</span>
          </div>
          <small>{blockedTaskIds.has(task.id) ? "前工程待ち" : `${task.plannedStartLabel}-${task.plannedEndLabel}`}</small>
        </div>
      ))}
    </div>
  );
}

function groupProgress<T>(
  items: T[],
  getLabel: (item: T) => string,
  isCompleted: (item: T) => boolean,
  isInProgress: (item: T) => boolean,
): ProgressRow[] {
  const map = new Map<string, ProgressRow>();
  items.forEach((item) => {
    const label = getLabel(item);
    const current = map.get(label) || { label, total: 0, completed: 0, inProgress: 0 };
    current.total += 1;
    if (isCompleted(item)) current.completed += 1;
    if (isInProgress(item)) current.inProgress += 1;
    map.set(label, current);
  });
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function completionRate(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}
