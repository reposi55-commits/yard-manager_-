import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState } from "../components/ui";
import { subscribeDaily } from "../services/firestoreService";
import type { AppUser, FirestoreDate, Route, Task } from "../types";
import { labelToOffsetMin } from "../utils/date";

type AnalysisRow = {
  label: string;
  total: number;
  completed: number;
  completionRate: number;
  averageDurationMin: number | null;
  lateStarts: number;
};

const START_DELAY_THRESHOLD_MIN = 5;

export function PerformanceAnalysisView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");

  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("tasks", user.siteId, businessDate, setTasks, setError), [user.siteId, businessDate]);

  const taskDurations = useMemo(() => tasks.map((task) => durationMinutes(task.actualStartAt, task.actualEndAt)).filter(isNumber), [tasks]);
  const routeDurations = useMemo(() => routes.map((route) => durationMinutes(route.actualStartAt, route.actualEndAt)).filter(isNumber), [routes]);
  const lateTasks = useMemo(() => tasks.filter((task) => isLateStart(task.actualStartAt, task.plannedStartOffsetMin)).length, [tasks]);
  const lateRoutes = useMemo(() => routes.filter((route) => isLateStart(route.actualStartAt, route.plannedStartOffsetMin)).length, [routes]);

  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const completedRoutes = routes.filter((route) => route.status === "completed").length;
  const hasData = routes.length > 0 || tasks.length > 0;

  const workerRows = useMemo(
    () =>
      buildRows(tasks, (task) => task.workerName || task.workerId || "未設定"),
    [tasks],
  );
  const stationRows = useMemo(
    () =>
      buildRows(routes, (route) => route.stationName || "未設定"),
    [routes],
  );

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Performance Analysis</p>
          <h2>実績分析</h2>
        </div>
      </div>
      <p className="helper-text">
        対象日の完了率、平均作業時間、予定開始からの遅れを集計します。遅れは予定開始から{START_DELAY_THRESHOLD_MIN}分超で判定します。
      </p>
      {error ? <p className="alert">{error}</p> : null}
      {!hasData ? <EmptyState message="この対象日の分析対象データはまだありません。" /> : null}

      <div className="analysis-grid">
        <AnalysisMetric label="タスク完了率" value={`${completionRate(completedTasks, tasks.length)}%`} note={`${completedTasks}/${tasks.length}件`} />
        <AnalysisMetric label="便完了率" value={`${completionRate(completedRoutes, routes.length)}%`} note={`${completedRoutes}/${routes.length}件`} />
        <AnalysisMetric label="平均タスク時間" value={formatMinutes(average(taskDurations))} note="開始から完了まで" />
        <AnalysisMetric label="開始遅れ" value={`${lateTasks + lateRoutes}件`} note={`タスク ${lateTasks} / 便 ${lateRoutes}`} />
      </div>

      <div className="analysis-split">
        <section className="analysis-panel">
          <div className="analysis-panel-header">
            <h3>作業員別タスク実績</h3>
            <span>{workerRows.length}名</span>
          </div>
          <AnalysisTable rows={workerRows} emptyMessage="作業員別に集計できるタスクはありません。" />
        </section>

        <section className="analysis-panel">
          <div className="analysis-panel-header">
            <h3>ステーション別便実績</h3>
            <span>{stationRows.length}件</span>
          </div>
          <AnalysisTable rows={stationRows} emptyMessage="ステーション別に集計できる便はありません。" />
        </section>
      </div>

      <div className="analysis-split">
        <section className="analysis-panel">
          <div className="analysis-panel-header">
            <h3>作業時間メモ</h3>
          </div>
          <dl className="analysis-notes">
            <div>
              <dt>タスク平均</dt>
              <dd>{formatMinutes(average(taskDurations))}</dd>
            </div>
            <div>
              <dt>便平均</dt>
              <dd>{formatMinutes(average(routeDurations))}</dd>
            </div>
            <div>
              <dt>実績記録済み</dt>
              <dd>タスク {taskDurations.length}件 / 便 {routeDurations.length}件</dd>
            </div>
          </dl>
        </section>

        <section className="analysis-panel">
          <div className="analysis-panel-header">
            <h3>見方</h3>
          </div>
          <p className="analysis-copy">
            平均時間は開始・完了の両方が記録されたデータだけで計算します。未完了や開始前のデータは件数には含め、平均時間には含めません。
          </p>
        </section>
      </div>
    </Card>
  );
}

function AnalysisMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <section className="analysis-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}

function AnalysisTable({ rows, emptyMessage }: { rows: AnalysisRow[]; emptyMessage: string }) {
  if (rows.length === 0) return <p className="dashboard-empty">{emptyMessage}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>対象</th>
            <th>完了率</th>
            <th>平均時間</th>
            <th>開始遅れ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.completed}/{row.total}件 ({row.completionRate}%)</td>
              <td>{formatMinutes(row.averageDurationMin)}</td>
              <td>{row.lateStarts}件</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildRows<T extends { status: string; actualStartAt?: FirestoreDate; actualEndAt?: FirestoreDate; plannedStartOffsetMin: number }>(
  items: T[],
  getLabel: (item: T) => string,
): AnalysisRow[] {
  const grouped = new Map<string, T[]>();
  items.forEach((item) => {
    const label = getLabel(item);
    grouped.set(label, [...(grouped.get(label) || []), item]);
  });
  return [...grouped.entries()]
    .map(([label, group]) => {
      const durations = group.map((item) => durationMinutes(item.actualStartAt, item.actualEndAt)).filter(isNumber);
      const completed = group.filter((item) => item.status === "completed").length;
      return {
        label,
        total: group.length,
        completed,
        completionRate: completionRate(completed, group.length),
        averageDurationMin: average(durations),
        lateStarts: group.filter((item) => isLateStart(item.actualStartAt, item.plannedStartOffsetMin)).length,
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function durationMinutes(start: FirestoreDate | undefined, end: FirestoreDate | undefined): number | null {
  if (!start || !end) return null;
  const minutes = Math.round((end.toDate().getTime() - start.toDate().getTime()) / 60000);
  return minutes >= 0 ? minutes : null;
}

function isLateStart(actualStartAt: FirestoreDate | undefined, plannedStartOffsetMin: number): boolean {
  if (!actualStartAt) return false;
  const date = actualStartAt.toDate();
  const actualOffset = labelToOffsetMin(`${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`);
  return actualOffset > plannedStartOffsetMin + START_DELAY_THRESHOLD_MIN;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function formatMinutes(value: number | null): string {
  if (value === null) return "-";
  if (value < 60) return `${value}分`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
}

function completionRate(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

function isNumber(value: number | null): value is number {
  return value !== null;
}
