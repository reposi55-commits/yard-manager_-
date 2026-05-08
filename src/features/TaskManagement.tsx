import { useEffect, useMemo, useState } from "react";
import { Card, DangerButton, EmptyState, Field, Modal, PrimaryButton, SecondaryButton, StatusBadge } from "../components/ui";
import { createEntity, softDeleteEntity, subscribeDaily, updateEntity } from "../services/firestoreService";
import type { AppUser, Lane, Route, Task, TaskStatus, Worker } from "../types";
import { labelToOffsetMin } from "../utils/date";
import { taskStatusLabels } from "../utils/status";
import { useMasterOptions } from "./MasterManagement";

const taskDefaults = {
  taskName: "",
  workerId: "",
  workerName: "",
  laneId: "",
  laneName: "",
  targetMainRouteId: "",
  targetMainRouteName: "",
  targetMainFlightNumber: "",
  instruction: "",
  plannedStartLabel: "08:00",
  plannedEndLabel: "09:00",
  status: "pending" as TaskStatus,
};

export function TaskManagement({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [draft, setDraft] = useState(taskDefaults);
  const [editing, setEditing] = useState<Task | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const { lanes, workers } = useMasterOptions(user);
  const mainRoutes = useMemo(() => routes.filter((route) => route.type === "main"), [routes]);
  const filteredTasks = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesKeyword =
        !keyword ||
        [task.taskName, task.workerName, task.laneName, task.targetMainRouteName, task.targetMainFlightNumber]
          .some((value) => value.toLowerCase().includes(keyword));
      const matchesWorker = workerFilter === "all" || task.workerId === workerFilter;
      const matchesStatus = statusFilter === "all" || task.status === statusFilter;
      return matchesKeyword && matchesWorker && matchesStatus;
    });
  }, [tasks, searchText, workerFilter, statusFilter]);

  useEffect(() => subscribeDaily("tasks", user.siteId, businessDate, setTasks, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);

  function openCreateForm() {
    setDraft(taskDefaults);
    setEditing(null);
    setError("");
    setFormOpen(true);
  }

  function openEditForm(task: Task) {
    setEditing(task);
    setDraft({
      taskName: task.taskName,
      workerId: task.workerId,
      workerName: task.workerName,
      laneId: task.laneId,
      laneName: task.laneName,
      targetMainRouteId: task.targetMainRouteId,
      targetMainRouteName: task.targetMainRouteName,
      targetMainFlightNumber: task.targetMainFlightNumber,
      instruction: task.instruction,
      plannedStartLabel: task.plannedStartLabel,
      plannedEndLabel: task.plannedEndLabel,
      status: task.status,
    });
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setDraft(taskDefaults);
    setError("");
  }

  function applyWorker(workerId: string) {
    const worker = workers.find((item) => item.id === workerId);
    setDraft({ ...draft, workerId, workerName: worker?.displayName || worker?.name || "" });
  }

  function applyLane(laneId: string) {
    const lane = lanes.find((item) => item.id === laneId);
    setDraft({ ...draft, laneId, laneName: lane?.name || "" });
  }

  function applyMainRoute(targetMainRouteId: string) {
    const route = mainRoutes.find((item) => item.id === targetMainRouteId);
    setDraft({
      ...draft,
      targetMainRouteId,
      targetMainRouteName: route?.routeName || "",
      targetMainFlightNumber: route?.flightNumber || "",
    });
  }

  async function save() {
    const taskName = draft.taskName.trim();
    if (!taskName || !draft.workerId || !draft.laneId || !draft.targetMainRouteId || !draft.plannedStartLabel || !draft.plannedEndLabel) {
      setError("タスク名、作業員、レーン、対象メイン便、予定時刻は必須です。");
      return;
    }

    const plannedStartOffsetMin = labelToOffsetMin(draft.plannedStartLabel);
    const plannedEndOffsetMin = labelToOffsetMin(draft.plannedEndLabel);
    if (plannedEndOffsetMin <= plannedStartOffsetMin) {
      setError("予定終了は予定開始より後の時刻にしてください。");
      return;
    }

    const payload = {
      ...draft,
      taskName,
      instruction: draft.instruction.trim(),
      siteId: user.siteId,
      businessDate,
      plannedStartOffsetMin,
      plannedEndOffsetMin,
    };

    try {
      if (editing) {
        await updateEntity("tasks", editing, payload, user);
      } else {
        await createEntity("tasks", payload, user);
      }
      closeForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "タスクの保存に失敗しました。");
    }
  }

  async function remove(task: Task) {
    const label = `${task.taskName} / ${task.workerName}`;
    const message = task.actualStartAt || task.actualEndAt
      ? `実績時刻があるタスクです。\n${label} を論理削除しても実績は残ります。続行しますか？`
      : `${label} を削除しますか？`;
    if (!window.confirm(message)) return;
    await softDeleteEntity("tasks", task, user);
  }

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Tasks</p>
          <h2>タスク管理</h2>
        </div>
        <PrimaryButton type="button" onClick={openCreateForm}>新規追加</PrimaryButton>
      </div>

      {!formOpen && error ? <p className="alert">{error}</p> : null}
      {tasks.length === 0 ? <EmptyState message="この対象日のタスクはまだありません。" /> : null}
      {tasks.length > 0 ? (
        <div className="filter-bar">
          <Field label="検索">
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="タスク名・作業員・レーン・対象便" />
          </Field>
          <Field label="作業員">
            <select value={workerFilter} onChange={(event) => setWorkerFilter(event.target.value)}>
              <option value="all">すべて</option>
              {workers.map((worker: Worker) => <option key={worker.id} value={worker.id}>{worker.displayName || worker.name}</option>)}
            </select>
          </Field>
          <Field label="状態">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | TaskStatus)}>
              <option value="all">すべて</option>
              {Object.entries(taskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
      ) : null}
      {tasks.length > 0 && filteredTasks.length === 0 ? <EmptyState message="条件に一致するタスクはありません。" /> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>タスク</th>
              <th>作業員</th>
              <th>レーン</th>
              <th>対象便</th>
              <th>予定</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map((task) => (
              <tr key={task.id}>
                <td>{task.taskName}</td>
                <td>{task.workerName}</td>
                <td>{task.laneName}</td>
                <td>{task.targetMainRouteName} {task.targetMainFlightNumber}</td>
                <td>{task.plannedStartLabel} - {task.plannedEndLabel}</td>
                <td><StatusBadge type="task" status={task.status} /></td>
                <td className="table-actions">
                  <SecondaryButton type="button" onClick={() => openEditForm(task)}>編集</SecondaryButton>
                  <DangerButton type="button" onClick={() => remove(task)}>削除</DangerButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen ? (
        <Modal
          title={editing ? "タスクを編集" : "タスクを追加"}
          onClose={closeForm}
          footer={
            <>
              <PrimaryButton type="button" onClick={save}>{editing ? "更新" : "追加"}</PrimaryButton>
              <SecondaryButton type="button" onClick={closeForm}>キャンセル</SecondaryButton>
            </>
          }
        >
          {error ? <p className="alert">{error}</p> : null}
          <div className="form-grid">
            <Field label="タスク名">
              <input value={draft.taskName} onChange={(event) => setDraft({ ...draft, taskName: event.target.value })} />
            </Field>
            <Field label="作業員">
              <select value={draft.workerId} onChange={(event) => applyWorker(event.target.value)}>
                <option value="">選択</option>
                {workers.map((worker: Worker) => <option key={worker.id} value={worker.id}>{worker.displayName || worker.name}</option>)}
              </select>
            </Field>
            <Field label="レーン">
              <select value={draft.laneId} onChange={(event) => applyLane(event.target.value)}>
                <option value="">選択</option>
                {lanes.map((lane: Lane) => <option key={lane.id} value={lane.id}>{lane.area} / {lane.name}</option>)}
              </select>
            </Field>
            <Field label="対象メイン便">
              <select value={draft.targetMainRouteId} onChange={(event) => applyMainRoute(event.target.value)}>
                <option value="">選択</option>
                {mainRoutes.map((route) => <option key={route.id} value={route.id}>{route.routeName} / {route.flightNumber}</option>)}
              </select>
            </Field>
            <Field label="予定開始">
              <input type="time" value={draft.plannedStartLabel} onChange={(event) => setDraft({ ...draft, plannedStartLabel: event.target.value })} />
            </Field>
            <Field label="予定終了">
              <input type="time" value={draft.plannedEndLabel} onChange={(event) => setDraft({ ...draft, plannedEndLabel: event.target.value })} />
            </Field>
            <Field label="状態">
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as TaskStatus })}>
                {Object.entries(taskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="補足指示">
              <textarea value={draft.instruction} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}
