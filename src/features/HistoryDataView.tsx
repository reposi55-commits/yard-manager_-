import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { where } from "firebase/firestore";
import { Card, EmptyState, Field } from "../components/ui";
import { subscribeCollection } from "../services/firestoreService";
import type { AppUser, OperationLog, Route, RouteLink, Task } from "../types";
import { getDefaultBusinessDate, toDateInputValue } from "../utils/date";

type HistoryRow = {
  businessDate: string;
  routeTotal: number;
  routeCompleted: number;
  taskTotal: number;
  taskCompleted: number;
  taskStarted: number;
  deletedRecords: number;
  logTotal: number;
};

export function HistoryDataView({ user }: { user: AppUser }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [links, setLinks] = useState<RouteLink[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [endDate, setEndDate] = useState(getDefaultBusinessDate());
  const [startDate, setStartDate] = useState(() => shiftDate(getDefaultBusinessDate(), -13));

  useEffect(
    () =>
      subscribeCollection<Route>(
        "routes",
        rangeConstraints(user.siteId, startDate, endDate),
        (items) => {
          setRoutes(items);
          clearError(setErrors, "routes");
        },
        (message) => setCollectionError(setErrors, "routes", message),
        { includeDeleted: true },
      ),
    [user.siteId, startDate, endDate],
  );
  useEffect(
    () =>
      subscribeCollection<Task>(
        "tasks",
        rangeConstraints(user.siteId, startDate, endDate),
        (items) => {
          setTasks(items);
          clearError(setErrors, "tasks");
        },
        (message) => setCollectionError(setErrors, "tasks", message),
        { includeDeleted: true },
      ),
    [user.siteId, startDate, endDate],
  );
  useEffect(
    () =>
      subscribeCollection<RouteLink>(
        "routeLinks",
        rangeConstraints(user.siteId, startDate, endDate),
        (items) => {
          setLinks(items);
          clearError(setErrors, "routeLinks");
        },
        (message) => setCollectionError(setErrors, "routeLinks", message),
        { includeDeleted: true },
      ),
    [user.siteId, startDate, endDate],
  );
  useEffect(
    () =>
      subscribeCollection<OperationLog>(
        "operationLogs",
        rangeConstraints(user.siteId, startDate, endDate),
        (items) => {
          setLogs(items);
          clearError(setErrors, "operationLogs");
        },
        (message) => setCollectionError(setErrors, "operationLogs", message),
      ),
    [user.siteId, startDate, endDate],
  );

  const rows = useMemo(() => buildRows(routes, tasks, links, logs, startDate, endDate), [routes, tasks, links, logs, startDate, endDate]);
  const summary = useMemo(
    () => ({
      days: rows.length,
      routeTotal: rows.reduce((sum, row) => sum + row.routeTotal, 0),
      taskTotal: rows.reduce((sum, row) => sum + row.taskTotal, 0),
      completedTasks: rows.reduce((sum, row) => sum + row.taskCompleted, 0),
      logTotal: rows.reduce((sum, row) => sum + row.logTotal, 0),
      deletedRecords: rows.reduce((sum, row) => sum + row.deletedRecords, 0),
      retainedDocuments: routes.length + tasks.length + links.length + logs.length,
    }),
    [links.length, logs.length, routes.length, rows, tasks.length],
  );
  const hasDateError = startDate > endDate;
  const filteredRows = hasDateError ? [] : rows;
  const errorMessage = Object.values(errors)[0] || "";

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>過去データ確認</h2>
        </div>
      </div>
      <p className="helper-text">
        無料枠内で運用しやすいように、期間を絞って保管量の目安を確認します。詳細参照よりも、残しすぎの早期発見を目的にしています。
      </p>
      {errorMessage ? <p className="alert">{errorMessage}</p> : null}
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
        <Metric label="主要ドキュメント" value={`${summary.retainedDocuments}件`} note="便・タスク・紐付け・履歴" />
        <Metric label="運用データ" value={`${summary.routeTotal + summary.taskTotal}件`} note={`便 ${summary.routeTotal} / タスク ${summary.taskTotal}`} />
        <Metric label="削除済みを含む" value={`${summary.deletedRecords}件`} note="論理削除済みの便・タスク・紐付け" />
      </div>

      <section className="form-check-panel warning">
        <strong>無料枠運用メモ</strong>
        <p>
          Cloud Firestoreの無料枠は、保存容量・読み取り・書き込み・削除・転送量で決まります。
          この画面は選択期間だけを読み込むため、確認したい期間を広げすぎない運用がおすすめです。
        </p>
        <ul>
          <li>当面は直近1〜2週間を確認し、月末にCSV出力で控えを取る。</li>
          <li>細かい過去参照が不要なデータは、一定期間後に削除・アーカイブ方針を決める。</li>
          <li>論理削除済みデータもFirestore上には残るため、無料枠が近づいたら物理削除手順を別途決める。</li>
        </ul>
      </section>

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
                <th>削除済み</th>
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
                  <td>{row.deletedRecords}</td>
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

function buildRows(routes: Route[], tasks: Task[], links: RouteLink[], logs: OperationLog[], startDate: string, endDate: string): HistoryRow[] {
  if (startDate > endDate) return [];
  const dates = new Set<string>();
  routes.forEach((route) => addDateIfInRange(dates, route.businessDate, startDate, endDate));
  tasks.forEach((task) => addDateIfInRange(dates, task.businessDate, startDate, endDate));
  links.forEach((link) => addDateIfInRange(dates, link.businessDate, startDate, endDate));
  logs.forEach((log) => addDateIfInRange(dates, log.businessDate, startDate, endDate));

  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((businessDate) => {
      const dailyRoutes = routes.filter((route) => route.businessDate === businessDate);
      const dailyTasks = tasks.filter((task) => task.businessDate === businessDate);
      const dailyLinks = links.filter((link) => link.businessDate === businessDate);
      const dailyLogs = logs.filter((log) => log.businessDate === businessDate);
      const activeRoutes = dailyRoutes.filter((route) => !route.deleted);
      const activeTasks = dailyTasks.filter((task) => !task.deleted);
      return {
        businessDate,
        routeTotal: activeRoutes.length,
        routeCompleted: activeRoutes.filter((route) => route.status === "completed").length,
        taskTotal: activeTasks.length,
        taskCompleted: activeTasks.filter((task) => task.status === "completed").length,
        taskStarted: activeTasks.filter((task) => task.actualStartAt).length,
        deletedRecords:
          dailyRoutes.filter((route) => route.deleted).length +
          dailyTasks.filter((task) => task.deleted).length +
          dailyLinks.filter((link) => link.deleted).length,
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

function rangeConstraints(siteId: string, startDate: string, endDate: string) {
  return [
    where("siteId", "==", siteId),
    where("businessDate", ">=", startDate),
    where("businessDate", "<=", endDate),
  ];
}

function setCollectionError(setErrors: Dispatch<SetStateAction<Record<string, string>>>, key: string, message: string) {
  setErrors((current) => ({ ...current, [key]: formatHistoryError(message) }));
}

function clearError(setErrors: Dispatch<SetStateAction<Record<string, string>>>, key: string) {
  setErrors((current) => {
    if (!current[key]) return current;
    const next = { ...current };
    delete next[key];
    return next;
  });
}

function formatHistoryError(message: string): string {
  if (message.includes("requires an index") && message.includes("currently building")) {
    return "Firestoreの検索用indexを作成中です。完了まで、この画面の件数が一部未取得になる場合があります。少し時間を置いて再読み込みしてください。";
  }
  if (message.includes("requires an index")) {
    return "Firestoreの検索用indexが不足しています。管理者がindexを反映すると、この期間集計を確認できます。";
  }
  return message;
}
