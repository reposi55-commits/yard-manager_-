import { useEffect, useMemo, useState } from "react";
import { Card, DangerButton, EmptyState, Field, FormCheckPanel, Modal, PrimaryButton, SecondaryButton } from "../components/ui";
import { changeLoadingItemStatus, createEntity, createLoadingItem, softDeleteEntity, subscribeDaily, updateEntity } from "../services/firestoreService";
import type { AppUser, Lane, LoadingItem, LoadingItemStatus, Route, RouteLink, Task } from "../types";
import { buildLaneWorkSafetyIssue } from "../utils/loadingItemGuards";
import {
  buildLoadingItemImportPreviewRows,
  formatLoadingItemImportRoute,
  loadingItemImportTemplate,
  readLoadingItemCsv,
  withImportBatch,
  type LoadingItemImportEncoding,
  type LoadingItemImportPreviewRow,
} from "../utils/loadingItemImport";
import { downloadCsv } from "../utils/csv";
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
  const [routeLinks, setRouteLinks] = useState<RouteLink[]>([]);
  const [draft, setDraft] = useState(loadingItemDefaults);
  const [editing, setEditing] = useState<LoadingItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LoadingItemStatus>("all");
  const [activePanel, setActivePanel] = useState<"list" | "import">("list");
  const [csvEncoding, setCsvEncoding] = useState<LoadingItemImportEncoding>("utf-8");
  const [importRows, setImportRows] = useState<LoadingItemImportPreviewRow[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importSaving, setImportSaving] = useState(false);
  const { lanes } = useMasterOptions(user);

  useEffect(() => subscribeDaily("loadingItems", user.siteId, businessDate, setItems, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("tasks", user.siteId, businessDate, setTasks, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routeLinks", user.siteId, businessDate, setRouteLinks, setError), [user.siteId, businessDate]);

  const subRoutes = useMemo(() => routes.filter((route) => route.type === "sub"), [routes]);
  const mainRoutes = useMemo(() => routes.filter((route) => route.type === "main"), [routes]);
  const selectableLanes = useMemo(() => lanes.filter((lane) => lane.active || lane.id === draft.laneId), [draft.laneId, lanes]);
  const formIssues = useMemo(() => buildLoadingItemIssues(draft, subRoutes, mainRoutes, selectableLanes), [draft, mainRoutes, selectableLanes, subRoutes]);
  const importSummary = useMemo(() => summarizeImportRows(importRows), [importRows]);
  const canImport = importRows.length > 0 && importSummary.errors === 0 && importSummary.targets > 0 && !importSaving;

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

  function openImportPanel() {
    setActivePanel("import");
    setError("");
    setSuccess("");
  }

  function openListPanel() {
    setActivePanel("list");
    setError("");
    setSuccess("");
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
      setError(caught instanceof Error ? caught.message : "積み付け情報の保存に失敗しました。");
    }
  }

  async function remove(item: LoadingItem) {
    const label = buildItemLabel(item, routes);
    if (!window.confirm(`${label} を削除しますか？`)) return;
    await softDeleteEntity("loadingItems", item, user);
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setSuccess("");
    setImportRows([]);
    setImportFileName(file.name);
    try {
      const rows = await readLoadingItemCsv(file, csvEncoding);
      setImportRows(buildLoadingItemImportPreviewRows(rows, {
        siteId: user.siteId,
        businessDate,
        routes,
        lanes,
        routeLinks,
        loadingItems: items,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSVの読み込みに失敗しました。");
    }
  }

  function downloadImportTemplate() {
    downloadCsv("yardmanager-loading-items-import-template.csv", loadingItemImportTemplate);
  }

  async function executeImport() {
    if (!canImport) {
      setError(importSummary.errors > 0 ? "エラーがあるため取込できません。CSVを修正して再度プレビューしてください。" : "取込対象がありません。");
      return;
    }

    const importBatchId = createImportBatchId();
    const targetRows = importRows.filter((row) => row.payload && (row.action === "create" || row.action === "update"));
    setImportSaving(true);
    setError("");
    setSuccess("");
    try {
      for (const row of targetRows) {
        if (!row.payload) continue;
        const payload = withImportBatch(row.payload, importBatchId);
        if (row.action === "create") {
          await createEntity("loadingItems", payload, user, "import");
        } else if (row.action === "update" && row.existingItem) {
          await updateEntity("loadingItems", row.existingItem, payload, user, "import");
        }
      }
      setSuccess(`積み付け情報を${targetRows.length}件取り込みました。`);
      setImportRows([]);
      setImportFileName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "積み付け情報のCSV取込に失敗しました。");
    } finally {
      setImportSaving(false);
    }
  }

  return (
    <Card className="loading-items-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Loading Items</p>
          <h2>積み付け情報管理</h2>
        </div>
        <div className="form-actions">
          <SecondaryButton type="button" onClick={openImportPanel}>CSV取込</SecondaryButton>
          <PrimaryButton type="button" onClick={openCreateForm}>積み付け情報を追加</PrimaryButton>
        </div>
      </div>

      {error ? <p className="alert">{error}</p> : null}
      {success ? <p className="success-message">{success}</p> : null}
      <p className="helper-text">作業開始可否とレーン安全判定に使う積み付け情報を、サブ便・メイン便・レーン・仕入先・受入・オーダー単位で登録します。</p>

      <div className="template-mode-tabs loading-item-tabs" role="tablist" aria-label="積み付け情報表示切替">
        <button type="button" className={activePanel === "list" ? "active" : ""} onClick={openListPanel}>一覧・手動編集</button>
        <button type="button" className={activePanel === "import" ? "active" : ""} onClick={openImportPanel}>CSV取込</button>
      </div>

      {activePanel === "list" && items.length > 0 ? (
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

      {activePanel === "list" ? (
        <>
      {items.length === 0 ? <EmptyState message="この対象日の積み付け情報はまだありません。" /> : null}
      {items.length > 0 && filteredItems.length === 0 ? <EmptyState message="条件に一致する積み付け情報はありません。" /> : null}

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
        </>
      ) : (
        <LoadingItemImportPanel
          encoding={csvEncoding}
          fileName={importFileName}
          rows={importRows}
          summary={importSummary}
          canImport={canImport}
          saving={importSaving}
          onEncodingChange={setCsvEncoding}
          onFileChange={(file) => void handleImportFile(file)}
          onDownloadTemplate={downloadImportTemplate}
          onExecuteImport={() => void executeImport()}
        />
      )}

      {formOpen ? (
        <Modal
          title={editing ? "積み付け情報を編集" : "積み付け情報を追加"}
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

function LoadingItemImportPanel({
  encoding,
  fileName,
  rows,
  summary,
  canImport,
  saving,
  onEncodingChange,
  onFileChange,
  onDownloadTemplate,
  onExecuteImport,
}: {
  encoding: LoadingItemImportEncoding;
  fileName: string;
  rows: LoadingItemImportPreviewRow[];
  summary: ReturnType<typeof summarizeImportRows>;
  canImport: boolean;
  saving: boolean;
  onEncodingChange: (value: LoadingItemImportEncoding) => void;
  onFileChange: (file: File | undefined) => void;
  onDownloadTemplate: () => void;
  onExecuteImport: () => void;
}) {
  return (
    <section className="import-panel loading-item-import-panel">
      <div className="import-toolbar loading-item-import-toolbar">
        <Field label="文字コード">
          <select value={encoding} onChange={(event) => onEncodingChange(event.target.value as LoadingItemImportEncoding)}>
            <option value="utf-8">UTF-8</option>
            <option value="shift-jis">Shift-JIS</option>
          </select>
        </Field>
        <Field label="CSVファイル">
          <input type="file" accept=".csv,text/csv" onChange={(event) => onFileChange(event.target.files?.[0])} />
        </Field>
        <div className="form-actions import-actions">
          <SecondaryButton type="button" onClick={onDownloadTemplate}>テンプレートCSV</SecondaryButton>
          <PrimaryButton type="button" disabled={!canImport} onClick={onExecuteImport}>
            {saving ? "取込中..." : "取込実行"}
          </PrimaryButton>
        </div>
      </div>

      <p className="helper-text">
        {fileName ? `${fileName} のプレビューです。` : "CSVを選択すると取込前プレビューを表示します。エラーが1件でもある場合は保存できません。"}
      </p>

      <div className="import-summary">
        <ImportMetric label="CSV行" value={`${rows.length}件`} />
        <ImportMetric label="作成" value={`${summary.create}件`} />
        <ImportMetric label="更新" value={`${summary.update}件`} />
        <ImportMetric label="スキップ" value={`${summary.skip}件`} />
        <ImportMetric label="エラー" value={`${summary.errors}件`} />
      </div>

      {rows.length === 0 ? <EmptyState message="取込前プレビューはまだありません。" /> : null}
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="loading-item-import-table">
            <thead>
              <tr>
                <th>行番号</th>
                <th>判定</th>
                <th>サブ便</th>
                <th>メイン便</th>
                <th>レーン</th>
                <th>エラー</th>
                <th>警告</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.rowNumber}-${row.externalKey}`}>
                  <td>{row.rowNumber}</td>
                  <td><ImportActionBadge action={row.action} /></td>
                  <td>{formatLoadingItemImportRoute(row.subRoute)}</td>
                  <td>{formatLoadingItemImportRoute(row.mainRoute)}</td>
                  <td>{row.lane?.name || "-"}</td>
                  <td className="import-message-cell">{row.errors.length > 0 ? row.errors.join(" / ") : "-"}</td>
                  <td className="import-message-cell">{row.warnings.length > 0 ? row.warnings.join(" / ") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ImportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="import-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ImportActionBadge({ action }: { action: LoadingItemImportPreviewRow["action"] }) {
  const labels: Record<LoadingItemImportPreviewRow["action"], string> = {
    create: "作成",
    update: "更新",
    skip: "スキップ",
    error: "エラー",
  };
  const tone = action === "error" ? "error" : action === "skip" ? "skip" : "ok";
  return <span className={`import-row-status ${tone}`}>{labels[action]}</span>;
}

function summarizeImportRows(rows: LoadingItemImportPreviewRow[]) {
  return {
    create: rows.filter((row) => row.action === "create").length,
    update: rows.filter((row) => row.action === "update").length,
    skip: rows.filter((row) => row.action === "skip").length,
    errors: rows.filter((row) => row.action === "error").length,
    targets: rows.filter((row) => row.action === "create" || row.action === "update").length,
  };
}

function createImportBatchId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
