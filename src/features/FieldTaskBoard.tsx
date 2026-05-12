import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, Field, Modal, PrimaryButton, SecondaryButton, StatusBadge } from "../components/ui";
import { changeTaskStatus, subscribeDaily, subscribeMasters, subscribeWorkerTasks } from "../services/firestoreService";
import type { AppUser, Lane, LoadingItem, Route, RouteLink, Task, TaskStatus, Worker } from "../types";
import { formatTimestamp, isBeforePlannedStart } from "../utils/date";
import {
  buildBlockedReasons,
  buildTaskLaneSafetyBlockedReasons,
  formatLoadingItemLabel,
  loadingItemStatusLabels,
  sortAttentionLoadingItems,
  uniqueText,
} from "../utils/loadingItemGuards";
import { routeStatusLabels } from "../utils/status";

type TaskView = {
  task: Task;
  blocked: boolean;
  displayLabel: string;
  sortRank: number;
  subRoutes: Route[];
  loadingItems: LoadingItem[];
  incompleteLoadingItems: LoadingItem[];
  representativeLoadingItems: LoadingItem[];
  qualityInstructions: string[];
  safetyInstructions: string[];
  blockedReasons: string[];
};

export function FieldTaskBoard({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [links, setLinks] = useState<RouteLink[]>([]);
  const [loadingItems, setLoadingItems] = useState<LoadingItem[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [selected, setSelected] = useState<TaskView | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [error, setError] = useState("");
  const isAdminPreview = user.role === "admin";
  const activeWorkers = useMemo(() => workers.filter((worker) => worker.active), [workers]);
  const targetWorkerId = isAdminPreview ? selectedWorkerId : user.workerId;

  useEffect(() => {
    if (!targetWorkerId) {
      setTasks([]);
      return undefined;
    }
    return subscribeWorkerTasks(user.siteId, businessDate, targetWorkerId, setTasks, setError);
  }, [user.siteId, targetWorkerId, businessDate]);
  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routeLinks", user.siteId, businessDate, setLinks, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("loadingItems", user.siteId, businessDate, setLoadingItems, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeMasters("lanes", user.siteId, setLanes, setError), [user.siteId]);
  useEffect(() => {
    if (!isAdminPreview) return undefined;
    return subscribeMasters("workers", user.siteId, setWorkers, setError);
  }, [isAdminPreview, user.siteId]);
  useEffect(() => {
    if (!isAdminPreview) return;
    if (selectedWorkerId && activeWorkers.some((worker) => worker.id === selectedWorkerId)) return;
    setSelectedWorkerId(activeWorkers[0]?.id || "");
  }, [activeWorkers, isAdminPreview, selectedWorkerId]);

  const views = useMemo<TaskView[]>(() => {
    return tasks
      .map((task) => {
        const relatedLinks = links.filter((link) => link.mainRouteId === task.targetMainRouteId);
        const subRoutes = relatedLinks.map((link) => routes.find((route) => route.id === link.subRouteId)).filter((route): route is Route => Boolean(route));
        const routeBlocked = subRoutes.length > 0 && subRoutes.some((route) => route.status !== "completed");
        const relatedLoadingItems = loadingItems.filter((item) => item.mainRouteId === task.targetMainRouteId);
        const activeLoadingItems = relatedLoadingItems.filter((item) => item.status !== "cancelled");
        const shortageItems = activeLoadingItems.filter((item) => item.status === "shortage");
        const incompleteLoadingItems = activeLoadingItems.filter((item) => item.status !== "lane_in_completed");
        const representativeLoadingItems = sortAttentionLoadingItems(incompleteLoadingItems).slice(0, 2);
        const qualityInstructions = uniqueText(activeLoadingItems.map((item) => item.qualityInstruction));
        const safetyInstructions = uniqueText(activeLoadingItems.map((item) => item.safetyInstruction));
        const loadingBlocked = relatedLoadingItems.length === 0 || shortageItems.length > 0 || incompleteLoadingItems.length > 0;
        const laneSafetyReasons = buildTaskLaneSafetyBlockedReasons(task, loadingItems, lanes);
        const blockedReasons = [
          ...buildBlockedReasons(routeBlocked, relatedLoadingItems, shortageItems, incompleteLoadingItems),
          ...laneSafetyReasons,
        ];
        const blocked = routeBlocked || loadingBlocked || laneSafetyReasons.length > 0;
        const displayLabel = getDisplayLabel(task.status, blocked);
        return {
          task,
          blocked,
          displayLabel,
          subRoutes,
          loadingItems: relatedLoadingItems,
          incompleteLoadingItems,
          representativeLoadingItems,
          qualityInstructions,
          safetyInstructions,
          blockedReasons,
          sortRank: getSortRank(task, blocked),
        };
      })
      .sort((a, b) => a.sortRank - b.sortRank || a.task.plannedStartOffsetMin - b.task.plannedStartOffsetMin);
  }, [tasks, links, routes, loadingItems, lanes]);

  const groupedViews = useMemo(
    () =>
      [
        { key: "in_progress", title: "作業中", views: views.filter((view) => view.task.status === "in_progress") },
        { key: "ready", title: "開始可能", views: views.filter((view) => !view.blocked && view.task.status === "ready") },
        { key: "pending", title: "未開始", views: views.filter((view) => !view.blocked && view.task.status === "pending") },
        { key: "blocked", title: "開始不可", views: views.filter((view) => view.blocked && view.task.status !== "in_progress" && view.task.status !== "completed") },
        { key: "completed", title: "完了", views: views.filter((view) => view.task.status === "completed") },
      ].filter((group) => group.views.length > 0),
    [views],
  );

  async function updateStatus(view: TaskView, status: TaskStatus) {
    if (status === "in_progress") {
      if (view.blocked) return;
      if (isBeforePlannedStart(view.task.plannedStartOffsetMin) && !window.confirm("予定時刻前です。開始しますか？")) return;
    }
    await changeTaskStatus(view.task, status, user);
    setSelected(null);
  }

  if (!isAdminPreview && !user.workerId) {
    return (
      <Card className="field-board">
        <p className="alert">この一般ユーザーにはworkerIdが設定されていません。usersドキュメントに作業員IDを設定してください。</p>
      </Card>
    );
  }

  return (
    <div className="field-board">
      {error ? <p className="alert">{error}</p> : null}
      {isAdminPreview ? (
        <section className="field-worker-selector">
          <Field label="確認する作業員">
            <select value={selectedWorkerId} onChange={(event) => setSelectedWorkerId(event.target.value)}>
              {activeWorkers.length === 0 ? <option value="">有効な作業員がありません</option> : null}
              {activeWorkers.map((worker) => (
                <option value={worker.id} key={worker.id}>
                  {worker.displayName || worker.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="helper-text">管理者用のスマホ表示確認です。実際の一般ユーザー画面と同じ作業カードを表示します。</p>
        </section>
      ) : null}
      {views.length === 0 ? <EmptyState message="自分に割り当てられた作業はありません。" /> : null}
      <div className="task-card-list">
        {groupedViews.map((group) => (
          <section className="task-section" key={group.key}>
            <div className="task-section-header">
              <h2>{group.title}</h2>
              <span>{group.views.length}件</span>
            </div>
            <div className="task-section-list">
              {group.views.map((view) => (
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
                    <span>開始条件</span><strong>{view.blocked ? view.blockedReasons[0] || "開始不可" : "開始条件OK"}</strong>
                  </div>
                  <div className={`task-readiness ${view.blocked ? "blocked" : "ready"}`}>
                    <span>開始可否</span>
                    <strong>{view.blocked ? "開始不可" : "開始可能"}</strong>
                    <p>{view.blocked ? view.blockedReasons[0] || "開始できません" : "搬入・安全条件を満たしています"}</p>
                  </div>
                  {view.blockedReasons.length > 1 ? (
                    <div className="task-block-reasons">
                      {view.blockedReasons.slice(1).map((reason) => <span key={reason}>{reason}</span>)}
                    </div>
                  ) : null}
                  {view.representativeLoadingItems.length > 0 ? (
                    <div className="task-loading-summary">
                      <strong>確認が必要な搬入</strong>
                      {view.representativeLoadingItems.map((item) => (
                        <span key={item.id}>{formatLoadingItemLabel(item)}</span>
                      ))}
                    </div>
                  ) : null}
                  {view.qualityInstructions.length > 0 || view.safetyInstructions.length > 0 ? (
                    <div className="task-instruction-grid">
                      {view.qualityInstructions.length > 0 ? (
                        <div className="task-instruction-note quality">
                          <span>品質指示</span>
                          <strong>{view.qualityInstructions.join(" / ")}</strong>
                        </div>
                      ) : null}
                      {view.safetyInstructions.length > 0 ? (
                        <div className="task-instruction-note safety">
                          <span>安全指示</span>
                          <strong>{view.safetyInstructions.join(" / ")}</strong>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {view.task.actualStartAt || view.task.actualEndAt ? (
                    <p className="task-actual-line">
                      開始 {formatTimeOnly(view.task.actualStartAt)} / 完了 {formatTimeOnly(view.task.actualEndAt)}
                    </p>
                  ) : null}
                  {view.task.instruction ? <p className="instruction">{view.task.instruction}</p> : null}
                </button>
              ))}
            </div>
          </section>
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
            <div><span>開始条件</span><strong>{selected.blocked ? selected.blockedReasons[0] || "開始不可" : "開始可能"}</strong></div>
            {selected.blockedReasons.length > 0 ? (
              <div><span>開始不可理由</span><strong>{selected.blockedReasons.join(" / ")}</strong></div>
            ) : null}
            <div><span>ステータス</span><StatusBadge type="task" status={selected.task.status} blocked={selected.blocked} label={selected.displayLabel} /></div>
            <div><span>開始実績</span><strong>{formatTimestamp(selected.task.actualStartAt)}</strong></div>
            <div><span>完了実績</span><strong>{formatTimestamp(selected.task.actualEndAt)}</strong></div>
            {selected.subRoutes.length > 0 ? (
              <div>
                <span>関連サブ便</span>
                <strong>{selected.subRoutes.map((route) => `${route.routeName}:${routeStatusLabels[route.status]}`).join(" / ")}</strong>
              </div>
            ) : null}
            {selected.loadingItems.length > 0 ? (
              <div className="detail-wide">
                <span>積み付け情報</span>
                <div className="field-loading-list">
                  {selected.loadingItems.map((item) => (
                    <article className={`field-loading-item status-${item.status}`} key={item.id}>
                      <div className="field-loading-item-header">
                        <strong>{formatLoadingItemLabel(item)}</strong>
                        <span>{loadingItemStatusLabels[item.status]}</span>
                      </div>
                      <div className="field-loading-item-notes">
                        {item.qualityInstruction ? <p><span>品質</span>{item.qualityInstruction}</p> : null}
                        {item.safetyInstruction ? <p><span>安全</span>{item.safetyInstruction}</p> : null}
                        {item.issueMemo ? <p><span>異常</span>{item.issueMemo}</p> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div><span>積み付け情報</span><strong>未登録です。管理者に確認してください。</strong></div>
            )}
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
  if (blocked) return "開始不可";
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

function formatTimeOnly(value: Task["actualStartAt"]): string {
  const timestamp = formatTimestamp(value);
  if (timestamp === "-") return "-";
  return timestamp.split(" ")[1] || timestamp;
}
