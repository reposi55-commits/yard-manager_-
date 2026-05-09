import { useEffect, useMemo, useState } from "react";
import { where } from "firebase/firestore";
import { Card, EmptyState, PrimaryButton } from "../components/ui";
import { subscribeCollection, subscribeDaily } from "../services/firestoreService";
import type { AppUser, LogAction, LogTargetType, OperationLog, Route, Task } from "../types";
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
};

const actionLabels: Record<LogAction, string> = {
  create: "作成",
  update: "更新",
  delete: "論理削除",
  status_change: "ステータス変更",
};

export function ExportView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [error, setError] = useState("");

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

  const routeRows = useMemo(
    () =>
      routes
        .slice()
        .sort((a, b) => a.plannedStartOffsetMin - b.plannedStartOffsetMin)
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
        })),
    [routes],
  );

  const taskRows = useMemo(
    () =>
      tasks
        .slice()
        .sort((a, b) => a.plannedStartOffsetMin - b.plannedStartOffsetMin)
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
        })),
    [tasks],
  );

  const logRows = useMemo(
    () =>
      logs
        .slice()
        .sort((a, b) => (a.operatedAt?.toMillis?.() || 0) - (b.operatedAt?.toMillis?.() || 0))
        .map((log) => ({
          対象日: log.businessDate,
          日時: formatTimestamp(log.operatedAt),
          対象種別: targetLabels[log.targetType],
          対象名: log.targetLabel || log.targetId,
          操作: actionLabels[log.action],
          操作者: log.operatedBy,
          変更概要: summarizeLog(log),
        })),
    [logs],
  );

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
    </Card>
  );
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
