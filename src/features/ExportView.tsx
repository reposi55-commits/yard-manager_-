import { useEffect, useMemo, useState } from "react";
import { where } from "firebase/firestore";
import { Card, EmptyState, Field, PrimaryButton, SecondaryButton } from "../components/ui";
import { fetchCollectionOnce, subscribeCollection, subscribeDaily } from "../services/firestoreService";
import type { AppUser, LogAction, LogTargetType, OperationLog, Route, RouteLink, Task } from "../types";
import { downloadCsv } from "../utils/csv";
import { formatTimestamp } from "../utils/date";
import { routeStatusLabels, taskStatusLabels } from "../utils/status";

const targetLabels: Record<LogTargetType, string> = {
  station: "ステーション",
  lane: "レーン",
  worker: "作業員",
  user: "ユーザー",
  route: "便",
  task: "タスク",
  routeLink: "便紐付け",
  loadingItem: "積み付け情報",
  dialTemplate: "テンプレート",
  templateRun: "テンプレート実行",
};

const actionLabels: Record<LogAction, string> = {
  create: "作成",
  update: "更新",
  delete: "論理削除",
  status_change: "ステータス変更",
  import: "CSV取込",
};

export function ExportView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [error, setError] = useState("");
  const [archiveStartDate, setArchiveStartDate] = useState(() => getMonthStart(businessDate));
  const [archiveEndDate, setArchiveEndDate] = useState(businessDate);
  const [archiveRoutes, setArchiveRoutes] = useState<Route[]>([]);
  const [archiveTasks, setArchiveTasks] = useState<Task[]>([]);
  const [archiveLinks, setArchiveLinks] = useState<RouteLink[]>([]);
  const [archiveLogs, setArchiveLogs] = useState<OperationLog[]>([]);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("tasks", user.siteId, businessDate, setTasks, setError), [user.siteId, businessDate]);
  useEffect(
    () =>
      subscribeCollection<OperationLog>(
        "operationLogs",
        [where("siteId", "==", user.siteId), where("businessDate", "==", businessDate)],
        setLogs,
        setError,
      ),
    [user.siteId, businessDate],
  );

  useEffect(() => {
    setArchiveStartDate(getMonthStart(businessDate));
    setArchiveEndDate(businessDate);
    clearArchiveData();
  }, [businessDate]);

  function clearArchiveData() {
    setArchiveRoutes([]);
    setArchiveTasks([]);
    setArchiveLinks([]);
    setArchiveLogs([]);
    setArchiveLoaded(false);
    setArchiveError("");
  }

  async function loadArchiveData() {
    if (archiveStartDate > archiveEndDate) {
      setArchiveError("開始日は終了日以前にしてください。");
      return;
    }
    setArchiveLoading(true);
    setArchiveError("");
    try {
      const constraints = rangeConstraints(user.siteId, archiveStartDate, archiveEndDate);
      const [nextRoutes, nextTasks, nextLinks, nextLogs] = await Promise.all([
        fetchCollectionOnce<Route>("routes", constraints, { includeDeleted: true }),
        fetchCollectionOnce<Task>("tasks", constraints, { includeDeleted: true }),
        fetchCollectionOnce<RouteLink>("routeLinks", constraints, { includeDeleted: true }),
        fetchCollectionOnce<OperationLog>("operationLogs", constraints),
      ]);
      setArchiveRoutes(nextRoutes);
      setArchiveTasks(nextTasks);
      setArchiveLinks(nextLinks);
      setArchiveLogs(nextLogs);
      setArchiveLoaded(true);
    } catch (caught) {
      setArchiveError(formatArchiveError(caught instanceof Error ? caught.message : String(caught)));
    } finally {
      setArchiveLoading(false);
    }
  }

  const routeRows = useMemo(() => buildRouteRows(routes, false), [routes]);
  const taskRows = useMemo(() => buildTaskRows(tasks, false), [tasks]);
  const logRows = useMemo(() => buildLogRows(logs), [logs]);
  const archiveRouteRows = useMemo(() => buildRouteRows(archiveRoutes, true), [archiveRoutes]);
  const archiveTaskRows = useMemo(() => buildTaskRows(archiveTasks, true), [archiveTasks]);
  const archiveLinkRows = useMemo(() => buildRouteLinkRows(archiveLinks), [archiveLinks]);
  const archiveLogRows = useMemo(() => buildLogRows(archiveLogs), [archiveLogs]);
  const archiveTotal = archiveRouteRows.length + archiveTaskRows.length + archiveLinkRows.length + archiveLogRows.length;

  const exportItems = [
    {
      title: "便一覧CSV",
      description: "対象日の便、予定、状態、実績時刻を出力します。",
      count: routeRows.length,
      action: () => downloadCsv(`yardmanager-routes-${businessDate}.csv`, routeRows),
    },
    {
      title: "タスク一覧CSV",
      description: "対象日のタスク、担当作業員、対象便、予定、実績時刻を出力します。",
      count: taskRows.length,
      action: () => downloadCsv(`yardmanager-tasks-${businessDate}.csv`, taskRows),
    },
    {
      title: "操作履歴CSV",
      description: "対象日の操作履歴と変更概要を出力します。",
      count: logRows.length,
      action: () => downloadCsv(`yardmanager-operation-logs-${businessDate}.csv`, logRows),
    },
  ];

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Export</p>
          <h2>CSV出力</h2>
        </div>
      </div>
      <p className="helper-text">対象日の計画・実績・操作履歴をCSVで出力します。Excelで開ける文字コードで保存されます。</p>
      {error ? <p className="alert">{error}</p> : null}
      <div className="export-grid">
        {exportItems.map((item) => (
          <section className="export-panel" key={item.title}>
            <div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <strong>{item.count}件</strong>
            </div>
            <PrimaryButton type="button" disabled={item.count === 0} onClick={item.action}>CSV出力</PrimaryButton>
          </section>
        ))}
      </div>
      {routes.length === 0 && tasks.length === 0 && logs.length === 0 ? (
        <EmptyState message="この対象日に出力できるデータはまだありません。" />
      ) : null}

      <section className="archive-export-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Archive backup</p>
            <h3>期間指定の控えCSV</h3>
          </div>
        </div>
        <p className="helper-text">
          Firebaseの無料枠で運用しやすいように、長期保管したい期間だけ手動で読み込み、CSVの控えを作成します。
          削除済みデータも含めて出力するため、後からFirestore側を整理する判断材料にできます。
        </p>
        <div className="filter-bar archive-filter">
          <Field label="開始日">
            <input
              type="date"
              value={archiveStartDate}
              onChange={(event) => {
                setArchiveStartDate(event.target.value);
                clearArchiveData();
              }}
            />
          </Field>
          <Field label="終了日">
            <input
              type="date"
              value={archiveEndDate}
              onChange={(event) => {
                setArchiveEndDate(event.target.value);
                clearArchiveData();
              }}
            />
          </Field>
          <SecondaryButton type="button" disabled={archiveLoading} onClick={loadArchiveData}>
            {archiveLoading ? "読込中..." : "期間データを読み込む"}
          </SecondaryButton>
        </div>
        {archiveError ? <p className="alert">{archiveError}</p> : null}
        {archiveLoaded ? (
          <>
            <div className="archive-summary">
              <span>便 {archiveRouteRows.length}件</span>
              <span>タスク {archiveTaskRows.length}件</span>
              <span>便紐付け {archiveLinkRows.length}件</span>
              <span>履歴 {archiveLogRows.length}件</span>
              <strong>合計 {archiveTotal}件</strong>
            </div>
            <div className="export-grid">
              <section className="export-panel">
                <div>
                  <h3>期間内の便CSV</h3>
                  <p>便の予定、状態、実績時刻、削除済み区分を出力します。</p>
                  <strong>{archiveRouteRows.length}件</strong>
                </div>
                <PrimaryButton
                  type="button"
                  disabled={archiveRouteRows.length === 0}
                  onClick={() => downloadCsv(`yardmanager-archive-routes-${archiveStartDate}_${archiveEndDate}.csv`, archiveRouteRows)}
                >
                  CSV出力
                </PrimaryButton>
              </section>
              <section className="export-panel">
                <div>
                  <h3>期間内のタスクCSV</h3>
                  <p>タスクの担当、対象便、予定、実績時刻、削除済み区分を出力します。</p>
                  <strong>{archiveTaskRows.length}件</strong>
                </div>
                <PrimaryButton
                  type="button"
                  disabled={archiveTaskRows.length === 0}
                  onClick={() => downloadCsv(`yardmanager-archive-tasks-${archiveStartDate}_${archiveEndDate}.csv`, archiveTaskRows)}
                >
                  CSV出力
                </PrimaryButton>
              </section>
              <section className="export-panel">
                <div>
                  <h3>期間内の紐付けCSV</h3>
                  <p>サブ便とメイン便の紐付けを、削除済み区分込みで出力します。</p>
                  <strong>{archiveLinkRows.length}件</strong>
                </div>
                <PrimaryButton
                  type="button"
                  disabled={archiveLinkRows.length === 0}
                  onClick={() => downloadCsv(`yardmanager-archive-route-links-${archiveStartDate}_${archiveEndDate}.csv`, archiveLinkRows)}
                >
                  CSV出力
                </PrimaryButton>
              </section>
              <section className="export-panel">
                <div>
                  <h3>期間内の履歴CSV</h3>
                  <p>操作履歴と変更概要を出力します。監査用の控えとして使えます。</p>
                  <strong>{archiveLogRows.length}件</strong>
                </div>
                <PrimaryButton
                  type="button"
                  disabled={archiveLogRows.length === 0}
                  onClick={() => downloadCsv(`yardmanager-archive-operation-logs-${archiveStartDate}_${archiveEndDate}.csv`, archiveLogRows)}
                >
                  CSV出力
                </PrimaryButton>
              </section>
            </div>
            {archiveTotal === 0 ? <EmptyState message="この期間に控えCSVへ出力できるデータはありません。" /> : null}
          </>
        ) : (
          <p className="helper-text">期間を選んで読み込むまで、広い範囲のデータは取得しません。</p>
        )}
      </section>
    </Card>
  );
}

function buildRouteRows(routes: Route[], includeDeleted: boolean) {
  return routes
    .slice()
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.plannedStartOffsetMin - b.plannedStartOffsetMin)
    .map((route) => ({
      対象日: route.businessDate,
      種別: route.type === "main" ? "メイン" : "サブ",
      便名: route.routeName,
      便番号: route.flightNumber,
      ステーション: route.stationName,
      予定開始: route.plannedStartLabel,
      予定終了: route.plannedEndLabel,
      状態: routeStatusLabels[route.status],
      開始実績: formatTimestamp(route.actualStartAt),
      完了実績: formatTimestamp(route.actualEndAt),
      ...(includeDeleted ? { 削除済み: formatDeleted(route.deleted), 削除日時: formatTimestamp(route.deletedAt) } : {}),
    }));
}

function buildTaskRows(tasks: Task[], includeDeleted: boolean) {
  return tasks
    .slice()
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.plannedStartOffsetMin - b.plannedStartOffsetMin)
    .map((task) => ({
      対象日: task.businessDate,
      タスク: task.taskName,
      作業員: task.workerName,
      レーン: task.laneName,
      対象便: `${task.targetMainRouteName} ${task.targetMainFlightNumber}`.trim(),
      予定開始: task.plannedStartLabel,
      予定終了: task.plannedEndLabel,
      状態: taskStatusLabels[task.status],
      開始実績: formatTimestamp(task.actualStartAt),
      完了実績: formatTimestamp(task.actualEndAt),
      補足指示: task.instruction,
      ...(includeDeleted ? { 削除済み: formatDeleted(task.deleted), 削除日時: formatTimestamp(task.deletedAt) } : {}),
    }));
}

function buildRouteLinkRows(links: RouteLink[]) {
  return links
    .slice()
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.subFlightNumber.localeCompare(b.subFlightNumber))
    .map((link) => ({
      対象日: link.businessDate,
      サブ便: link.subRouteName,
      サブ便番号: link.subFlightNumber,
      メイン便: link.mainRouteName,
      メイン便番号: link.mainFlightNumber,
      削除済み: formatDeleted(link.deleted),
      削除日時: formatTimestamp(link.deletedAt),
    }));
}

function buildLogRows(logs: OperationLog[]) {
  return logs
    .slice()
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || (a.operatedAt?.toMillis?.() || 0) - (b.operatedAt?.toMillis?.() || 0))
    .map((log) => ({
      対象日: log.businessDate,
      日時: formatTimestamp(log.operatedAt),
      対象種別: targetLabels[log.targetType],
      対象名: log.targetLabel || log.targetId,
      操作: actionLabels[log.action],
      操作者: log.operatedBy,
      変更概要: summarizeLog(log),
    }));
}

function summarizeLog(log: OperationLog): string {
  if (log.action === "create") return "新規作成";
  if (log.action === "delete") return "論理削除";
  if (log.action === "status_change") {
    const beforeStatus = getStatusLabel(log.targetType, log.before?.status);
    const afterStatus = getStatusLabel(log.targetType, log.after?.status);
    return `${beforeStatus} → ${afterStatus}`;
  }
  return "内容更新";
}

function getStatusLabel(targetType: LogTargetType, value: unknown): string {
  if (typeof value !== "string") return "-";
  if (targetType === "route" && value in routeStatusLabels) return routeStatusLabels[value as keyof typeof routeStatusLabels];
  if (targetType === "task" && value in taskStatusLabels) return taskStatusLabels[value as keyof typeof taskStatusLabels];
  return value;
}

function formatDeleted(value: boolean | undefined): string {
  return value ? "はい" : "いいえ";
}

function getMonthStart(value: string): string {
  return `${value.slice(0, 8)}01`;
}

function rangeConstraints(siteId: string, startDate: string, endDate: string) {
  return [
    where("siteId", "==", siteId),
    where("businessDate", ">=", startDate),
    where("businessDate", "<=", endDate),
  ];
}

function formatArchiveError(message: string): string {
  if (message.includes("requires an index") && message.includes("currently building")) {
    return "Firestoreの検索用indexを作成中です。完了まで、この期間CSVの件数が取得できない場合があります。少し時間を置いて再読込してください。";
  }
  if (message.includes("requires an index")) {
    return "Firestoreの検索用indexが不足しています。管理者がindexを反映すると、この期間CSVを出力できます。";
  }
  return message;
}
