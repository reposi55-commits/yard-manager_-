import { useEffect, useMemo, useState } from "react";
import { Card, DangerButton, EmptyState, Field, FormCheckPanel, Modal, PrimaryButton, SecondaryButton } from "../components/ui";
import { changeLoadingItemStatus, createLoadingItem, softDeleteEntity, subscribeDaily, updateEntity } from "../services/firestoreService";
import type { AppUser, Lane, LoadingItem, LoadingItemStatus, Route, Task } from "../types";
import { buildLaneWorkSafetyIssue } from "../utils/loadingItemGuards";
import { useMasterOptions } from "./MasterManagement";

const loadingItemStatusLabels: Record<LoadingItemStatus, string> = {
  planned: "登録済み",
  sub_arrived: "サブ便到着",
  lane_in_progress: "レーン投入中",
  lane_in_completed: "レーン投入完了",
  shortage: "欠品・不足",
  cancelled: "対象外",
};

const loadingItemDefaults = {
  subRouteId: "",
  mainRouteId: "",
  laneId: "",
  laneName: "",
  supplierName: "",
  receivingName: "",
  orderNo: "",
  status: "planned" as LoadingItemStatus,
  qualityInstruction: "",
  safetyInstruction: "",
  note: "",
  issueMemo: "",
};

export function LoadingItemManagement({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [items, setItems] = useState<LoadingItem[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState(loadingItemDefaults);
  const [editing, setEditing] = useState<LoadingItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LoadingItemStatus>("all");
  const { lanes } = useMasterOptions(user);

  useEffect(() => subscribeDaily("loadingItems", user.siteId, businessDate, setItems, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("tasks", user.siteId, businessDate, setTasks, setError), [user.siteId, businessDate]);

  const subRoutes = useMemo(() => routes.filter((route) => route.type === "sub"), [routes]);
  const mainRoutes = useMemo(() => routes.filter((route) => route.type === "main"), [routes]);
  const selectableLanes = useMemo(() => lanes.filter((lane) => lane.active || lane.id === draft.laneId), [draft.laneId, lanes]);
  const formIssues = useMemo(() => buildLoadingItemIssues(draft, subRoutes, mainRoutes, selectableLanes), [draft, mainRoutes, selectableLanes, subRoutes]);

  const filteredItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return items
      .filter((item) => {
        const subRoute = subRoutes.find((route) => route.id === item.subRouteId);
        const mainRoute = mainRoutes.find((route) => route.id === item.mainRouteId);
        const matchesKeyword =
          !keyword ||
          [
            subRoute?.routeName,
            subRoute?.flightNumber,
            mainRoute?.routeName,
            mainRoute?.flightNumber,
            item.laneName,
            item.supplierName,
            item.receivingName,
            item.orderNo,
            item.note,
            item.issueMemo,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(keyword));
        const matchesStatus = statusFilter === "all" || item.status === statusFilter;
        return matchesKeyword && matchesStatus;
      })
      .sort((a, b) => {
        const aSubRoute = subRoutes.find((route) => route.id === a.subRouteId);
        const bSubRoute = subRoutes.find((route) => route.id === b.subRouteId);
        return (
          (aSubRoute?.plannedStartOffsetMin || 0) - (bSubRoute?.plannedStartOffsetMin || 0) ||
          a.laneName.localeCompare(b.laneName) ||
          (a.supplierName || "").localeCompare(b.supplierName || "") ||
          (a.orderNo || "").localeCompare(b.orderNo || "")
        );
      });
  }, [items, mainRoutes, searchText, statusFilter, subRoutes]);

  function openCreateForm() {
    setDraft(loadingItemDefaults);
    setEditing(null);
    setError("");
    setFormOpen(true);
  }

  function openEditForm(item: LoadingItem) {
    setEditing(item);
    setDraft({
      subRouteId: item.subRouteId,
      mainRouteId: item.mainRouteId,
      laneId: item.laneId,
      laneName: item.laneName,
      supplierName: item.supplierName || "",
      receivingName: item.receivingName || "",
      orderNo: item.orderNo || "",
      status: item.status,
      qualityInstruction: item.qualityInstruction || "",
      safetyInstruction: item.safetyInstruction || "",
      note: item.note || "",
      issueMemo: item.issueMemo || "",
    });
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setDraft(loadingItemDefaults);
    setError("");
  }

  function applyLane(laneId: string) {
    const lane = lanes.find((item) => item.id === laneId);
    setDraft({ ...draft, laneId, laneName: lane?.name || "" });
  }

  async function save() {
    if (formIssues.length > 0) {
      setError(formIssues[0]);
      return;
    }
    if (draft.status === "lane_in_progress" && editing?.status !== "lane_in_progress") {
      const safetyIssue = buildLaneWorkSafetyIssue(draft.laneId, lanes, tasks);
      if (safetyIssue) {
        setError(safetyIssue);
        return;
      }
    }

    const payload = {
      subRouteId: draft.subRouteId,
      mainRouteId: draft.mainRouteId,
      laneId: draft.laneId,
      laneName: draft.laneName,
      supplierName: draft.supplierName.trim(),
      receivingName: draft.receivingName.trim(),
      orderNo: draft.orderNo.trim(),
      status: draft.status,
      qualityInstruction: draft.qualityInstruction.trim(),
      safetyInstruction: draft.safetyInstruction.trim(),
      note: draft.note.trim(),
      issueMemo: draft.issueMemo.trim(),
      siteId: user.siteId,
      businessDate,
    };

    try {
      if (editing) {
        if (editing.status !== draft.status) {
          await changeLoadingItemStatus(editing, draft.status, user, payload);
        } else {
          await updateEntity("loadingItems", editing, payload, user);
        }
      } else {
        await createLoadingItem(payload, user);
      }
      closeForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "搬入明細の保存に失敗しました。");
    }
  }

  async function remove(item: LoadingItem) {
    const label = buildItemLabel(item, routes);
    if (!window.confirm(`${label} を削除しますか？`)) return;
    await softDeleteEntity("loadingItems", item, user);
  }

  return (
    <Card className="loading-items-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Loading Items</p>
          <h2>搬入明細管理</h2>
        </div>
        <PrimaryButton type="button" onClick={openCreateForm}>搬入明細を追加</PrimaryButton>
      </div>

      {error ? <p className="alert">{error}</p> : null}
      <p className="helper-text">サブ便から届く荷物を、メイン便・レーン・仕入先・受入・オーダー単位で登録します。</p>

      {items.length > 0 ? (
        <div className="filter-bar loading-item-filter">
          <Field label="検索">
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="便・レーン・仕入先・受入・オーダー" />
          </Field>
          <Field label="状態">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | LoadingItemStatus)}>
              <option value="all">すべて</option>
              {Object.entries(loadingItemStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
      ) : null}

      {items.length === 0 ? <EmptyState message="この対象日の搬入明細はまだありません。" /> : null}
      {items.length > 0 && filteredItems.length === 0 ? <EmptyState message="条件に一致する搬入明細はありません。" /> : null}

      <div className="table-wrap">
        <table className="loading-items-table">
          <thead>
            <tr>
              <th>サブ便</th>
              <th>メイン便</th>
              <th>レーン</th>
              <th>仕入先 / 受入</th>
              <th>オーダー</th>
              <th>状態</th>
              <th>指示・メモ</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => {
              const subRoute = subRoutes.find((route) => route.id === item.subRouteId);
              const mainRoute = mainRoutes.find((route) => route.id === item.mainRouteId);
              return (
                <tr key={item.id}>
                  <td>{routeLabel(subRoute)}</td>
                  <td>{routeLabel(mainRoute)}</td>
                  <td>{item.laneName || "-"}</td>
                  <td>
                    <strong>{item.supplierName || "-"}</strong>
                    <span className="muted-id">{item.receivingName || "-"}</span>
                  </td>
                  <td>
                    <strong>{item.orderNo || "-"}</strong>
                  </td>
                  <td><LoadingItemStatusBadge status={item.status} /></td>
                  <td className="loading-item-notes">
                    {item.qualityInstruction ? <span>品質: {item.qualityInstruction}</span> : null}
                    {item.safetyInstruction ? <span>安全: {item.safetyInstruction}</span> : null}
                    {item.issueMemo ? <span>異常: {item.issueMemo}</span> : null}
                    {!item.qualityInstruction && !item.safetyInstruction && !item.issueMemo ? "-" : null}
                  </td>
                  <td className="table-actions">
                    <SecondaryButton type="button" onClick={() => openEditForm(item)}>編集</SecondaryButton>
                    <DangerButton type="button" onClick={() => remove(item)}>削除</DangerButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {formOpen ? (
        <Modal
          title={editing ? "搬入明細を編集" : "搬入明細を追加"}
          onClose={closeForm}
          footer={
            <>
              <PrimaryButton type="button" onClick={save} disabled={formIssues.length > 0} title={formIssues[0] || ""}>{editing ? "更新" : "追加"}</PrimaryButton>
              <SecondaryButton type="button" onClick={closeForm}>キャンセル</SecondaryButton>
            </>
          }
        >
          {error ? <p className="alert">{error}</p> : null}
          <FormCheckPanel issues={formIssues} warnings={[]} />
          <div className="form-grid loading-item-form-grid">
            <Field label="サブ便">
              <select value={draft.subRouteId} onChange={(event) => setDraft({ ...draft, subRouteId: event.target.value })}>
                <option value="">選択</option>
                {subRoutes.map((route) => <option key={route.id} value={route.id}>{routeLabel(route)}</option>)}
              </select>
            </Field>
            <Field label="メイン便">
              <select value={draft.mainRouteId} onChange={(event) => setDraft({ ...draft, mainRouteId: event.target.value })}>
                <option value="">選択</option>
                {mainRoutes.map((route) => <option key={route.id} value={route.id}>{routeLabel(route)}</option>)}
              </select>
            </Field>
            <Field label="レーン">
              <select value={draft.laneId} onChange={(event) => applyLane(event.target.value)}>
                <option value="">選択</option>
                {selectableLanes.map((lane: Lane) => (
                  <option key={lane.id} value={lane.id}>{lane.area} / {lane.name}{lane.active ? "" : "（無効）"}</option>
                ))}
              </select>
            </Field>
            <Field label="状態">
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as LoadingItemStatus })}>
                {Object.entries(loadingItemStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="仕入先">
              <input value={draft.supplierName} onChange={(event) => setDraft({ ...draft, supplierName: event.target.value })} />
            </Field>
            <Field label="納入先受入">
              <input value={draft.receivingName} onChange={(event) => setDraft({ ...draft, receivingName: event.target.value })} />
            </Field>
            <Field label="オーダー">
              <input value={draft.orderNo} onChange={(event) => setDraft({ ...draft, orderNo: event.target.value })} />
            </Field>
            <Field label="品質指示">
              <textarea value={draft.qualityInstruction} onChange={(event) => setDraft({ ...draft, qualityInstruction: event.target.value })} />
            </Field>
            <Field label="安全指示">
              <textarea value={draft.safetyInstruction} onChange={(event) => setDraft({ ...draft, safetyInstruction: event.target.value })} />
            </Field>
            <Field label="備考">
              <textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
            </Field>
            <Field label="異常メモ">
              <textarea value={draft.issueMemo} onChange={(event) => setDraft({ ...draft, issueMemo: event.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

function LoadingItemStatusBadge({ status }: { status: LoadingItemStatus }) {
  const tone = status === "lane_in_completed" ? "green" : status === "shortage" ? "amber" : status === "lane_in_progress" ? "blue" : "gray";
  return <span className={`status status-${tone}`}>{loadingItemStatusLabels[status]}</span>;
}

function buildLoadingItemIssues(
  draft: typeof loadingItemDefaults,
  subRoutes: Route[],
  mainRoutes: Route[],
  lanes: Lane[],
): string[] {
  const issues: string[] = [];
  if (!draft.subRouteId) issues.push("サブ便を選択してください。");
  if (!draft.mainRouteId) issues.push("メイン便を選択してください。");
  if (!draft.laneId) issues.push("レーンを選択してください。");
  if (draft.subRouteId && !subRoutes.some((route) => route.id === draft.subRouteId)) issues.push("選択したサブ便が見つかりません。");
  if (draft.mainRouteId && !mainRoutes.some((route) => route.id === draft.mainRouteId)) issues.push("選択したメイン便が見つかりません。");
  if (draft.laneId && !lanes.some((lane) => lane.id === draft.laneId)) issues.push("選択したレーンが見つかりません。");
  return issues;
}

function routeLabel(route: Route | undefined): string {
  if (!route) return "-";
  return `${route.routeName} / ${route.flightNumber}`;
}

function buildItemLabel(item: LoadingItem, routes: Route[]): string {
  const subRoute = routes.find((route) => route.id === item.subRouteId);
  return [routeLabel(subRoute), item.supplierName, item.receivingName, item.orderNo].filter(Boolean).join(" / ");
}
