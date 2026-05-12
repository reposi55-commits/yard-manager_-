import { useEffect, useMemo, useState } from "react";
import { Card, DangerButton, EmptyState, Field, FormCheckPanel, Modal, PrimaryButton, SecondaryButton, StatusBadge } from "../components/ui";
import { createEntity, softDeleteEntity, subscribeDaily, updateEntity } from "../services/firestoreService";
import type { AppUser, Route, RouteStatus, RouteType, Station } from "../types";
import { formatTimestamp, labelToOffsetMin } from "../utils/date";
import { routeStatusLabels } from "../utils/status";
import { useMasterOptions } from "./MasterManagement";

const routeDefaults = {
  type: "main" as RouteType,
  routeName: "",
  flightNumber: "",
  stationId: "",
  stationName: "",
  plannedStartLabel: "08:00",
  plannedEndLabel: "09:00",
  status: "waiting" as RouteStatus,
};

export function RouteManagement({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [draft, setDraft] = useState(routeDefaults);
  const [editing, setEditing] = useState<Route | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | RouteType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RouteStatus>("all");
  const { stations } = useMasterOptions(user);

  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);

  const selectableStations = useMemo(
    () => stations.filter((station) => station.active || station.id === draft.stationId),
    [stations, draft.stationId],
  );

  const filteredRoutes = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return routes.filter((route) => {
      const matchesKeyword =
        !keyword ||
        [route.routeName, route.flightNumber, route.stationName]
          .some((value) => value.toLowerCase().includes(keyword));
      const matchesType = typeFilter === "all" || route.type === typeFilter;
      const matchesStatus = statusFilter === "all" || route.status === statusFilter;
      return matchesKeyword && matchesType && matchesStatus;
    });
  }, [routes, searchText, typeFilter, statusFilter]);
  const formIssues = useMemo(() => buildRouteFormIssues(draft), [draft]);
  const formWarnings = useMemo(() => {
    if (formIssues.length > 0) return [];
    return buildRouteWarnings(routes, editing?.id, {
      routeName: draft.routeName.trim(),
      flightNumber: draft.flightNumber.trim(),
      stationId: draft.stationId,
      plannedStartOffsetMin: labelToOffsetMin(draft.plannedStartLabel),
      plannedEndOffsetMin: labelToOffsetMin(draft.plannedEndLabel),
    });
  }, [draft, editing?.id, formIssues.length, routes]);

  function openCreateForm() {
    setDraft(routeDefaults);
    setEditing(null);
    setError("");
    setFormOpen(true);
  }

  function openEditForm(route: Route) {
    setEditing(route);
    setDraft({
      type: route.type,
      routeName: route.routeName,
      flightNumber: route.flightNumber,
      stationId: route.stationId,
      stationName: route.stationName,
      plannedStartLabel: route.plannedStartLabel,
      plannedEndLabel: route.plannedEndLabel,
      status: route.status,
    });
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setDraft(routeDefaults);
    setError("");
  }

  function applyStation(stationId: string) {
    const station = stations.find((item) => item.id === stationId);
    setDraft({ ...draft, stationId, stationName: station?.name || "" });
  }

  async function save() {
    const routeName = draft.routeName.trim();
    const flightNumber = draft.flightNumber.trim();
    if (formIssues.length > 0) {
      setError(formIssues[0]);
      return;
    }

    const plannedStartOffsetMin = labelToOffsetMin(draft.plannedStartLabel);
    const plannedEndOffsetMin = labelToOffsetMin(draft.plannedEndLabel);
    if (formWarnings.length > 0 && !window.confirm(`確認が必要な内容があります。\n\n${formWarnings.join("\n")}\n\nこのまま保存しますか？`)) {
      return;
    }

    const payload = {
      ...draft,
      routeName,
      flightNumber,
      siteId: user.siteId,
      businessDate,
      plannedStartOffsetMin,
      plannedEndOffsetMin,
    };

    try {
      if (editing) {
        await updateEntity("routes", editing, payload, user);
      } else {
        await createEntity("routes", payload, user);
      }
      closeForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "便の保存に失敗しました。");
    }
  }

  async function remove(route: Route) {
    const label = `${route.routeName} / ${route.flightNumber}`;
    const message = route.actualStartAt || route.actualEndAt
      ? `実績時刻がある便です。\n${label} を論理削除しても実績は残ります。続行しますか？`
      : `${label} を削除しますか？`;
    if (!window.confirm(message)) return;
    await softDeleteEntity("routes", route, user);
  }

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Routes</p>
          <h2>便管理</h2>
        </div>
        <PrimaryButton type="button" onClick={openCreateForm}>新規追加</PrimaryButton>
      </div>

      {!formOpen && error ? <p className="alert">{error}</p> : null}
      {routes.length === 0 ? <EmptyState message="この対象日の便はまだありません。" /> : null}
      {routes.length > 0 ? (
        <div className="filter-bar">
          <Field label="検索">
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="便名・便番号・ステーション" />
          </Field>
          <Field label="種別">
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | RouteType)}>
              <option value="all">すべて</option>
              <option value="main">メイン便</option>
              <option value="sub">サブ便</option>
            </select>
          </Field>
          <Field label="状態">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | RouteStatus)}>
              <option value="all">すべて</option>
              {Object.entries(routeStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
      ) : null}
      {routes.length > 0 && filteredRoutes.length === 0 ? <EmptyState message="条件に一致する便はありません。" /> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>種別</th>
              <th>便名</th>
              <th>便番号</th>
              <th>ステーション</th>
              <th>予定</th>
              <th>実績</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoutes.map((route) => (
              <tr key={route.id}>
                <td>{route.type === "main" ? "メイン" : "サブ"}</td>
                <td>{route.routeName}</td>
                <td>{route.flightNumber}</td>
                <td>{route.stationName}</td>
                <td>{route.plannedStartLabel} - {route.plannedEndLabel}</td>
                <td className="actual-times">
                  <span>開始 {formatTimestamp(route.actualStartAt)}</span>
                  <span>完了 {formatTimestamp(route.actualEndAt)}</span>
                </td>
                <td><StatusBadge type="route" status={route.status} /></td>
                <td className="table-actions">
                  <SecondaryButton type="button" onClick={() => openEditForm(route)}>編集</SecondaryButton>
                  <DangerButton type="button" onClick={() => remove(route)}>削除</DangerButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen ? (
        <Modal
          title={editing ? "便を編集" : "便を追加"}
          onClose={closeForm}
          footer={
            <>
              <PrimaryButton type="button" onClick={save} disabled={formIssues.length > 0} title={formIssues[0] || ""}>{editing ? "更新" : "追加"}</PrimaryButton>
              <SecondaryButton type="button" onClick={closeForm}>キャンセル</SecondaryButton>
            </>
          }
        >
          {error ? <p className="alert">{error}</p> : null}
          <FormCheckPanel issues={formIssues} warnings={formWarnings} />
          <div className="form-grid">
            <Field label="種別">
              <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as RouteType })}>
                <option value="main">メイン便</option>
                <option value="sub">サブ便</option>
              </select>
            </Field>
            <Field label="便名">
              <input value={draft.routeName} onChange={(event) => setDraft({ ...draft, routeName: event.target.value })} />
            </Field>
            <Field label="便番号">
              <input value={draft.flightNumber} onChange={(event) => setDraft({ ...draft, flightNumber: event.target.value })} />
            </Field>
            <Field label="ステーション">
              <select value={draft.stationId} onChange={(event) => applyStation(event.target.value)}>
                <option value="">選択</option>
                {selectableStations.map((station: Station) => (
                  <option key={station.id} value={station.id}>
                    {station.area} / {station.name}{station.active ? "" : "（無効）"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="予定開始">
              <input type="time" value={draft.plannedStartLabel} onChange={(event) => setDraft({ ...draft, plannedStartLabel: event.target.value })} />
            </Field>
            <Field label="予定終了">
              <input type="time" value={draft.plannedEndLabel} onChange={(event) => setDraft({ ...draft, plannedEndLabel: event.target.value })} />
            </Field>
            <Field label="状態">
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as RouteStatus })}>
                {Object.entries(routeStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

function buildRouteFormIssues(draft: typeof routeDefaults): string[] {
  const issues: string[] = [];
  if (!draft.routeName.trim()) issues.push("便名を入力してください。");
  if (!draft.flightNumber.trim()) issues.push("便番号を入力してください。");
  if (!draft.stationId) issues.push("ステーションを選択してください。");
  if (!draft.plannedStartLabel) issues.push("予定開始を入力してください。");
  if (!draft.plannedEndLabel) issues.push("予定終了を入力してください。");
  if (draft.plannedStartLabel && draft.plannedEndLabel && labelToOffsetMin(draft.plannedEndLabel) <= labelToOffsetMin(draft.plannedStartLabel)) {
    issues.push("予定終了は予定開始より後の時刻にしてください。");
  }
  return issues;
}

function buildRouteWarnings(
  routes: Route[],
  editingId: string | undefined,
  draft: {
    routeName: string;
    flightNumber: string;
    stationId: string;
    plannedStartOffsetMin: number;
    plannedEndOffsetMin: number;
  },
): string[] {
  const targets = routes.filter((route) => route.id !== editingId);
  const warnings: string[] = [];
  const duplicateFlight = targets.find((route) => route.flightNumber === draft.flightNumber);
  const stationOverlap = targets.find(
    (route) =>
      route.stationId === draft.stationId &&
      rangesOverlap(draft.plannedStartOffsetMin, draft.plannedEndOffsetMin, route.plannedStartOffsetMin, route.plannedEndOffsetMin),
  );

  if (duplicateFlight) {
    warnings.push(`同じ便番号の便があります: ${duplicateFlight.routeName} / ${duplicateFlight.flightNumber}`);
  }
  if (stationOverlap) {
    warnings.push(`同じステーションで予定時間が重なっています: ${stationOverlap.routeName} / ${stationOverlap.flightNumber}`);
  }
  return warnings;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}
