import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, Modal, PrimaryButton, SecondaryButton, StatusBadge } from "../components/ui";
import { changeTaskStatus, subscribeDaily, subscribeWorkerTasks } from "../services/firestoreService";
import type { AppUser, Route, RouteLink, Task, TaskStatus } from "../types";
import { formatTimestamp, isBeforePlannedStart } from "../utils/date";

type TaskView = {
  task: Task;
  blocked: boolean;
  displayLabel: string;
  sortRank: number;
  subRoutes: Route[];
};

export function FieldTaskBoard({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [links, setLinks] = useState<RouteLink[]>([]);
  const [selected, setSelected] = useState<TaskView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user.workerId) return undefined;
    return subscribeWorkerTasks(user.siteId, businessDate, user.workerId, setTasks, setError);
  }, [user.siteId, user.workerId, businessDate]);
  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routeLinks", user.siteId, businessDate, setLinks, setError), [user.siteId, businessDate]);

  const views = useMemo<TaskView[]>(() => {
    return tasks
      .map((task) => {
        const relatedLinks = links.filter((link) => link.mainRouteId === task.targetMainRouteId);
        const subRoutes = relatedLinks.map((link) => routes.find((route) => route.id === link.subRouteId)).filter((route): route is Route => Boolean(route));
        const blocked = subRoutes.length > 0 && subRoutes.some((route) => route.status !== "completed");
        const displayLabel = getDisplayLabel(task.status, blocked);
        return {
          task,
          blocked,
          displayLabel,
          subRoutes,
          sortRank: getSortRank(task, blocked),
        };
      })
      .sort((a, b) => a.sortRank - b.sortRank || a.task.plannedStartOffsetMin - b.task.plannedStartOffsetMin);
  }, [tasks, links, routes]);

  async function updateStatus(view: TaskView, status: TaskStatus) {
    if (status === "in_progress") {
      if (view.blocked) return;
      if (isBeforePlannedStart(view.task.plannedStartOffsetMin) && !window.confirm("予定時刻前です。開始しますか？")) return;
    }
    await changeTaskStatus(view.task, status, user);
    setSelected(null);
  }

  if (!user.workerId) {
    return (
      <Card className="field-board">
        <p className="alert">この一般ユーザーにはworkerIdが設定されていません。usersドキュメントに作業員IDを設定してください。</p>
      </Card>
    );
  }

  return (
    <div className="field-board">
      {error ? <p className="alert">{error}</p> : null}
      {views.length === 0 ? <EmptyState message="自分に割り当てられた作業はありません。" /> : null}
      <div className="task-card-list">
        {views.map((view) => (
          <button key={view.task.id} type="button" className="task-card" onClick={() => setSelected(view)}>
            <div className="task-card-top">
              <div>
                <p className="task-time">{view.task.plannedStartLabel} - {view.task.plannedEndLabel}</p>
                <h2>{view.task.taskName}</h2>
              </div>
              <StatusBadge type="task" status={view.task.status} blocked={view.blocked} label={view.displayLabel} />
            </div>
            <div className="task-info-grid">
              <span>レーン</span><strong>{view.task.laneName || "-"}</strong>
              <span>対象便</span><strong>{view.task.targetMainRouteName} {view.task.targetMainFlightNumber}</strong>
              <span>前工程</span><strong>{view.blocked ? "未完了のサブ便あり" : "開始条件OK"}</strong>
            </div>
            {view.task.instruction ? <p className="instruction">{view.task.instruction}</p> : null}
          </button>
        ))}
      </div>
      {selected ? (
        <Modal
          title="作業詳細"
          onClose={() => setSelected(null)}
          footer={
            <>
              {selected.task.status !== "in_progress" && selected.task.status !== "completed" ? (
                <PrimaryButton type="button" disabled={selected.blocked} onClick={() => updateStatus(selected, "in_progress")}>作業開始</PrimaryButton>
              ) : null}
              {selected.task.status === "in_progress" ? <PrimaryButton type="button" onClick={() => updateStatus(selected, "completed")}>作業完了</PrimaryButton> : null}
              {selected.task.status === "completed" ? <SecondaryButton type="button" onClick={() => updateStatus(selected, selected.blocked ? "pending" : "ready")}>未完了に戻す</SecondaryButton> : null}
            </>
          }
        >
          <div className="detail-list">
            <div><span>タスク</span><strong>{selected.task.taskName}</strong></div>
            <div><span>予定</span><strong>{selected.task.plannedStartLabel} - {selected.task.plannedEndLabel}</strong></div>
            <div><span>レーン</span><strong>{selected.task.laneName}</strong></div>
            <div><span>対象便</span><strong>{selected.task.targetMainRouteName} {selected.task.targetMainFlightNumber}</strong></div>
            <div><span>前工程状態</span><strong>{selected.blocked ? "前工程待ち" : "開始可能"}</strong></div>
            <div><span>ステータス</span><StatusBadge type="task" status={selected.task.status} blocked={selected.blocked} label={selected.displayLabel} /></div>
            <div><span>開始実績</span><strong>{formatTimestamp(selected.task.actualStartAt)}</strong></div>
            <div><span>完了実績</span><strong>{formatTimestamp(selected.task.actualEndAt)}</strong></div>
            {selected.subRoutes.length > 0 ? <div><span>関連サブ便</span><strong>{selected.subRoutes.map((route) => `${route.routeName}:${route.status}`).join(" / ")}</strong></div> : null}
            {selected.task.instruction ? <p className="instruction detail-instruction">{selected.task.instruction}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function getDisplayLabel(status: TaskStatus, blocked: boolean): string {
  if (status === "completed") return "完了";
  if (status === "in_progress") return "作業中";
  if (blocked) return "前工程待ち";
  if (status === "ready") return "開始可能";
  return "未開始";
}

function getSortRank(task: Task, blocked: boolean): number {
  if (task.status === "in_progress") return 1;
  if (!blocked && task.status === "ready") return 2;
  if (!blocked && task.status === "pending") return 3;
  if (blocked) return 4;
  return 5;
}
