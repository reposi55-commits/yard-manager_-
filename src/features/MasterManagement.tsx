import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createEntity, softDeleteEntity, subscribeMasters, updateEntity } from "../services/firestoreService";
import type { AppUser, Lane, Station, Worker } from "../types";
import { MASTER_BUSINESS_DATE } from "../lib/firebase";
import { Card, DangerButton, EmptyState, Field, FormCheckPanel, Modal, PrimaryButton, SecondaryButton } from "../components/ui";

type MasterKind = "stations" | "lanes" | "workers";

const emptyStation = { name: "", area: "", sortOrder: 0, active: true };
const emptyLane = { name: "", area: "", adjacentLaneIds: [] as string[], sortOrder: 0, active: true };
const emptyWorker = { name: "", displayName: "", active: true };
const masterOptionCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function confirmDelete(label: string): boolean {
  return window.confirm(`${label} を削除しますか？`);
}

export function MasterManagement({ kind, user }: { kind: MasterKind; user: AppUser }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (kind === "stations") return subscribeMasters("stations", user.siteId, setStations, setError);
    if (kind === "lanes") return subscribeMasters("lanes", user.siteId, setLanes, setError);
    return subscribeMasters("workers", user.siteId, setWorkers, setError);
  }, [kind, user.siteId]);

  const title = kind === "stations" ? "ステーション管理" : kind === "lanes" ? "レーン管理" : "作業員管理";
  const items = kind === "stations" ? stations : kind === "lanes" ? lanes : workers;

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Master</p>
          <h2>{title}</h2>
        </div>
      </div>
      {error ? <p className="alert">{error}</p> : null}
      {kind === "stations" ? <StationEditor user={user} items={stations} /> : null}
      {kind === "lanes" ? <LaneEditor user={user} items={lanes} /> : null}
      {kind === "workers" ? <WorkerEditor user={user} items={workers} /> : null}
      {items.length === 0 ? <EmptyState message="登録データがありません。" /> : null}
    </Card>
  );
}

function StationEditor({ user, items }: { user: AppUser; items: Station[] }) {
  const [draft, setDraft] = useState(emptyStation);
  const [editing, setEditing] = useState<Station | null>(null);
  const issues = useMemo(() => buildStationIssues(draft), [draft]);
  const warnings = useMemo(() => buildMasterNameWarnings(items, editing?.id, draft.name, "同じ名前のステーションが既にあります。"), [draft.name, editing?.id, items]);

  async function save(): Promise<boolean> {
    const payload = { ...draft, name: draft.name.trim(), area: draft.area.trim() };
    if (issues.length > 0) {
      window.alert(issues[0]);
      return false;
    }
    try {
      if (editing) {
        await updateEntity("stations", editing, payload, user);
        setEditing(null);
      } else {
        await createEntity(
          "stations",
          { ...payload, siteId: user.siteId, businessDate: MASTER_BUSINESS_DATE },
          user,
        );
      }
      setDraft(emptyStation);
      return true;
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "ステーションの保存に失敗しました。");
      return false;
    }
  }

  return (
    <>
      <MasterForm issues={issues} warnings={warnings} onSave={save} onCancel={() => { setEditing(null); setDraft(emptyStation); }} editing={Boolean(editing)}>
        <Field label="名称"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="エリア"><input value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} /></Field>
        <Field label="並び順"><input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} /></Field>
        <label className="check-row"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> 有効</label>
      </MasterForm>
      <div className="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>エリア</th><th>並び順</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td><td>{item.area}</td><td>{item.sortOrder}</td><td>{item.active ? "有効" : "無効"}</td>
                <td className="table-actions">
                  <SecondaryButton type="button" onClick={() => { setEditing(item); setDraft({ name: item.name, area: item.area, sortOrder: item.sortOrder, active: item.active }); }}>編集</SecondaryButton>
                  <DangerButton type="button" onClick={() => { if (confirmDelete(item.name)) void softDeleteEntity("stations", item, user); }}>削除</DangerButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LaneEditor({ user, items }: { user: AppUser; items: Lane[] }) {
  const [draft, setDraft] = useState(emptyLane);
  const [editing, setEditing] = useState<Lane | null>(null);
  const issues = useMemo(() => buildLaneIssues(draft), [draft]);
  const warnings = useMemo(() => buildMasterNameWarnings(items, editing?.id, draft.name, "同じ名前のレーンが既にあります。"), [draft.name, editing?.id, items]);
  const sortedLaneItems = useMemo(() => [...items].sort(compareLaneOptions), [items]);
  const selectableAdjacentLanes = useMemo(
    () => sortedLaneItems.filter((item) => item.id !== editing?.id && (item.active || draft.adjacentLaneIds.includes(item.id))),
    [draft.adjacentLaneIds, editing?.id, sortedLaneItems],
  );

  async function save(): Promise<boolean> {
    const payload = {
      ...draft,
      name: draft.name.trim(),
      area: draft.area.trim(),
      adjacentLaneIds: draft.adjacentLaneIds.filter((id, index, ids) => id !== editing?.id && ids.indexOf(id) === index),
    };
    if (issues.length > 0) {
      window.alert(issues[0]);
      return false;
    }
    try {
      if (editing) {
        await updateEntity("lanes", editing, payload, user);
        setEditing(null);
      } else {
        await createEntity("lanes", { ...payload, siteId: user.siteId, businessDate: MASTER_BUSINESS_DATE }, user);
      }
      setDraft(emptyLane);
      return true;
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "レーンの保存に失敗しました。");
      return false;
    }
  }

  return (
    <>
      <MasterForm issues={issues} warnings={warnings} onSave={save} onCancel={() => { setEditing(null); setDraft(emptyLane); }} editing={Boolean(editing)}>
        <Field label="名称"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="エリア"><input value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} /></Field>
        <Field label="隣接レーン">
          <div className="choice-list">
            {selectableAdjacentLanes.length === 0 ? <p className="helper-text">選択できる既存レーンがありません。</p> : null}
            {selectableAdjacentLanes.map((lane) => {
              const checked = draft.adjacentLaneIds.includes(lane.id);
              return (
                <label className="check-row choice-item" key={lane.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextIds = event.target.checked
                        ? [...draft.adjacentLaneIds, lane.id]
                        : draft.adjacentLaneIds.filter((id) => id !== lane.id);
                      setDraft({ ...draft, adjacentLaneIds: nextIds });
                    }}
                  />
                  <span>{formatLaneLabel(lane)}</span>
                </label>
              );
            })}
          </div>
        </Field>
        <Field label="並び順"><input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} /></Field>
        <label className="check-row"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> 有効</label>
      </MasterForm>
      <div className="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>エリア</th><th>隣接レーン</th><th>並び順</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            {sortedLaneItems.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td><td>{item.area}</td><td>{formatAdjacentLaneNames(item.adjacentLaneIds, items)}</td><td>{item.sortOrder}</td><td>{item.active ? "有効" : "無効"}</td>
                <td className="table-actions">
                  <SecondaryButton type="button" onClick={() => { setEditing(item); setDraft({ name: item.name, area: item.area, adjacentLaneIds: item.adjacentLaneIds, sortOrder: item.sortOrder, active: item.active }); }}>編集</SecondaryButton>
                  <DangerButton type="button" onClick={() => { if (confirmDelete(item.name)) void softDeleteEntity("lanes", item, user); }}>削除</DangerButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function WorkerEditor({ user, items }: { user: AppUser; items: Worker[] }) {
  const [draft, setDraft] = useState(emptyWorker);
  const [editing, setEditing] = useState<Worker | null>(null);
  const issues = useMemo(() => buildWorkerIssues(draft), [draft]);
  const warnings = useMemo(() => {
    const name = draft.name.trim();
    const displayName = draft.displayName.trim();
    return items
      .filter((item) => item.id !== editing?.id)
      .filter((item) => (name && item.name === name) || (displayName && item.displayName === displayName))
      .map((item) => `同じ作業員名または表示名が既にあります: ${item.displayName || item.name}`);
  }, [draft.displayName, draft.name, editing?.id, items]);

  async function save(): Promise<boolean> {
    const payload = { ...draft, name: draft.name.trim(), displayName: draft.displayName.trim() };
    if (issues.length > 0) {
      window.alert(issues[0]);
      return false;
    }
    try {
      if (editing) {
        await updateEntity("workers", editing, payload, user);
        setEditing(null);
      } else {
        await createEntity("workers", { ...payload, siteId: user.siteId, businessDate: MASTER_BUSINESS_DATE }, user);
      }
      setDraft(emptyWorker);
      return true;
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "作業員の保存に失敗しました。");
      return false;
    }
  }

  return (
    <>
      <MasterForm issues={issues} warnings={warnings} onSave={save} onCancel={() => { setEditing(null); setDraft(emptyWorker); }} editing={Boolean(editing)}>
        <Field label="氏名"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="表示名"><input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} /></Field>
        <label className="check-row"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> 有効</label>
      </MasterForm>
      <div className="table-wrap">
        <table>
          <thead><tr><th>作業員ID</th><th>氏名</th><th>表示名</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><code>{item.id}</code></td><td>{item.name}</td><td>{item.displayName}</td><td>{item.active ? "有効" : "無効"}</td>
                <td className="table-actions">
                  <SecondaryButton type="button" onClick={() => { setEditing(item); setDraft({ name: item.name, displayName: item.displayName, active: item.active }); }}>編集</SecondaryButton>
                  <DangerButton type="button" onClick={() => { if (confirmDelete(item.displayName || item.name)) void softDeleteEntity("workers", item, user); }}>削除</DangerButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MasterForm({
  children,
  editing,
  issues,
  warnings,
  onSave,
  onCancel,
}: {
  children: ReactNode;
  editing: boolean;
  issues: string[];
  warnings: string[];
  onSave: () => Promise<boolean>;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (editing) setOpen(true);
  }, [editing]);

  const content = (
    <>
      <FormCheckPanel issues={issues} warnings={warnings} />
      <div className="form-grid">
        {children}
        <div className="form-actions">
          <PrimaryButton
            type="button"
            disabled={issues.length > 0}
            title={issues[0] || ""}
            onClick={async () => {
              const saved = await onSave();
              if (saved) setOpen(false);
            }}
          >
            {editing ? "更新" : "追加"}
          </PrimaryButton>
          <SecondaryButton type="button" onClick={() => { onCancel(); setOpen(false); }}>キャンセル</SecondaryButton>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="toolbar"><PrimaryButton type="button" onClick={() => setOpen(true)}>新規追加</PrimaryButton></div>
      {open ? <Modal title={editing ? "編集" : "新規追加"} onClose={() => { onCancel(); setOpen(false); }}>{content}</Modal> : null}
    </>
  );
}

function buildStationIssues(draft: typeof emptyStation): string[] {
  const issues: string[] = [];
  if (!draft.name.trim()) issues.push("ステーション名を入力してください。");
  if (!draft.area.trim()) issues.push("エリアを入力してください。");
  if (!Number.isFinite(draft.sortOrder)) issues.push("並び順は数値で入力してください。");
  return issues;
}

function buildLaneIssues(draft: typeof emptyLane): string[] {
  const issues: string[] = [];
  if (!draft.name.trim()) issues.push("レーン名を入力してください。");
  if (!draft.area.trim()) issues.push("エリアを入力してください。");
  if (!Number.isFinite(draft.sortOrder)) issues.push("並び順は数値で入力してください。");
  return issues;
}

function formatLaneLabel(lane: Lane): string {
  return `${lane.name}${lane.area ? ` / ${lane.area}` : ""}${lane.active ? "" : "（無効）"}`;
}

function formatAdjacentLaneNames(adjacentLaneIds: string[], lanes: Lane[]): string {
  const laneMap = new Map(lanes.map((lane) => [lane.id, lane]));
  const labels = [...adjacentLaneIds].sort((a, b) => compareLaneIdOptions(a, b, laneMap)).map((id) => {
    const lane = laneMap.get(id);
    return lane ? formatLaneLabel(lane) : id;
  });
  return labels.length > 0 ? labels.join(", ") : "-";
}

function compareLaneOptions(a: Lane, b: Lane): number {
  return Number(b.active) - Number(a.active) || masterOptionCollator.compare(a.name, b.name) || masterOptionCollator.compare(a.area, b.area);
}

function compareLaneIdOptions(a: string, b: string, lanes: Map<string, Lane>): number {
  const laneA = lanes.get(a);
  const laneB = lanes.get(b);
  if (laneA && laneB) return compareLaneOptions(laneA, laneB);
  if (laneA) return -1;
  if (laneB) return 1;
  return masterOptionCollator.compare(a, b);
}

function buildWorkerIssues(draft: typeof emptyWorker): string[] {
  const issues: string[] = [];
  if (!draft.name.trim()) issues.push("氏名を入力してください。");
  if (!draft.displayName.trim()) issues.push("表示名を入力してください。");
  return issues;
}

function buildMasterNameWarnings<T extends { id: string; name: string }>(items: T[], editingId: string | undefined, name: string, message: string): string[] {
  const trimmedName = name.trim();
  if (!trimmedName) return [];
  return items
    .filter((item) => item.id !== editingId && item.name === trimmedName)
    .map(() => message);
}

export function useMasterOptions(user: AppUser) {
  const [stations, setStations] = useState<Station[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribers = [
      subscribeMasters("stations", user.siteId, setStations, setError),
      subscribeMasters("lanes", user.siteId, setLanes, setError),
      subscribeMasters("workers", user.siteId, setWorkers, setError),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [user.siteId]);

  return useMemo(() => ({ stations, lanes, workers, error }), [stations, lanes, workers, error]);
}
