import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createEntity, softDeleteEntity, subscribeMasters, updateEntity } from "../services/firestoreService";
import type { AppUser, Lane, Station, Worker } from "../types";
import { MASTER_BUSINESS_DATE } from "../lib/firebase";
import { Card, DangerButton, EmptyState, Field, Modal, PrimaryButton, SecondaryButton } from "../components/ui";

type MasterKind = "stations" | "lanes" | "workers";

const emptyStation = { name: "", area: "", sortOrder: 0, active: true };
const emptyLane = { name: "", area: "", adjacentLaneIds: "", sortOrder: 0, active: true };
const emptyWorker = { name: "", displayName: "", active: true };

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

  async function save() {
    const payload = { ...draft, name: draft.name.trim(), area: draft.area.trim() };
    if (!payload.name || !payload.area) {
      window.alert("ステーション名とエリアは必須です。");
      return;
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
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "ステーションの保存に失敗しました。");
    }
  }

  return (
    <>
      <MasterForm onSave={save} onCancel={() => { setEditing(null); setDraft(emptyStation); }} editing={Boolean(editing)}>
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
                  <DangerButton type="button" onClick={() => softDeleteEntity("stations", item, user)}>削除</DangerButton>
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

  async function save() {
    const payload = {
      ...draft,
      name: draft.name.trim(),
      area: draft.area.trim(),
      adjacentLaneIds: draft.adjacentLaneIds.split(",").map((id) => id.trim()).filter(Boolean),
    };
    if (!payload.name || !payload.area) {
      window.alert("レーン名とエリアは必須です。");
      return;
    }
    try {
      if (editing) {
        await updateEntity("lanes", editing, payload, user);
        setEditing(null);
      } else {
        await createEntity("lanes", { ...payload, siteId: user.siteId, businessDate: MASTER_BUSINESS_DATE }, user);
      }
      setDraft(emptyLane);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "レーンの保存に失敗しました。");
    }
  }

  return (
    <>
      <MasterForm onSave={save} onCancel={() => { setEditing(null); setDraft(emptyLane); }} editing={Boolean(editing)}>
        <Field label="名称"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="エリア"><input value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} /></Field>
        <Field label="隣接レーンID"><input value={draft.adjacentLaneIds} onChange={(e) => setDraft({ ...draft, adjacentLaneIds: e.target.value })} placeholder="カンマ区切り" /></Field>
        <Field label="並び順"><input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} /></Field>
        <label className="check-row"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> 有効</label>
      </MasterForm>
      <div className="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>エリア</th><th>隣接レーン</th><th>並び順</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td><td>{item.area}</td><td>{item.adjacentLaneIds.join(", ") || "-"}</td><td>{item.sortOrder}</td><td>{item.active ? "有効" : "無効"}</td>
                <td className="table-actions">
                  <SecondaryButton type="button" onClick={() => { setEditing(item); setDraft({ name: item.name, area: item.area, adjacentLaneIds: item.adjacentLaneIds.join(", "), sortOrder: item.sortOrder, active: item.active }); }}>編集</SecondaryButton>
                  <DangerButton type="button" onClick={() => softDeleteEntity("lanes", item, user)}>削除</DangerButton>
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

  async function save() {
    const payload = { ...draft, name: draft.name.trim(), displayName: draft.displayName.trim() };
    if (!payload.name || !payload.displayName) {
      window.alert("氏名と表示名は必須です。");
      return;
    }
    try {
      if (editing) {
        await updateEntity("workers", editing, payload, user);
        setEditing(null);
      } else {
        await createEntity("workers", { ...payload, siteId: user.siteId, businessDate: MASTER_BUSINESS_DATE }, user);
      }
      setDraft(emptyWorker);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "作業員の保存に失敗しました。");
    }
  }

  return (
    <>
      <MasterForm onSave={save} onCancel={() => { setEditing(null); setDraft(emptyWorker); }} editing={Boolean(editing)}>
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
                  <DangerButton type="button" onClick={() => softDeleteEntity("workers", item, user)}>削除</DangerButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MasterForm({ children, editing, onSave, onCancel }: { children: ReactNode; editing: boolean; onSave: () => Promise<void>; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (editing) setOpen(true);
  }, [editing]);

  const content = (
    <div className="form-grid">
      {children}
      <div className="form-actions">
        <PrimaryButton type="button" onClick={async () => { await onSave(); setOpen(false); }}>{editing ? "更新" : "追加"}</PrimaryButton>
        <SecondaryButton type="button" onClick={() => { onCancel(); setOpen(false); }}>キャンセル</SecondaryButton>
      </div>
    </div>
  );

  return (
    <>
      <div className="toolbar"><PrimaryButton type="button" onClick={() => setOpen(true)}>新規追加</PrimaryButton></div>
      {open ? <Modal title={editing ? "編集" : "新規追加"} onClose={() => { onCancel(); setOpen(false); }}>{content}</Modal> : null}
    </>
  );
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
