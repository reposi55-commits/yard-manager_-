import { useEffect, useMemo, useState } from "react";
import { where } from "firebase/firestore";
import { Card, EmptyState, Field } from "../components/ui";
import { subscribeCollection } from "../services/firestoreService";
import type { AppUser, LogAction, LogTargetType, OperationLog, RouteStatus, TaskStatus } from "../types";
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

export function OperationLogView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [targetFilter, setTargetFilter] = useState<"all" | LogTargetType>("all");
  const [actionFilter, setActionFilter] = useState<"all" | LogAction>("all");

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

  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => (b.operatedAt?.toMillis?.() || 0) - (a.operatedAt?.toMillis?.() || 0)),
    [logs],
  );

  const filteredLogs = useMemo(
    () =>
      sortedLogs.filter((log) => {
        const keyword = searchText.trim().toLowerCase();
        const targetLabel = getLogTargetLabel(log);
        const matchesTarget = targetFilter === "all" || log.targetType === targetFilter;
        const matchesAction = actionFilter === "all" || log.action === actionFilter;
        const matchesKeyword =
          !keyword ||
          [
            targetLabel,
            log.targetId,
            log.operatedBy,
            targetLabels[log.targetType],
            actionLabels[log.action],
            summarizeChange(log),
          ].some((value) => value.toLowerCase().includes(keyword));
        return matchesTarget && matchesAction && matchesKeyword;
      }),
    [sortedLogs, searchText, targetFilter, actionFilter],
  );

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Logs</p>
          <h2>操作履歴</h2>
        </div>
      </div>
      {error ? <p className="alert">{error}</p> : null}
      {sortedLogs.length === 0 ? <EmptyState message="この対象日の操作履歴はまだありません。" /> : null}
      {sortedLogs.length > 0 ? (
        <div className="filter-bar">
          <Field label="検索">
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="対象名・対象ID・操作者・変更内容" />
          </Field>
          <Field label="対象">
            <select value={targetFilter} onChange={(event) => setTargetFilter(event.target.value as "all" | LogTargetType)}>
              <option value="all">すべて</option>
              {Object.entries(targetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="操作">
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as "all" | LogAction)}>
              <option value="all">すべて</option>
              {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
      ) : null}
      {sortedLogs.length > 0 && filteredLogs.length === 0 ? <EmptyState message="条件に一致する操作履歴はありません。" /> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>日時</th>
              <th>対象</th>
              <th>操作</th>
              <th>操作者</th>
              <th>変更内容</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log) => (
              <tr key={log.id}>
                <td>{formatTimestamp(log.operatedAt)}</td>
                <td>
                  <span>{targetLabels[log.targetType] || log.targetType}</span>
                  <strong className="log-target-label">{getLogTargetLabel(log)}</strong>
                  <small className="muted-id">{log.targetId}</small>
                </td>
                <td>{actionLabels[log.action] || log.action}</td>
                <td><code>{log.operatedBy}</code></td>
                <td>{summarizeChange(log)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function getLogTargetLabel(log: OperationLog): string {
  return log.targetLabel || extractTargetLabel(log.after) || extractTargetLabel(log.before) || log.targetId;
}

function extractTargetLabel(value: Record<string, unknown> | null): string {
  if (!value) return "";
  if (typeof value.routeName === "string") return [value.routeName, value.flightNumber].filter(Boolean).join(" / ");
  if (typeof value.taskName === "string") return [value.taskName, value.workerName].filter(Boolean).join(" / ");
  if (typeof value.subRouteName === "string" || typeof value.mainRouteName === "string") {
    const sub = [value.subRouteName, value.subFlightNumber].filter(Boolean).join(" / ");
    const main = [value.mainRouteName, value.mainFlightNumber].filter(Boolean).join(" / ");
    return [sub, main].filter(Boolean).join(" → ");
  }
  if (typeof value.displayName === "string") return value.displayName;
  if (typeof value.name === "string") return value.name;
  return "";
}

function summarizeChange(log: OperationLog): string {
  if (log.action === "status_change") {
    const beforeStatus = getStatusLabel(log.targetType, log.before?.status);
    const afterStatus = getStatusLabel(log.targetType, log.after?.status);
    const actualTimeNote = summarizeActualTimeChange(log);
    return actualTimeNote ? `${beforeStatus} → ${afterStatus} / ${actualTimeNote}` : `${beforeStatus} → ${afterStatus}`;
  }
  if (log.action === "create") return "新規作成";
  if (log.action === "import") return "CSV取込";
  if (log.action === "delete") return "論理削除";
  return "内容更新";
}

function getStatusLabel(targetType: LogTargetType, value: unknown): string {
  if (typeof value !== "string") return "-";
  if (targetType === "route" && value in routeStatusLabels) {
    return routeStatusLabels[value as RouteStatus];
  }
  if (targetType === "task" && value in taskStatusLabels) {
    return taskStatusLabels[value as TaskStatus];
  }
  return value;
}

function summarizeActualTimeChange(log: OperationLog): string {
  const beforeStart = Boolean(log.before?.actualStartAt);
  const afterStart = Boolean(log.after?.actualStartAt);
  const beforeEnd = Boolean(log.before?.actualEndAt);
  const afterEnd = Boolean(log.after?.actualEndAt);

  if (!beforeStart && afterStart) return "開始実績を記録";
  if (!beforeEnd && afterEnd) return "完了実績を記録";
  return "";
}
