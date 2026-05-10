import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, Field, PrimaryButton } from "../components/ui";
import { createEntity, subscribeDaily } from "../services/firestoreService";
import type { AppUser, Lane, Route, RouteType, Task, Worker } from "../types";
import { labelToOffsetMin } from "../utils/date";
import { useMasterOptions } from "./MasterManagement";

type TemplateRoute = {
  key: string;
  type: RouteType;
  routeName: string;
  flightNumber: string;
  stationIndex: number;
  start: string;
  end: string;
};

type TemplateTask = {
  taskName: string;
  routeKey: string;
  workerIndex: number;
  laneIndex: number;
  start: string;
  end: string;
  instruction: string;
};

type TemplateDefinition = {
  id: string;
  name: string;
  description: string;
  routes: TemplateRoute[];
  tasks: TemplateTask[];
};

type TemplateGenerationResult = {
  templateName: string;
  routes: string[];
  tasks: string[];
};

const templates: TemplateDefinition[] = [
  {
    id: "morning-basic",
    name: "午前基本ダイヤ",
    description: "午前帯のメイン便3本と荷下ろしタスクを作成します。",
    routes: [
      { key: "m1", type: "main", routeName: "午前A便", flightNumber: "AM-001", stationIndex: 0, start: "08:00", end: "08:45" },
      { key: "m2", type: "main", routeName: "午前B便", flightNumber: "AM-002", stationIndex: 1, start: "09:00", end: "09:45" },
      { key: "m3", type: "main", routeName: "午前C便", flightNumber: "AM-003", stationIndex: 2, start: "10:00", end: "10:45" },
    ],
    tasks: [
      { taskName: "荷下ろし", routeKey: "m1", workerIndex: 0, laneIndex: 0, start: "08:05", end: "08:35", instruction: "到着確認後に開始" },
      { taskName: "仕分け", routeKey: "m2", workerIndex: 1, laneIndex: 1, start: "09:05", end: "09:35", instruction: "ラベル確認" },
      { taskName: "検品", routeKey: "m3", workerIndex: 2, laneIndex: 2, start: "10:05", end: "10:35", instruction: "数量差異を記録" },
    ],
  },
  {
    id: "day-standard",
    name: "日中標準ダイヤ",
    description: "午前から午後までのメイン便4本と基本タスクを作成します。",
    routes: [
      { key: "d1", type: "main", routeName: "日中A便", flightNumber: "DAY-001", stationIndex: 0, start: "08:30", end: "09:15" },
      { key: "d2", type: "main", routeName: "日中B便", flightNumber: "DAY-002", stationIndex: 1, start: "10:00", end: "10:45" },
      { key: "d3", type: "main", routeName: "日中C便", flightNumber: "DAY-003", stationIndex: 2, start: "13:00", end: "13:45" },
      { key: "d4", type: "main", routeName: "日中D便", flightNumber: "DAY-004", stationIndex: 3, start: "15:00", end: "15:45" },
    ],
    tasks: [
      { taskName: "荷下ろし", routeKey: "d1", workerIndex: 0, laneIndex: 0, start: "08:35", end: "09:05", instruction: "着車後に開始" },
      { taskName: "積込準備", routeKey: "d2", workerIndex: 1, laneIndex: 1, start: "10:05", end: "10:35", instruction: "必要資材を確認" },
      { taskName: "仕分け", routeKey: "d3", workerIndex: 2, laneIndex: 2, start: "13:05", end: "13:35", instruction: "行先別に仕分け" },
      { taskName: "検品", routeKey: "d4", workerIndex: 3, laneIndex: 3, start: "15:05", end: "15:35", instruction: "完了後に報告" },
    ],
  },
];

export function TemplateGenerationView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [selectedId, setSelectedId] = useState(templates[0].id);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [generationResult, setGenerationResult] = useState<TemplateGenerationResult | null>(null);
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const { stations, lanes, workers, error: masterError } = useMasterOptions(user);

  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("tasks", user.siteId, businessDate, setTasks, setError), [user.siteId, businessDate]);
  useEffect(() => setSafetyConfirmed(false), [businessDate, selectedId]);

  const activeStations = useMemo(() => stations.filter((station) => station.active), [stations]);
  const activeLanes = useMemo(() => lanes.filter((lane) => lane.active), [lanes]);
  const activeWorkers = useMemo(() => workers.filter((worker) => worker.active), [workers]);
  const selected = templates.find((template) => template.id === selectedId) || templates[0];
  const preview = useMemo(
    () => buildPreview(selected, activeStations, activeLanes, activeWorkers),
    [selected, activeStations, activeLanes, activeWorkers],
  );
  const validation = useMemo(
    () => validateTemplate(selected, routes, tasks, activeStations, activeLanes, activeWorkers),
    [selected, routes, tasks, activeStations, activeLanes, activeWorkers],
  );
  const generateBlockReason =
    validation.length > 0
      ? "生成前に確認が必要な内容があります。"
      : !safetyConfirmed
        ? "対象日・作成件数・既存データを上書きしないことを確認してください。"
        : "";
  const canGenerate = validation.length === 0 && safetyConfirmed && !saving;

  async function generate() {
    setError("");
    setSuccess("");
    setGenerationResult(null);
    if (!canGenerate) {
      setError(generateBlockReason || "生成前に確認が必要な内容があります。");
      return;
    }
    if (!window.confirm(`${selected.name}から便${selected.routes.length}件、タスク${selected.tasks.length}件を新規作成します。既存データは上書きしません。よろしいですか？`)) return;

    setSaving(true);
    try {
      const routeIdByKey = new Map<string, Route>();
      const createdRouteLabels: string[] = [];
      const createdTaskLabels: string[] = [];
      for (const routeTemplate of selected.routes) {
        const station = pickByIndex(activeStations, routeTemplate.stationIndex);
        const routeId = await createEntity("routes", {
          type: routeTemplate.type,
          routeName: routeTemplate.routeName,
          flightNumber: routeTemplate.flightNumber,
          stationId: station.id,
          stationName: station.name,
          plannedStartLabel: routeTemplate.start,
          plannedEndLabel: routeTemplate.end,
          plannedStartOffsetMin: labelToOffsetMin(routeTemplate.start),
          plannedEndOffsetMin: labelToOffsetMin(routeTemplate.end),
          status: "waiting",
          siteId: user.siteId,
          businessDate,
        }, user);
        routeIdByKey.set(routeTemplate.key, {
          id: routeId,
          type: routeTemplate.type,
          routeName: routeTemplate.routeName,
          flightNumber: routeTemplate.flightNumber,
          stationId: station.id,
          stationName: station.name,
          plannedStartLabel: routeTemplate.start,
          plannedEndLabel: routeTemplate.end,
          plannedStartOffsetMin: labelToOffsetMin(routeTemplate.start),
          plannedEndOffsetMin: labelToOffsetMin(routeTemplate.end),
          status: "waiting",
          siteId: user.siteId,
          businessDate,
          createdAt: null,
          createdBy: user.id,
          updatedAt: null,
          updatedBy: user.id,
        });
        createdRouteLabels.push(`${routeTemplate.routeName} / ${routeTemplate.flightNumber}`);
      }

      for (const taskTemplate of selected.tasks) {
        const route = routeIdByKey.get(taskTemplate.routeKey);
        const worker = pickByIndex(activeWorkers, taskTemplate.workerIndex);
        const lane = pickByIndex(activeLanes, taskTemplate.laneIndex);
        if (!route) throw new Error(`対象便が見つかりません: ${taskTemplate.routeKey}`);
        await createEntity("tasks", {
          taskName: taskTemplate.taskName,
          workerId: worker.id,
          workerName: worker.displayName || worker.name,
          laneId: lane.id,
          laneName: lane.name,
          targetMainRouteId: route.id,
          targetMainRouteName: route.routeName,
          targetMainFlightNumber: route.flightNumber,
          instruction: taskTemplate.instruction,
          plannedStartLabel: taskTemplate.start,
          plannedEndLabel: taskTemplate.end,
          plannedStartOffsetMin: labelToOffsetMin(taskTemplate.start),
          plannedEndOffsetMin: labelToOffsetMin(taskTemplate.end),
          status: "pending",
          siteId: user.siteId,
          businessDate,
        }, user);
        createdTaskLabels.push(`${taskTemplate.taskName} / ${worker.displayName || worker.name} / ${route.flightNumber}`);
      }
      setSuccess(`${selected.name}を作成しました。便${selected.routes.length}件、タスク${selected.tasks.length}件を追加しています。`);
      setGenerationResult({
        templateName: selected.name,
        routes: createdRouteLabels,
        tasks: createdTaskLabels,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "テンプレート生成に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Template</p>
          <h2>ダイヤテンプレート</h2>
        </div>
      </div>
      <p className="helper-text">
        よく使う便・タスクの組み合わせを、対象日にまとめて新規作成します。既存データは上書きしません。
      </p>
      {masterError ? <p className="alert">{masterError}</p> : null}
      {error ? <p className="alert">{error}</p> : null}
      {success ? <p className="success-message">{success}</p> : null}

      <div className="template-toolbar">
        <Field label="テンプレート">
          <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setSuccess(""); setError(""); setGenerationResult(null); setSafetyConfirmed(false); }}>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </Field>
        <PrimaryButton type="button" onClick={() => void generate()} disabled={!canGenerate} title={generateBlockReason}>
          {saving ? "作成中..." : "テンプレート作成"}
        </PrimaryButton>
      </div>

      <section className="template-summary">
        <div>
          <span>内容</span>
          <strong>{selected.description}</strong>
        </div>
        <div>
          <span>作成件数</span>
          <strong>便 {selected.routes.length}件 / タスク {selected.tasks.length}件</strong>
        </div>
      </section>

      <section className={`form-check-panel ${validation.length === 0 ? "warning" : "error"}`}>
        <strong>作成前の最終確認</strong>
        <p>
          対象日 {businessDate} に便{selected.routes.length}件、タスク{selected.tasks.length}件を新規作成します。
          既存データは上書きしません。
        </p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={safetyConfirmed}
            disabled={validation.length > 0}
            onChange={(event) => setSafetyConfirmed(event.target.checked)}
          />
          対象日・作成件数・警告内容を確認しました
        </label>
      </section>

      {validation.length > 0 ? (
        <section className="template-panel">
          <h3>生成前に確認が必要です</h3>
          <ul className="template-alert-list">
            {validation.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      {generationResult ? (
        <section className="template-panel template-result">
          <div className="template-result-header">
            <h3>作成結果</h3>
            <span>{generationResult.templateName}</span>
          </div>
          <div className="template-result-grid">
            <div>
              <strong>便 {generationResult.routes.length}件</strong>
              <ul>
                {generationResult.routes.map((label) => <li key={label}>{label}</li>)}
              </ul>
            </div>
            <div>
              <strong>タスク {generationResult.tasks.length}件</strong>
              <ul>
                {generationResult.tasks.map((label) => <li key={label}>{label}</li>)}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <div className="template-grid">
        <section className="template-panel">
          <h3>作成予定の便</h3>
          {preview.routes.length === 0 ? <EmptyState message="作成予定の便はありません。" /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>便</th>
                    <th>便番号</th>
                    <th>ステーション</th>
                    <th>予定</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.routes.map((route) => (
                    <tr key={route.flightNumber}>
                      <td>{route.routeName}</td>
                      <td>{route.flightNumber}</td>
                      <td>{route.stationName}</td>
                      <td>{route.start} - {route.end}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="template-panel">
          <h3>作成予定のタスク</h3>
          {preview.tasks.length === 0 ? <EmptyState message="作成予定のタスクはありません。" /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>タスク</th>
                    <th>作業員</th>
                    <th>レーン</th>
                    <th>対象便</th>
                    <th>予定</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.tasks.map((task, index) => (
                    <tr key={`${task.taskName}-${index}`}>
                      <td>{task.taskName}</td>
                      <td>{task.workerName}</td>
                      <td>{task.laneName}</td>
                      <td>{task.routeName}</td>
                      <td>{task.start} - {task.end}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}

function validateTemplate(
  template: TemplateDefinition,
  routes: Route[],
  tasks: Task[],
  activeStations: { id: string; name: string }[],
  lanes: Lane[],
  workers: Worker[],
): string[] {
  const issues: string[] = [];
  if (activeStations.length === 0) issues.push("有効なステーションが必要です。");
  if (lanes.length === 0) issues.push("有効なレーンが必要です。");
  if (workers.length === 0) issues.push("有効な作業員が必要です。");
  template.routes.forEach((route) => {
    if (routes.some((item) => item.flightNumber === route.flightNumber)) {
      issues.push(`同じ対象日の便番号が既にあります: ${route.flightNumber}`);
    }
    if (activeStations.length > 0) {
      const station = pickByIndex(activeStations, route.stationIndex);
      if (routes.some((item) => item.stationId === station.id && overlaps(route.start, route.end, item.plannedStartLabel, item.plannedEndLabel))) {
        issues.push(`同じステーションの予定時間が既存便と重なっています: ${station.name} / ${route.start}-${route.end}`);
      }
    }
  });
  template.tasks.forEach((task) => {
    const route = template.routes.find((item) => item.key === task.routeKey);
    if (!route) issues.push(`タスクの対象便がテンプレート内にありません: ${task.taskName}`);
    if (route && tasks.some((item) => item.targetMainFlightNumber === route.flightNumber && item.taskName === task.taskName)) {
      issues.push(`同じ対象便に同名タスクが既にあります: ${route.flightNumber} / ${task.taskName}`);
    }
    if (workers.length > 0) {
      const worker = pickByIndex(workers, task.workerIndex);
      if (tasks.some((item) => item.workerId === worker.id && overlaps(task.start, task.end, item.plannedStartLabel, item.plannedEndLabel))) {
        issues.push(`同じ作業員の予定時間が既存タスクと重なっています: ${worker.displayName || worker.name} / ${task.start}-${task.end}`);
      }
      if (template.tasks.some((item) => item !== task && pickByIndex(workers, item.workerIndex).id === worker.id && overlaps(task.start, task.end, item.start, item.end))) {
        issues.push(`テンプレート内で同じ作業員の予定時間が重なっています: ${worker.displayName || worker.name}`);
      }
    }
    if (lanes.length > 0) {
      const lane = pickByIndex(lanes, task.laneIndex);
      if (tasks.some((item) => item.laneId === lane.id && overlaps(task.start, task.end, item.plannedStartLabel, item.plannedEndLabel))) {
        issues.push(`同じレーンの予定時間が既存タスクと重なっています: ${lane.name} / ${task.start}-${task.end}`);
      }
      if (template.tasks.some((item) => item !== task && pickByIndex(lanes, item.laneIndex).id === lane.id && overlaps(task.start, task.end, item.start, item.end))) {
        issues.push(`テンプレート内で同じレーンの予定時間が重なっています: ${lane.name}`);
      }
    }
  });
  return [...new Set(issues)];
}

function buildPreview(template: TemplateDefinition, stations: { name: string }[], lanes: Lane[], workers: Worker[]) {
  return {
    routes: template.routes.map((route) => ({
      ...route,
      stationName: stations.length > 0 ? pickByIndex(stations, route.stationIndex).name : "未設定",
    })),
    tasks: template.tasks.map((task) => {
      const route = template.routes.find((item) => item.key === task.routeKey);
      const worker = workers.length > 0 ? pickByIndex(workers, task.workerIndex) : null;
      const lane = lanes.length > 0 ? pickByIndex(lanes, task.laneIndex) : null;
      return {
        ...task,
        routeName: route ? `${route.routeName} / ${route.flightNumber}` : "未設定",
        workerName: worker ? worker.displayName || worker.name : "未設定",
        laneName: lane ? lane.name : "未設定",
      };
    }),
  };
}

function pickByIndex<T>(items: T[], index: number): T {
  if (items.length === 0) throw new Error("必要なマスタが登録されていません。");
  return items[index % items.length];
}

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  const startAMin = labelToOffsetMin(startA);
  const endAMin = labelToOffsetMin(endA);
  const startBMin = labelToOffsetMin(startB);
  const endBMin = labelToOffsetMin(endB);
  return startAMin < endBMin && startBMin < endAMin;
}
