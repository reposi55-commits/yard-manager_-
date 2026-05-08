import { useEffect, useMemo, useState } from "react";
import { where } from "firebase/firestore";
import { Card, EmptyState } from "../components/ui";
import { subscribeCollection } from "../services/firestoreService";
import type { AppUser, LogAction, LogTargetType, OperationLog } from "../types";
import { formatTimestamp } from "../utils/date";

const targetLabels: Record<LogTargetType, string> = {
  station: "ステーション",
  lane: "レーン",
  worker: "作業員",
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

export function OperationLogView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [error, setError] = useState("");

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
            {sortedLogs.map((log) => (
              <tr key={log.id}>
                <td>{formatTimestamp(log.operatedAt)}</td>
                <td>{targetLabels[log.targetType] || log.targetType}</td>
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

function summarizeChange(log: OperationLog): string {
  if (log.action === "status_change") {
    const beforeStatus = log.before?.status ? String(log.before.status) : "-";
    const afterStatus = log.after?.status ? String(log.after.status) : "-";
    return `${beforeStatus} → ${afterStatus}`;
  }
  if (log.action === "create") return "新規作成";
  if (log.action === "delete") return "論理削除";
  return "内容更新";
}
