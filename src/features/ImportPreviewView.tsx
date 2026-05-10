import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, Field, PrimaryButton, SecondaryButton } from "../components/ui";
import { createEntity, subscribeDaily } from "../services/firestoreService";
import type { AppUser, Lane, Route, RouteStatus, RouteType, Station, Task, TaskStatus, Worker } from "../types";
import { downloadCsv, parseCsv, type ParsedCsvRow } from "../utils/csv";
import { labelToOffsetMin } from "../utils/date";
import { useMasterOptions } from "./MasterManagement";

type ImportKind = "routes" | "tasks";
type ImportMode = "strict" | "skipExisting";

type ValidationResult = {
  rowNumber: number;
  errors: string[];
};

type SkippedRow = {
  rowNumber: number;
  reason: string;
  label: string;
};

type ImportResult = {
  kind: ImportKind;
  count: number;
  labels: string[];
};

type CreatePayload<T> = Omit<T, "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "deleted" | "deletedAt" | "deletedBy">;
type RoutePayload = CreatePayload<Route>;
type TaskPayload = CreatePayload<Task>;

const routeStatuses: RouteStatus[] = ["waiting", "in_progress", "completed"];
const taskStatuses: TaskStatus[] = ["pending", "ready", "in_progress", "completed"];

const routeTemplate = [
  {
    種別: "main",
    便名: "A便",
    便番号: "A-001",
    ステーション名: "北ヤード1番",
    予定開始: "08:00",
    予定終了: "09:00",
    状態: "waiting",
  },
];

const taskTemplate = [
  {
    タスク: "荷下ろし",
    作業員名: "青木",
    レーン名: "A-01",
    対象便名: "A便",
    対象便番号: "A-001",
    予定開始: "08:30",
    予定終了: "09:00",
    状態: "pending",
    補足指示: "安全確認後に開始",
  },
];

const requiredColumns: Record<ImportKind, string[]> = {
  routes: ["種別", "便名", "便番号", "ステーション名", "予定開始", "予定終了"],
  tasks: ["タスク", "作業員名", "レーン名", "対象便名", "対象便番号", "予定開始", "予定終了"],
};

export function ImportPreviewView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [kind, setKind] = useState<ImportKind>("routes");
  const [importMode, setImportMode] = useState<ImportMode>("strict");
  const [rows, setRows] = useState<ParsedCsvRow[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const { stations, lanes, workers, error: masterError } = useMasterOptions(user);

  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("tasks", user.siteId, businessDate, setTasks, setError), [user.siteId, businessDate]);

  const headers = useMemo(() => Object.keys(rows[0] || {}), [rows]);
  const missingColumns = useMemo(
    () => (rows.length === 0 ? [] : requiredColumns[kind].filter((column) => !headers.includes(column))),
    [headers, kind, rows.length],
  );
  const skippedRows = useMemo(
    () => (importMode === "skipExisting" ? findSkippedRows(kind, rows, { routes, tasks }) : []),
    [importMode, kind, rows, routes, tasks],
  );
  const skippedByRow = useMemo(() => new Map(skippedRows.map((row) => [row.rowNumber, row])), [skippedRows]);
  const skippedRowNumbers = useMemo(() => new Set(skippedRows.map((row) => row.rowNumber)), [skippedRows]);
  const validation = useMemo(
    () => validateRows(kind, rows, { routes, tasks, stations, lanes, workers }).filter((item) => !skippedRowNumbers.has(item.rowNumber)),
    [kind, rows, routes, tasks, stations, lanes, workers, skippedRowNumbers],
  );
  const validationByRow = useMemo(() => new Map(validation.map((item) => [item.rowNumber, item])), [validation]);
  const importableRows = useMemo(
    () =>
      missingColumns.length > 0
        ? []
        : rows.filter((_, index) => !skippedRowNumbers.has(index + 2) && !validation.some((item) => item.rowNumber === index + 2)),
    [missingColumns.length, rows, skippedRowNumbers, validation],
  );
  const validRowCount = importableRows.length;
  const issueCount = validation.length + missingColumns.length;
  const canImport = rows.length > 0 && validRowCount > 0 && issueCount === 0 && !saving;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setSuccess("");
    setImportResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      setRows(parseCsv(text));
    } catch (caught) {
      setRows([]);
      setError(caught instanceof Error ? caught.message : "CSVの読み込みに失敗しました。");
    }
  }

  function downloadTemplate() {
    if (kind === "routes") {
      downloadCsv("yardmanager-import-routes-template.csv", routeTemplate);
    } else {
      downloadCsv("yardmanager-import-tasks-template.csv", taskTemplate);
    }
  }

  function downloadErrorRows() {
    const errorRows = validation.map((item) => ({
      行: item.rowNumber,
      エラー: item.errors.join(" / "),
      ...rows[item.rowNumber - 2],
    }));
    downloadCsv(`yardmanager-import-errors-${kind}-${businessDate}.csv`, errorRows);
  }

  function downloadSkippedRows() {
    const skippedCsvRows = skippedRows.map((item) => ({
      行: item.rowNumber,
      理由: item.reason,
      内容: item.label,
      ...rows[item.rowNumber - 2],
    }));
    downloadCsv(`yardmanager-import-skipped-${kind}-${businessDate}.csv`, skippedCsvRows);
  }

  async function importRows() {
    setError("");
    setSuccess("");
    setImportResult(null);
    if (!canImport) {
      setError("取込前に修正が必要な行があります。");
      return;
    }
    const targetLabel = kind === "routes" ? "便" : "タスク";
    const skipText = skippedRows.length > 0 ? `（既存${skippedRows.length}件をスキップ）` : "";
    if (!window.confirm(`${targetLabel}を${validRowCount}件、新規登録します${skipText}。既存データは上書きしません。よろしいですか？`)) return;

    setSaving(true);
    try {
      if (kind === "routes") {
        const payloads = importableRows.map((row) => buildRoutePayload(row, stations, user, businessDate));
        for (const payload of payloads) {
          await createEntity("routes", payload, user);
        }
        setImportResult({
          kind,
          count: payloads.length,
          labels: payloads.map((payload) => `${payload.routeName} / ${payload.flightNumber}`),
        });
      } else {
        const payloads = importableRows.map((row) => buildTaskPayload(row, routes, workers, lanes, user, businessDate));
        for (const payload of payloads) {
          await createEntity("tasks", payload, user);
        }
        setImportResult({
          kind,
          count: payloads.length,
          labels: payloads.map((payload) => `${payload.taskName} / ${payload.workerName} / ${payload.targetMainFlightNumber}`),
        });
      }
      setSuccess(`${targetLabel}を${validRowCount}件登録しました${skippedRows.length > 0 ? `。既存${skippedRows.length}件はスキップしました` : ""}。`);
      reset(false, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSV取込に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  function reset(clearSuccess = true, clearResult = true) {
    setRows([]);
    setFileName("");
    setError("");
    if (clearSuccess) setSuccess("");
    if (clearResult) setImportResult(null);
  }

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Import Preview</p>
          <h2>CSV取込プレビュー</h2>
        </div>
      </div>
      <p className="helper-text">
        CSVを読み込んで、登録前に必須項目・マスタ一致・重複を確認します。登録は新規追加のみで、既存データは上書きしません。
      </p>
      {masterError ? <p className="alert">{masterError}</p> : null}
      {error ? <p className="alert">{error}</p> : null}
      {success ? <p className="success-message">{success}</p> : null}

      <div className="import-toolbar">
        <Field label="取込対象">
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ImportKind);
              reset();
              setSuccess("");
            }}
          >
            <option value="routes">便</option>
            <option value="tasks">タスク</option>
          </select>
        </Field>
        <Field label="取込モード">
          <select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}>
            <option value="strict">すべて新規として確認</option>
            <option value="skipExisting">既存はスキップ</option>
          </select>
        </Field>
        <Field label="CSVファイル">
          <input type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event.target.files?.[0])} />
        </Field>
        <div className="form-actions import-actions">
          <SecondaryButton type="button" onClick={downloadTemplate}>
            テンプレート出力
          </SecondaryButton>
          <SecondaryButton type="button" onClick={() => reset()} disabled={!fileName && rows.length === 0}>
            クリア
          </SecondaryButton>
          <PrimaryButton type="button" onClick={() => void importRows()} disabled={!canImport}>
            {saving ? "登録中..." : "新規登録"}
          </PrimaryButton>
        </div>
      </div>

      <div className="import-summary">
        <Metric label="ファイル" value={fileName || "-"} />
        <Metric label="行数" value={`${rows.length}件`} />
        <Metric label="登録可能" value={`${validRowCount}件`} />
        <Metric label="スキップ" value={`${skippedRows.length}件`} />
        <Metric label="要修正" value={`${issueCount}件`} />
      </div>

      {missingColumns.length > 0 ? <p className="alert">不足している列: {missingColumns.join("、")}</p> : null}
      {skippedRows.length > 0 ? (
        <section className="import-panel">
          <div className="import-panel-header">
            <h3>スキップ予定の行</h3>
            <SecondaryButton type="button" onClick={downloadSkippedRows}>
              スキップ行CSV出力
            </SecondaryButton>
          </div>
          <p className="helper-text">既に登録済みのため、上書きせずに取込対象から外します。</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  <th>内容</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {skippedRows.map((item) => (
                  <tr key={`${item.rowNumber}-${item.label}`}>
                    <td>{item.rowNumber}</td>
                    <td>{item.label}</td>
                    <td>{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {importResult ? (
        <section className="import-panel import-result">
          <div className="import-panel-header">
            <h3>取込結果</h3>
            <span className="import-result-count">
              {importResult.kind === "routes" ? "便" : "タスク"} {importResult.count}件
            </span>
          </div>
          <ul className="import-result-list">
            {importResult.labels.slice(0, 20).map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          {importResult.labels.length > 20 ? <p className="helper-text">先頭20件のみ表示しています。</p> : null}
        </section>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState message="CSVを選択すると、ここに取込前のプレビューが表示されます。" />
      ) : null}

      {validation.length > 0 ? (
        <section className="import-panel">
          <div className="import-panel-header">
            <h3>修正が必要な行</h3>
            <SecondaryButton type="button" onClick={downloadErrorRows}>
              エラー行CSV出力
            </SecondaryButton>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {validation.map((item) => (
                  <tr key={item.rowNumber}>
                    <td>{item.rowNumber}</td>
                    <td>{item.errors.join(" / ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <section className="import-panel">
          <h3>プレビュー</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>判定</th>
                  {headers.map((header) => <th key={header}>{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((row, index) => {
                  const rowNumber = index + 2;
                  const previewStatus = getPreviewStatus(rowNumber, validationByRow, skippedByRow, missingColumns.length > 0);
                  return (
                    <tr key={`${fileName}-${index}`}>
                      <td>
                        <span className={`import-row-status ${previewStatus.tone}`}>{previewStatus.label}</span>
                      </td>
                      {headers.map((header) => <td key={header}>{row[header] || "-"}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 20 ? <p className="helper-text">先頭20件のみ表示しています。</p> : null}
        </section>
      ) : null}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="import-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getPreviewStatus(
  rowNumber: number,
  validationByRow: Map<number, ValidationResult>,
  skippedByRow: Map<number, SkippedRow>,
  hasMissingColumns: boolean,
): { label: string; tone: "ok" | "skip" | "error" } {
  if (hasMissingColumns || validationByRow.has(rowNumber)) return { label: "要修正", tone: "error" };
  if (skippedByRow.has(rowNumber)) return { label: "スキップ", tone: "skip" };
  return { label: "登録予定", tone: "ok" };
}

function findSkippedRows(
  kind: ImportKind,
  rows: ParsedCsvRow[],
  context: { routes: Route[]; tasks: Task[] },
): SkippedRow[] {
  return rows
    .map((row, index): SkippedRow | null => {
      if (kind === "routes") {
        const flightNumber = normalize(row["便番号"]);
        const routeName = normalize(row["便名"]);
        const existing = flightNumber ? context.routes.find((route) => route.flightNumber === flightNumber) : undefined;
        return existing
          ? {
              rowNumber: index + 2,
              reason: "同じ対象日の便番号が既にあります",
              label: [routeName || existing.routeName, flightNumber].filter(Boolean).join(" / "),
            }
          : null;
      }

      const taskName = normalize(row["タスク"]);
      const targetRouteName = normalize(row["対象便名"]);
      const targetFlightNumber = normalize(row["対象便番号"]);
      const route = targetFlightNumber ? findTargetMainRoute(context.routes, targetFlightNumber, targetRouteName) : undefined;
      const existing = route && taskName ? context.tasks.find((task) => task.targetMainRouteId === route.id && task.taskName === taskName) : undefined;
      return existing
        ? {
            rowNumber: index + 2,
            reason: "同じ対象便に同名タスクが既にあります",
            label: [taskName, targetFlightNumber].filter(Boolean).join(" / "),
          }
        : null;
    })
    .filter((item): item is SkippedRow => item !== null);
}

function validateRows(
  kind: ImportKind,
  rows: ParsedCsvRow[],
  context: { routes: Route[]; tasks: Task[]; stations: Station[]; lanes: Lane[]; workers: Worker[] },
): ValidationResult[] {
  const required = requiredColumns[kind];
  const routeFlightCounts = countValues(rows.map((row) => normalize(row["便番号"])));
  const taskCounts = countValues(rows.map((row) => `${normalize(row["対象便番号"])}::${normalize(row["タスク"])}`));

  return rows
    .map((row, index) => {
      const errors: string[] = [];
      required.forEach((column) => {
        if (!normalize(row[column])) errors.push(`${column}が空です`);
      });

      const start = normalize(row["予定開始"]);
      const end = normalize(row["予定終了"]);
      const status = normalize(row["状態"]);

      if (start && !isTimeLabel(start)) errors.push("予定開始はHH:mmで入力してください");
      if (end && !isTimeLabel(end)) errors.push("予定終了はHH:mmで入力してください");
      if (start && end && isTimeLabel(start) && isTimeLabel(end) && labelToOffsetMin(end) <= labelToOffsetMin(start)) {
        errors.push("予定終了は予定開始より後にしてください");
      }
      if (status && !validStatus(kind, status)) errors.push("状態の値が正しくありません");

      if (kind === "routes") {
        validateRouteRow(row, context.routes, context.stations, routeFlightCounts, rows, index, errors);
      } else {
        validateTaskRow(row, context.routes, context.tasks, context.workers, context.lanes, taskCounts, rows, index, errors);
      }

      return { rowNumber: index + 2, errors };
    })
    .filter((item) => item.errors.length > 0);
}

function validateRouteRow(
  row: ParsedCsvRow,
  routes: Route[],
  stations: Station[],
  routeFlightCounts: Map<string, number>,
  rows: ParsedCsvRow[],
  rowIndex: number,
  errors: string[],
) {
  const type = normalize(row["種別"]);
  const flightNumber = normalize(row["便番号"]);
  const stationName = normalize(row["ステーション名"]);

  if (type && !["main", "sub"].includes(type)) errors.push("種別はmainまたはsubにしてください");
  if (flightNumber && routes.some((route) => route.flightNumber === flightNumber)) {
    errors.push("同じ対象日の便番号が既にあります");
  }
  if (flightNumber && (routeFlightCounts.get(flightNumber) || 0) > 1) {
    errors.push("CSV内で便番号が重複しています");
  }
  if (stationName && !findActiveStation(stations, stationName)) {
    errors.push("ステーション名がマスタにありません");
  }
  if (stationName && startEndAreValid(row)) {
    const overlapRow = findCsvOverlap(rows, rowIndex, "ステーション名", stationName, normalize(row["予定開始"]), normalize(row["予定終了"]));
    if (overlapRow) errors.push(`CSV内で同じステーションの予定時間が重なっています（${overlapRow}行目）`);
  }
}

function validateTaskRow(
  row: ParsedCsvRow,
  routes: Route[],
  tasks: Task[],
  workers: Worker[],
  lanes: Lane[],
  taskCounts: Map<string, number>,
  rows: ParsedCsvRow[],
  rowIndex: number,
  errors: string[],
) {
  const taskName = normalize(row["タスク"]);
  const workerName = normalize(row["作業員名"]);
  const laneName = normalize(row["レーン名"]);
  const targetRouteName = normalize(row["対象便名"]);
  const targetFlightNumber = normalize(row["対象便番号"]);
  const start = normalize(row["予定開始"]);
  const end = normalize(row["予定終了"]);
  const worker = workerName ? findActiveWorker(workers, workerName) : undefined;
  const lane = laneName ? findActiveLane(lanes, laneName) : undefined;
  const route = targetFlightNumber ? findTargetMainRoute(routes, targetFlightNumber, targetRouteName) : undefined;

  if (workerName && !worker) errors.push("作業員名がマスタにありません");
  if (laneName && !lane) errors.push("レーン名がマスタにありません");
  if (targetFlightNumber && !route) errors.push("対象便番号に一致するメイン便がありません");
  if (targetFlightNumber && targetRouteName && route && route.routeName !== targetRouteName) {
    errors.push("対象便名と対象便番号の組み合わせが一致しません");
  }
  if (targetFlightNumber && taskName && (taskCounts.get(`${targetFlightNumber}::${taskName}`) || 0) > 1) {
    errors.push("CSV内で同じ対象便・同じタスクが重複しています");
  }
  if (route && taskName && tasks.some((task) => task.targetMainRouteId === route.id && task.taskName === taskName)) {
    errors.push("同じ対象便に同名タスクが既にあります");
  }
  if (worker && start && end && isTimeLabel(start) && isTimeLabel(end) && hasOverlap(tasks, "workerId", worker.id, start, end)) {
    errors.push("同じ作業員の予定時間が既存タスクと重なっています");
  }
  if (lane && start && end && isTimeLabel(start) && isTimeLabel(end) && hasOverlap(tasks, "laneId", lane.id, start, end)) {
    errors.push("同じレーンの予定時間が既存タスクと重なっています");
  }
  if (workerName && startEndAreValid(row)) {
    const overlapRow = findCsvOverlap(rows, rowIndex, "作業員名", workerName, start, end);
    if (overlapRow) errors.push(`CSV内で同じ作業員の予定時間が重なっています（${overlapRow}行目）`);
  }
  if (laneName && startEndAreValid(row)) {
    const overlapRow = findCsvOverlap(rows, rowIndex, "レーン名", laneName, start, end);
    if (overlapRow) errors.push(`CSV内で同じレーンの予定時間が重なっています（${overlapRow}行目）`);
  }
}

function buildRoutePayload(row: ParsedCsvRow, stations: Station[], user: AppUser, businessDate: string): RoutePayload {
  const stationName = normalize(row["ステーション名"]);
  const station = findActiveStation(stations, stationName);
  if (!station) throw new Error(`ステーションが見つかりません: ${stationName}`);
  const type = normalize(row["種別"]) as RouteType;
  const status = normalize(row["状態"]);
  const plannedStartLabel = normalize(row["予定開始"]);
  const plannedEndLabel = normalize(row["予定終了"]);

  return {
    type,
    routeName: normalize(row["便名"]),
    flightNumber: normalize(row["便番号"]),
    stationId: station.id,
    stationName: station.name,
    plannedStartLabel,
    plannedEndLabel,
    plannedStartOffsetMin: labelToOffsetMin(plannedStartLabel),
    plannedEndOffsetMin: labelToOffsetMin(plannedEndLabel),
    status: isRouteStatus(status) ? status : "waiting",
    siteId: user.siteId,
    businessDate,
  };
}

function buildTaskPayload(
  row: ParsedCsvRow,
  routes: Route[],
  workers: Worker[],
  lanes: Lane[],
  user: AppUser,
  businessDate: string,
): TaskPayload {
  const workerName = normalize(row["作業員名"]);
  const laneName = normalize(row["レーン名"]);
  const targetRouteName = normalize(row["対象便名"]);
  const targetFlightNumber = normalize(row["対象便番号"]);
  const worker = findActiveWorker(workers, workerName);
  const lane = findActiveLane(lanes, laneName);
  const route = findTargetMainRoute(routes, targetFlightNumber, targetRouteName);
  if (!worker) throw new Error(`作業員が見つかりません: ${workerName}`);
  if (!lane) throw new Error(`レーンが見つかりません: ${laneName}`);
  if (!route) throw new Error(`対象便が見つかりません: ${targetFlightNumber}`);

  const status = normalize(row["状態"]);
  const plannedStartLabel = normalize(row["予定開始"]);
  const plannedEndLabel = normalize(row["予定終了"]);

  return {
    taskName: normalize(row["タスク"]),
    workerId: worker.id,
    workerName: worker.displayName || worker.name,
    laneId: lane.id,
    laneName: lane.name,
    targetMainRouteId: route.id,
    targetMainRouteName: route.routeName,
    targetMainFlightNumber: route.flightNumber,
    instruction: normalize(row["補足指示"]),
    plannedStartLabel,
    plannedEndLabel,
    plannedStartOffsetMin: labelToOffsetMin(plannedStartLabel),
    plannedEndOffsetMin: labelToOffsetMin(plannedEndLabel),
    status: isTaskStatus(status) ? status : "pending",
    siteId: user.siteId,
    businessDate,
  };
}

function normalize(value: string | undefined): string {
  return (value || "").trim();
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return counts;
}

function findActiveStation(stations: Station[], name: string): Station | undefined {
  return stations.find((station) => station.active && station.name === name);
}

function findActiveWorker(workers: Worker[], name: string): Worker | undefined {
  return workers.find((worker) => worker.active && (worker.displayName === name || worker.name === name));
}

function findActiveLane(lanes: Lane[], name: string): Lane | undefined {
  return lanes.find((lane) => lane.active && lane.name === name);
}

function findTargetMainRoute(routes: Route[], flightNumber: string, routeName: string): Route | undefined {
  const matches = routes.filter((route) => route.type === "main" && route.flightNumber === flightNumber);
  if (routeName) return matches.find((route) => route.routeName === routeName);
  return matches.length === 1 ? matches[0] : undefined;
}

function hasOverlap(tasks: Task[], field: "workerId" | "laneId", id: string, start: string, end: string): boolean {
  const startOffset = labelToOffsetMin(start);
  const endOffset = labelToOffsetMin(end);
  return tasks.some(
    (task) =>
      task[field] === id &&
      rangesOverlap(startOffset, endOffset, task.plannedStartOffsetMin, task.plannedEndOffsetMin),
  );
}

function findCsvOverlap(
  rows: ParsedCsvRow[],
  currentIndex: number,
  column: string,
  value: string,
  start: string,
  end: string,
): number | null {
  const startOffset = labelToOffsetMin(start);
  const endOffset = labelToOffsetMin(end);
  const matchIndex = rows.findIndex((row, index) => {
    if (index === currentIndex || normalize(row[column]) !== value) return false;
    const otherStart = normalize(row["予定開始"]);
    const otherEnd = normalize(row["予定終了"]);
    if (!isTimeLabel(otherStart) || !isTimeLabel(otherEnd)) return false;
    return rangesOverlap(startOffset, endOffset, labelToOffsetMin(otherStart), labelToOffsetMin(otherEnd));
  });
  return matchIndex >= 0 ? matchIndex + 2 : null;
}

function startEndAreValid(row: ParsedCsvRow): boolean {
  const start = normalize(row["予定開始"]);
  const end = normalize(row["予定終了"]);
  return isTimeLabel(start) && isTimeLabel(end) && labelToOffsetMin(end) > labelToOffsetMin(start);
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function isTimeLabel(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isRouteStatus(value: string): value is RouteStatus {
  return routeStatuses.includes(value as RouteStatus);
}

function isTaskStatus(value: string): value is TaskStatus {
  return taskStatuses.includes(value as TaskStatus);
}

function validStatus(kind: ImportKind, value: string): boolean {
  return kind === "routes" ? isRouteStatus(value) : isTaskStatus(value);
}
