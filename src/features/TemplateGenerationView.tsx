import { useEffect, useMemo, useState } from "react";
import { where } from "firebase/firestore";
import { Card, EmptyState, Field, Modal, PrimaryButton, SecondaryButton } from "../components/ui";
import { createEntity, fetchCollectionOnce, softDeleteEntity, subscribeCollection, updateEntity } from "../services/firestoreService";
import type {
  AppUser,
  DialTemplate,
  DialTemplateRoute,
  DialTemplateTask,
  Lane,
  Route,
  RouteType,
  Task,
  Worker,
} from "../types";
import { MASTER_BUSINESS_DATE } from "../lib/firebase";
import { downloadCsv, parseCsv, type ParsedCsvRow } from "../utils/csv";
import { labelToOffsetMin, toDateInputValue } from "../utils/date";
import { useMasterOptions } from "./MasterManagement";

type TemplateMode = "create" | "manage";
type BatchMode = "create" | "recreate" | "delete";
type TemplateDraft = Pick<DialTemplate, "name" | "description" | "active" | "routes" | "tasks">;
type TemplateImportItem = {
  name: string;
  draft: TemplateDraft;
  sourceRows: number[];
  status: "ready" | "skip" | "error";
  issues: string[];
};
type TemplatePlan = {
  days: string[];
  existingRoutes: Route[];
  existingTasks: Task[];
  protectedRoutes: Route[];
  protectedTasks: Task[];
  issues: string[];
};

const MAX_BATCH_DAYS = 31;

const templateImportColumns = [
  "テンプレート名",
  "説明",
  "有効",
  "行種別",
  "キー",
  "便種別",
  "便名",
  "便番号",
  "ステーション名",
  "タスク",
  "対象便キー",
  "作業員名",
  "レーン名",
  "予定開始",
  "予定終了",
  "指示",
];

const templateImportSample = [
  {
    テンプレート名: "夕方基本ダイヤ",
    説明: "夕方帯の基本テンプレート",
    有効: "true",
    行種別: "便",
    キー: "e1",
    便種別: "main",
    便名: "夕方A便",
    便番号: "EV-001",
    ステーション名: "北ヤード 1番",
    タスク: "",
    対象便キー: "",
    作業員名: "",
    レーン名: "",
    予定開始: "17:00",
    予定終了: "17:45",
    指示: "",
  },
  {
    テンプレート名: "夕方基本ダイヤ",
    説明: "夕方帯の基本テンプレート",
    有効: "true",
    行種別: "タスク",
    キー: "",
    便種別: "",
    便名: "",
    便番号: "",
    ステーション名: "",
    タスク: "荷下ろし",
    対象便キー: "e1",
    作業員名: "作業員A",
    レーン名: "A-01",
    予定開始: "17:05",
    予定終了: "17:35",
    指示: "到着確認後に開始",
  },
];

const emptyRoute: DialTemplateRoute = {
  key: "r1",
  type: "main",
  routeName: "",
  flightNumber: "",
  stationName: "",
  start: "08:00",
  end: "08:45",
};

const emptyTask: DialTemplateTask = {
  taskName: "",
  routeKey: "r1",
  workerName: "",
  laneName: "",
  start: "08:05",
  end: "08:35",
  instruction: "",
};

const presetTemplates: TemplateDraft[] = [
  {
    name: "午前基本ダイヤ",
    description: "午前帯のメイン便3本と荷下ろしタスクを作成します。",
    active: true,
    routes: [
      { key: "m1", type: "main", routeName: "午前A便", flightNumber: "AM-001", stationName: "", start: "08:00", end: "08:45" },
      { key: "m2", type: "main", routeName: "午前B便", flightNumber: "AM-002", stationName: "", start: "09:00", end: "09:45" },
      { key: "m3", type: "main", routeName: "午前C便", flightNumber: "AM-003", stationName: "", start: "10:00", end: "10:45" },
    ],
    tasks: [
      { taskName: "荷下ろし", routeKey: "m1", workerName: "", laneName: "", start: "08:05", end: "08:35", instruction: "到着確認後に開始" },
      { taskName: "仕分け", routeKey: "m2", workerName: "", laneName: "", start: "09:05", end: "09:35", instruction: "ラベル確認" },
      { taskName: "検品", routeKey: "m3", workerName: "", laneName: "", start: "10:05", end: "10:35", instruction: "数量差異を記録" },
    ],
  },
  {
    name: "日中標準ダイヤ",
    description: "午前から午後までのメイン便4本と基本タスクを作成します。",
    active: true,
    routes: [
      { key: "d1", type: "main", routeName: "日中A便", flightNumber: "DAY-001", stationName: "", start: "08:30", end: "09:15" },
      { key: "d2", type: "main", routeName: "日中B便", flightNumber: "DAY-002", stationName: "", start: "10:00", end: "10:45" },
      { key: "d3", type: "main", routeName: "日中C便", flightNumber: "DAY-003", stationName: "", start: "13:00", end: "13:45" },
      { key: "d4", type: "main", routeName: "日中D便", flightNumber: "DAY-004", stationName: "", start: "15:00", end: "15:45" },
    ],
    tasks: [
      { taskName: "荷下ろし", routeKey: "d1", workerName: "", laneName: "", start: "08:35", end: "09:05", instruction: "着車後に開始" },
      { taskName: "積込準備", routeKey: "d2", workerName: "", laneName: "", start: "10:05", end: "10:35", instruction: "必要資材を確認" },
      { taskName: "仕分け", routeKey: "d3", workerName: "", laneName: "", start: "13:05", end: "13:35", instruction: "行先別に仕分け" },
      { taskName: "検品", routeKey: "d4", workerName: "", laneName: "", start: "15:05", end: "15:35", instruction: "完了後に報告" },
    ],
  },
];

export function TemplateGenerationView({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [mode, setMode] = useState<TemplateMode>("create");
  const [templates, setTemplates] = useState<DialTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<TemplateDraft>(() => createEmptyDraft());
  const [startDate, setStartDate] = useState(businessDate);
  const [endDate, setEndDate] = useState(businessDate);
  const [batchMode, setBatchMode] = useState<BatchMode>("create");
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [plan, setPlan] = useState<TemplatePlan | null>(null);
  const [templateCsvRows, setTemplateCsvRows] = useState<ParsedCsvRow[]>([]);
  const [templateCsvText, setTemplateCsvText] = useState("");
  const [templateCsvFileName, setTemplateCsvFileName] = useState("");
  const [templateImportConfirmOpen, setTemplateImportConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const { stations, lanes, workers, error: masterError } = useMasterOptions(user);

  useEffect(
    () =>
      subscribeCollection<DialTemplate>(
        "dialTemplates",
        [where("siteId", "==", user.siteId)],
        (items) => {
          const sorted = [...items].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
          setTemplates(sorted);
          setSelectedId((current) => current || sorted.find((item) => item.active)?.id || sorted[0]?.id || "");
        },
        setError,
      ),
    [user.siteId],
  );

  useEffect(() => {
    setStartDate(businessDate);
    setEndDate(businessDate);
    setSafetyConfirmed(false);
    setPlan(null);
  }, [businessDate]);

  const activeStations = useMemo(() => stations.filter((station) => station.active), [stations]);
  const activeLanes = useMemo(() => lanes.filter((lane) => lane.active), [lanes]);
  const activeWorkers = useMemo(() => workers.filter((worker) => worker.active), [workers]);
  const activeTemplates = useMemo(() => templates.filter((template) => template.active), [templates]);
  const selected = templates.find((template) => template.id === selectedId) || activeTemplates[0] || templates[0] || null;
  const draftIssues = useMemo(() => validateDraft(draft, activeStations, activeLanes, activeWorkers), [draft, activeStations, activeLanes, activeWorkers]);
  const days = useMemo(() => enumerateDates(startDate, endDate), [startDate, endDate]);
  const batchRangeIssue = getBatchRangeIssue(startDate, endDate, days);
  const batchCountText = selected
    ? `対象日 ${days.length}日 / 便 ${days.length * selected.routes.length}件 / タスク ${days.length * selected.tasks.length}件`
    : "テンプレート未選択";
  const batchImpact = selected ? buildBatchImpact(selected, days.length, batchMode) : null;
  const templateImportItems = useMemo(
    () => buildTemplateImportItems(templateCsvRows, templates, activeStations, activeLanes, activeWorkers),
    [templateCsvRows, templates, activeStations, activeLanes, activeWorkers],
  );
  const templateImportReadyCount = templateImportItems.filter((item) => item.status === "ready").length;
  const templateImportIssueCount = templateImportItems.filter((item) => item.status === "error").length;
  const templateImportSkipCount = templateImportItems.filter((item) => item.status === "skip").length;
  const canPrepare = Boolean(selected) && !batchRangeIssue && !saving;
  const canSaveDraft = draftIssues.length === 0 && !saving;
  const canImportTemplates = templateImportReadyCount > 0 && templateImportIssueCount === 0 && !saving;

  async function seedPresets() {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const normalized = presetTemplates.map((template) => fillPresetMasters(template, activeStations, activeLanes, activeWorkers));
      for (const template of normalized) {
        await createEntity("dialTemplates", { ...template, siteId: user.siteId, businessDate: MASTER_BUSINESS_DATE }, user);
      }
      setSuccess("標準テンプレートを登録しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "標準テンプレート登録に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    setError("");
    setSuccess("");
    if (!canSaveDraft) {
      setError("テンプレート保存前に修正が必要です。");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const before = templates.find((template) => template.id === editingId);
        if (!before) throw new Error("編集対象のテンプレートが見つかりません。");
        await updateEntity("dialTemplates", before, draft, user);
        setSuccess("テンプレートを更新しました。");
      } else {
        const id = await createEntity("dialTemplates", { ...draft, siteId: user.siteId, businessDate: MASTER_BUSINESS_DATE }, user);
        setSelectedId(id);
        setSuccess("テンプレートを登録しました。");
      }
      setEditingId("");
      setDraft(createEmptyDraft());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "テンプレート保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function handleTemplateCsvFile(file?: File) {
    setError("");
    setSuccess("");
    setTemplateImportConfirmOpen(false);
    if (!file) return;
    try {
      const text = await file.text();
      setTemplateCsvRows(parseCsv(text));
      setTemplateCsvFileName(file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "テンプレートCSVの読み込みに失敗しました。");
    }
  }

  function handleTemplateCsvText() {
    setError("");
    setSuccess("");
    setTemplateImportConfirmOpen(false);
    if (!templateCsvText.trim()) {
      setError("貼り付けるテンプレートCSV本文を入力してください。");
      return;
    }
    setTemplateCsvRows(parseCsv(templateCsvText));
    setTemplateCsvFileName("貼り付けCSV");
  }

  function requestTemplateImportConfirm() {
    setError("");
    setSuccess("");
    if (!canImportTemplates) {
      setError("テンプレートCSVに修正が必要です。プレビューの判定を確認してください。");
      return;
    }
    setTemplateImportConfirmOpen(true);
  }

  async function importTemplatesFromCsv() {
    setError("");
    setSuccess("");
    if (!canImportTemplates) {
      setError("テンプレートCSVに修正が必要です。");
      return;
    }
    setSaving(true);
    try {
      const readyItems = templateImportItems.filter((item) => item.status === "ready");
      for (const item of readyItems) {
        await createEntity("dialTemplates", { ...item.draft, siteId: user.siteId, businessDate: MASTER_BUSINESS_DATE }, user);
      }
      setSuccess(`テンプレートCSVから${readyItems.length}件登録しました。`);
      setTemplateImportConfirmOpen(false);
      setTemplateCsvRows([]);
      setTemplateCsvText("");
      setTemplateCsvFileName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "テンプレートCSV取込に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateTemplate(template: DialTemplate) {
    setEditingId("");
    setDraft({
      name: `${template.name} コピー`,
      description: template.description,
      active: true,
      routes: template.routes,
      tasks: template.tasks,
    });
    setMode("manage");
    setSuccess("複製内容を編集できます。保存すると新しいテンプレートになります。");
  }

  async function deactivateTemplate(template: DialTemplate) {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await updateEntity("dialTemplates", template, { active: false }, user);
      setSuccess("テンプレートを無効化しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "テンプレート無効化に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function prepareBatch() {
    setError("");
    setSuccess("");
    setPlan(null);
    if (!selected || !canPrepare) {
      setError(batchRangeIssue || "テンプレートを選択してください。");
      return;
    }
    setSaving(true);
    try {
      const nextPlan = await buildTemplatePlan(user.siteId, selected, startDate, endDate, days, batchMode);
      setPlan(nextPlan);
      setSafetyConfirmed(false);
      setConfirmOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "実行前チェックに失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function executeBatch() {
    setError("");
    setSuccess("");
    if (!selected || !plan || !safetyConfirmed) {
      setError("実行前確認を完了してください。");
      return;
    }
    if (plan.issues.length > 0) {
      setError("実行前に修正が必要な内容があります。");
      return;
    }
    setSaving(true);
    try {
      if (batchMode === "delete") {
        for (const task of plan.existingTasks) {
          await softDeleteEntity("tasks", task, user);
        }
        for (const route of plan.existingRoutes) {
          await softDeleteEntity("routes", route, user);
        }
      } else {
        if (batchMode === "recreate") {
          for (const task of plan.existingTasks) {
            await softDeleteEntity("tasks", task, user);
          }
          for (const route of plan.existingRoutes) {
            await softDeleteEntity("routes", route, user);
          }
        }
        await createPlansForDays(selected, plan.days, user, activeStations, activeLanes, activeWorkers);
      }
      await createEntity("templateRuns", {
        templateId: selected.id,
        templateName: selected.name,
        templateRunLabel: `${selected.name} ${startDate} - ${endDate}`,
        startDate,
        endDate,
        days: plan.days.length,
        routeCount: batchMode === "delete" ? plan.existingRoutes.length : plan.days.length * selected.routes.length,
        taskCount: batchMode === "delete" ? plan.existingTasks.length : plan.days.length * selected.tasks.length,
        mode: batchMode,
        status: "completed",
        siteId: user.siteId,
        businessDate: MASTER_BUSINESS_DATE,
      }, user);
      setSuccess(buildSuccessMessage(batchMode, selected, plan.days));
      setConfirmOpen(false);
      setPlan(null);
      setSafetyConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "テンプレート処理に失敗しました。");
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
        テンプレートの作成・編集と、最大31日分までの計画一括作成を行います。再作成や一括削除は実績がないデータだけ対象です。
      </p>
      {masterError ? <p className="alert">{masterError}</p> : null}
      {error ? <p className="alert">{error}</p> : null}
      {success ? <p className="success-message">{success}</p> : null}

      <div className="template-mode-tabs">
        <button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>計画作成</button>
        <button type="button" className={mode === "manage" ? "active" : ""} onClick={() => setMode("manage")}>テンプレート管理</button>
      </div>

      {mode === "create" ? (
        <>
          {templates.length === 0 ? (
            <section className="form-check-panel warning">
              <strong>テンプレートが未登録です</strong>
              <p>まず標準テンプレートを登録するか、テンプレート管理から新規作成してください。</p>
              <SecondaryButton type="button" disabled={saving} onClick={() => void seedPresets()}>標準テンプレートを登録</SecondaryButton>
            </section>
          ) : null}
          <div className="template-toolbar batch-toolbar">
            <Field label="テンプレート">
              <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setSafetyConfirmed(false); }}>
                {activeTemplates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
              </select>
            </Field>
            <Field label="開始日">
              <input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setSafetyConfirmed(false); }} />
            </Field>
            <Field label="終了日">
              <input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setSafetyConfirmed(false); }} />
            </Field>
            <Field label="実行モード">
              <select value={batchMode} onChange={(event) => { setBatchMode(event.target.value as BatchMode); setSafetyConfirmed(false); }}>
                <option value="create">新規作成</option>
                <option value="recreate">再作成/上書き（実績なしのみ）</option>
                <option value="delete">一括削除（実績なしのみ）</option>
              </select>
            </Field>
            <PrimaryButton type="button" onClick={() => void prepareBatch()} disabled={!canPrepare}>
              実行前チェック
            </PrimaryButton>
          </div>
          {batchRangeIssue ? <p className="alert">{batchRangeIssue}</p> : null}
          <section className="template-summary">
            <div>
              <span>選択中</span>
              <strong>{selected?.name || "未選択"}</strong>
            </div>
            <div>
              <span>作成予定</span>
              <strong>{batchCountText}</strong>
            </div>
            <div>
              <span>制限</span>
              <strong>一括操作は最大31日分</strong>
            </div>
            <div>
              <span>再作成/削除</span>
              <strong>実績なしデータだけ対象</strong>
            </div>
          </section>
          {batchImpact ? (
            <section className={`form-check-panel ${batchImpact.tone}`}>
              <strong>{batchImpact.title}</strong>
              <p>{batchImpact.description}</p>
              <ul>
                {batchImpact.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </section>
          ) : null}
          {selected ? <TemplatePreview template={selected} /> : <EmptyState message="有効なテンプレートがありません。" />}
        </>
      ) : (
        <TemplateManagement
          templates={templates}
          draft={draft}
          editingId={editingId}
          draftIssues={draftIssues}
          stations={activeStations}
          lanes={activeLanes}
          workers={activeWorkers}
          saving={saving}
          onDraftChange={setDraft}
          onSave={() => void saveDraft()}
          onNew={() => { setEditingId(""); setDraft(createEmptyDraft()); }}
          onEdit={(template) => { setEditingId(template.id); setDraft(copyTemplateToDraft(template)); }}
          onDuplicate={(template) => void duplicateTemplate(template)}
          onDeactivate={(template) => void deactivateTemplate(template)}
          onSeed={() => void seedPresets()}
          csvRows={templateCsvRows}
          csvText={templateCsvText}
          csvFileName={templateCsvFileName}
          importItems={templateImportItems}
          importReadyCount={templateImportReadyCount}
          importIssueCount={templateImportIssueCount}
          importSkipCount={templateImportSkipCount}
          canImportTemplates={canImportTemplates}
          onCsvTextChange={setTemplateCsvText}
          onCsvFile={(file) => void handleTemplateCsvFile(file)}
          onCsvTextLoad={handleTemplateCsvText}
          onDownloadCsvTemplate={() => downloadCsv("yardmanager-dial-template-import-template.csv", templateImportSample)}
          onRequestCsvImport={requestTemplateImportConfirm}
        />
      )}

      {templateImportConfirmOpen ? (
        <Modal
          title="テンプレートCSV取込の最終確認"
          onClose={() => setTemplateImportConfirmOpen(false)}
          footer={
            <>
              <SecondaryButton type="button" onClick={() => setTemplateImportConfirmOpen(false)}>戻る</SecondaryButton>
              <PrimaryButton type="button" disabled={!canImportTemplates || saving} onClick={() => void importTemplatesFromCsv()}>
                {saving ? "取込中..." : "この内容で登録"}
              </PrimaryButton>
            </>
          }
        >
          <div className="detail-list">
            <div><span>CSV</span><strong>{templateCsvFileName || "未選択"}</strong></div>
            <div><span>登録予定</span><strong>{templateImportReadyCount}件</strong></div>
            <div><span>既存スキップ</span><strong>{templateImportSkipCount}件</strong></div>
            <div><span>要修正</span><strong>{templateImportIssueCount}件</strong></div>
          </div>
          <p className="helper-text">登録は新規テンプレートのみです。同名テンプレートは上書きせずスキップします。</p>
        </Modal>
      ) : null}

      {confirmOpen && plan && selected ? (
        <Modal
          title="テンプレート実行の最終確認"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <SecondaryButton type="button" onClick={() => setConfirmOpen(false)}>戻る</SecondaryButton>
              <PrimaryButton type="button" disabled={!safetyConfirmed || plan.issues.length > 0 || saving} onClick={() => void executeBatch()}>
                {saving ? "実行中..." : "この内容で実行"}
              </PrimaryButton>
            </>
          }
        >
          <div className="detail-list">
            <div><span>テンプレート</span><strong>{selected.name}</strong></div>
            <div><span>対象期間</span><strong>{startDate} - {endDate}</strong></div>
            <div><span>対象日数</span><strong>{plan.days.length}日</strong></div>
            <div><span>モード</span><strong>{batchModeLabel(batchMode)}</strong></div>
            <div><span>既存対象</span><strong>便 {plan.existingRoutes.length}件 / タスク {plan.existingTasks.length}件</strong></div>
            <div><span>作成予定</span><strong>便 {batchMode === "delete" ? 0 : plan.days.length * selected.routes.length}件 / タスク {batchMode === "delete" ? 0 : plan.days.length * selected.tasks.length}件</strong></div>
            <div><span>削除予定</span><strong>便 {batchMode === "create" ? 0 : plan.existingRoutes.length}件 / タスク {batchMode === "create" ? 0 : plan.existingTasks.length}件</strong></div>
            <div><span>実績あり</span><strong>{plan.protectedRoutes.length + plan.protectedTasks.length}件</strong></div>
          </div>
          <p className="helper-text">
            再作成/上書きは「実績なしの既存計画を論理削除してから、新しい計画を作成」します。実績がある便・タスクは保護されます。
          </p>
          {plan.issues.length > 0 ? (
            <div className="form-check-panel error">
              <strong>実行できません</strong>
              <ul>{plan.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            </div>
          ) : (
            <label className="check-row">
              <input type="checkbox" checked={safetyConfirmed} onChange={(event) => setSafetyConfirmed(event.target.checked)} />
              対象期間・件数・実績なし条件を確認しました
            </label>
          )}
        </Modal>
      ) : null}
    </Card>
  );
}

function TemplateManagement({
  templates,
  draft,
  editingId,
  draftIssues,
  stations,
  lanes,
  workers,
  saving,
  onDraftChange,
  onSave,
  onNew,
  onEdit,
  onDuplicate,
  onDeactivate,
  onSeed,
  csvRows,
  csvText,
  csvFileName,
  importItems,
  importReadyCount,
  importIssueCount,
  importSkipCount,
  canImportTemplates,
  onCsvTextChange,
  onCsvFile,
  onCsvTextLoad,
  onDownloadCsvTemplate,
  onRequestCsvImport,
}: {
  templates: DialTemplate[];
  draft: TemplateDraft;
  editingId: string;
  draftIssues: string[];
  stations: { name: string }[];
  lanes: Lane[];
  workers: Worker[];
  saving: boolean;
  onDraftChange: (draft: TemplateDraft) => void;
  onSave: () => void;
  onNew: () => void;
  onEdit: (template: DialTemplate) => void;
  onDuplicate: (template: DialTemplate) => void;
  onDeactivate: (template: DialTemplate) => void;
  onSeed: () => void;
  csvRows: ParsedCsvRow[];
  csvText: string;
  csvFileName: string;
  importItems: TemplateImportItem[];
  importReadyCount: number;
  importIssueCount: number;
  importSkipCount: number;
  canImportTemplates: boolean;
  onCsvTextChange: (value: string) => void;
  onCsvFile: (file?: File) => void;
  onCsvTextLoad: () => void;
  onDownloadCsvTemplate: () => void;
  onRequestCsvImport: () => void;
}) {
  return (
    <div className="template-management">
      <section className="template-panel">
        <div className="template-result-header">
          <h3>{editingId ? "テンプレート編集" : "テンプレート新規作成"}</h3>
          <SecondaryButton type="button" onClick={onNew}>新規入力</SecondaryButton>
        </div>
        <div className="form-grid">
          <Field label="テンプレート名">
            <input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="説明">
            <input value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} />
          </Field>
          <label className="check-row">
            <input type="checkbox" checked={draft.active} onChange={(event) => onDraftChange({ ...draft, active: event.target.checked })} />
            有効
          </label>
        </div>
        <EditableRouteRows draft={draft} stations={stations} onDraftChange={onDraftChange} />
        <EditableTaskRows draft={draft} lanes={lanes} workers={workers} onDraftChange={onDraftChange} />
        {draftIssues.length > 0 ? (
          <div className="form-check-panel error">
            <strong>保存前チェック</strong>
            <ul>{draftIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          </div>
        ) : null}
        <div className="form-actions">
          <PrimaryButton type="button" onClick={onSave} disabled={draftIssues.length > 0 || saving}>
            {editingId ? "更新" : "登録"}
          </PrimaryButton>
        </div>
      </section>

      <TemplateCsvImportPanel
        rows={csvRows}
        csvText={csvText}
        fileName={csvFileName}
        importItems={importItems}
        readyCount={importReadyCount}
        issueCount={importIssueCount}
        skipCount={importSkipCount}
        canImport={canImportTemplates}
        saving={saving}
        onCsvTextChange={onCsvTextChange}
        onCsvFile={onCsvFile}
        onCsvTextLoad={onCsvTextLoad}
        onDownloadTemplate={onDownloadCsvTemplate}
        onRequestImport={onRequestCsvImport}
      />

      <section className="template-panel">
        <div className="template-result-header">
          <h3>登録済みテンプレート</h3>
          {templates.length === 0 ? <SecondaryButton type="button" onClick={onSeed}>標準テンプレートを登録</SecondaryButton> : null}
        </div>
        {templates.length === 0 ? <EmptyState message="テンプレートはまだ登録されていません。" /> : null}
        {templates.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>状態</th>
                  <th>件数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>{template.name}</td>
                    <td>{template.active ? "有効" : "無効"}</td>
                    <td>便 {template.routes.length} / タスク {template.tasks.length}</td>
                    <td>
                      <div className="table-actions">
                        <SecondaryButton type="button" onClick={() => onEdit(template)}>編集</SecondaryButton>
                        <SecondaryButton type="button" onClick={() => onDuplicate(template)}>複製</SecondaryButton>
                        <SecondaryButton type="button" disabled={!template.active} onClick={() => onDeactivate(template)}>無効化</SecondaryButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function TemplateCsvImportPanel({
  rows,
  csvText,
  fileName,
  importItems,
  readyCount,
  issueCount,
  skipCount,
  canImport,
  saving,
  onCsvTextChange,
  onCsvFile,
  onCsvTextLoad,
  onDownloadTemplate,
  onRequestImport,
}: {
  rows: ParsedCsvRow[];
  csvText: string;
  fileName: string;
  importItems: TemplateImportItem[];
  readyCount: number;
  issueCount: number;
  skipCount: number;
  canImport: boolean;
  saving: boolean;
  onCsvTextChange: (value: string) => void;
  onCsvFile: (file?: File) => void;
  onCsvTextLoad: () => void;
  onDownloadTemplate: () => void;
  onRequestImport: () => void;
}) {
  return (
    <section className="template-panel">
      <div className="template-result-header">
        <h3>テンプレートCSV取込</h3>
        <SecondaryButton type="button" onClick={onDownloadTemplate}>CSVテンプレート出力</SecondaryButton>
      </div>
      <p className="helper-text">
        1つのテンプレートを複数行で表します。行種別を「便」または「タスク」にし、同じテンプレート名の行をまとめて登録します。
      </p>
      <div className="import-toolbar">
        <Field label="CSVファイル">
          <input type="file" accept=".csv,text/csv" onChange={(event) => onCsvFile(event.target.files?.[0])} />
        </Field>
        <PrimaryButton type="button" disabled={!canImport || saving} onClick={onRequestImport}>登録前確認</PrimaryButton>
      </div>
      <div className="import-paste-panel">
        <Field label="CSV本文を貼り付け">
          <textarea
            value={csvText}
            onChange={(event) => onCsvTextChange(event.target.value)}
            placeholder="CSVテンプレートと同じ列名の本文を貼り付けます"
          />
        </Field>
        <SecondaryButton type="button" onClick={onCsvTextLoad}>貼り付けCSVを読み込む</SecondaryButton>
      </div>
      {fileName ? <p className="helper-text">読込元: {fileName} / CSV行 {rows.length}行</p> : null}
      {importItems.length > 0 ? (
        <>
          <div className="import-summary">
            <div><span>登録予定</span><strong>{readyCount}件</strong></div>
            <div><span>既存スキップ</span><strong>{skipCount}件</strong></div>
            <div><span>要修正</span><strong>{issueCount}件</strong></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>判定</th>
                  <th>テンプレート</th>
                  <th>件数</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {importItems.map((item) => (
                  <tr key={item.name}>
                    <td>{importStatusLabel(item.status)}</td>
                    <td>{item.name}</td>
                    <td>便 {item.draft.routes.length} / タスク {item.draft.tasks.length}</td>
                    <td>{item.issues.length > 0 ? item.issues.join(" / ") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState message="CSVを読み込むと、テンプレート単位の判定が表示されます。" />
      )}
    </section>
  );
}

function EditableRouteRows({ draft, stations, onDraftChange }: { draft: TemplateDraft; stations: { name: string }[]; onDraftChange: (draft: TemplateDraft) => void }) {
  function updateRoute(index: number, patch: Partial<DialTemplateRoute>) {
    onDraftChange({ ...draft, routes: draft.routes.map((route, itemIndex) => (itemIndex === index ? { ...route, ...patch } : route)) });
  }
  function removeRoute(index: number) {
    if (draft.routes.length <= 1) return;
    const removedKey = draft.routes[index]?.key;
    onDraftChange({
      ...draft,
      routes: draft.routes.filter((_, itemIndex) => itemIndex !== index),
      tasks: draft.tasks.filter((task) => task.routeKey !== removedKey),
    });
  }
  return (
    <section className="template-edit-section">
      <div className="template-result-header">
        <h3>便行</h3>
        <SecondaryButton type="button" onClick={() => onDraftChange({ ...draft, routes: [...draft.routes, { ...emptyRoute, key: `r${draft.routes.length + 1}` }] })}>便行を追加</SecondaryButton>
      </div>
      {draft.routes.map((route, index) => (
        <div className="template-row-editor" key={`${route.key}-${index}`}>
          <Field label="キー"><input value={route.key} onChange={(event) => updateRoute(index, { key: event.target.value })} /></Field>
          <Field label="種別">
            <select value={route.type} onChange={(event) => updateRoute(index, { type: event.target.value as RouteType })}>
              <option value="main">メイン</option>
              <option value="sub">サブ</option>
            </select>
          </Field>
          <Field label="便名"><input value={route.routeName} onChange={(event) => updateRoute(index, { routeName: event.target.value })} /></Field>
          <Field label="便番号"><input value={route.flightNumber} onChange={(event) => updateRoute(index, { flightNumber: event.target.value })} /></Field>
          <Field label="ステーション">
            <select value={route.stationName} onChange={(event) => updateRoute(index, { stationName: event.target.value })}>
              <option value="">選択してください</option>
              {stations.map((station) => <option value={station.name} key={station.name}>{station.name}</option>)}
            </select>
          </Field>
          <Field label="開始"><input type="time" value={route.start} onChange={(event) => updateRoute(index, { start: event.target.value })} /></Field>
          <Field label="終了"><input type="time" value={route.end} onChange={(event) => updateRoute(index, { end: event.target.value })} /></Field>
          <div className="row-action-cell">
            <SecondaryButton type="button" disabled={draft.routes.length <= 1} onClick={() => removeRoute(index)}>削除</SecondaryButton>
          </div>
        </div>
      ))}
    </section>
  );
}

function EditableTaskRows({
  draft,
  lanes,
  workers,
  onDraftChange,
}: {
  draft: TemplateDraft;
  lanes: Lane[];
  workers: Worker[];
  onDraftChange: (draft: TemplateDraft) => void;
}) {
  function updateTask(index: number, patch: Partial<DialTemplateTask>) {
    onDraftChange({ ...draft, tasks: draft.tasks.map((task, itemIndex) => (itemIndex === index ? { ...task, ...patch } : task)) });
  }
  function removeTask(index: number) {
    onDraftChange({ ...draft, tasks: draft.tasks.filter((_, itemIndex) => itemIndex !== index) });
  }
  return (
    <section className="template-edit-section">
      <div className="template-result-header">
        <h3>タスク行</h3>
        <SecondaryButton type="button" onClick={() => onDraftChange({ ...draft, tasks: [...draft.tasks, { ...emptyTask, routeKey: draft.routes[0]?.key || "r1" }] })}>タスク行を追加</SecondaryButton>
      </div>
      {draft.tasks.map((task, index) => (
        <div className="template-row-editor" key={`${task.taskName}-${index}`}>
          <Field label="タスク"><input value={task.taskName} onChange={(event) => updateTask(index, { taskName: event.target.value })} /></Field>
          <Field label="対象便キー">
            <select value={task.routeKey} onChange={(event) => updateTask(index, { routeKey: event.target.value })}>
              {draft.routes.map((route) => <option value={route.key} key={route.key}>{route.key} / {route.routeName || "-"}</option>)}
            </select>
          </Field>
          <Field label="作業員">
            <select value={task.workerName} onChange={(event) => updateTask(index, { workerName: event.target.value })}>
              <option value="">選択してください</option>
              {workers.map((worker) => <option value={worker.displayName || worker.name} key={worker.id}>{worker.displayName || worker.name}</option>)}
            </select>
          </Field>
          <Field label="レーン">
            <select value={task.laneName} onChange={(event) => updateTask(index, { laneName: event.target.value })}>
              <option value="">選択してください</option>
              {lanes.map((lane) => <option value={lane.name} key={lane.id}>{lane.name}</option>)}
            </select>
          </Field>
          <Field label="開始"><input type="time" value={task.start} onChange={(event) => updateTask(index, { start: event.target.value })} /></Field>
          <Field label="終了"><input type="time" value={task.end} onChange={(event) => updateTask(index, { end: event.target.value })} /></Field>
          <Field label="指示"><input value={task.instruction} onChange={(event) => updateTask(index, { instruction: event.target.value })} /></Field>
          <div className="row-action-cell">
            <SecondaryButton type="button" onClick={() => removeTask(index)}>削除</SecondaryButton>
          </div>
        </div>
      ))}
    </section>
  );
}

function TemplatePreview({ template }: { template: DialTemplate }) {
  return (
    <div className="template-grid">
      <section className="template-panel">
        <h3>作成予定の便</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>便</th><th>便番号</th><th>ステーション</th><th>予定</th></tr></thead>
            <tbody>
              {template.routes.map((route) => (
                <tr key={route.key}><td>{route.routeName}</td><td>{route.flightNumber}</td><td>{route.stationName}</td><td>{route.start} - {route.end}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="template-panel">
        <h3>作成予定のタスク</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>タスク</th><th>作業員</th><th>レーン</th><th>対象便</th><th>予定</th></tr></thead>
            <tbody>
              {template.tasks.map((task, index) => (
                <tr key={`${task.taskName}-${index}`}><td>{task.taskName}</td><td>{task.workerName}</td><td>{task.laneName}</td><td>{task.routeKey}</td><td>{task.start} - {task.end}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function createEmptyDraft(): TemplateDraft {
  return { name: "", description: "", active: true, routes: [{ ...emptyRoute }], tasks: [{ ...emptyTask }] };
}

function copyTemplateToDraft(template: DialTemplate): TemplateDraft {
  return {
    name: template.name,
    description: template.description,
    active: template.active,
    routes: template.routes.map((route) => ({ ...route })),
    tasks: template.tasks.map((task) => ({ ...task })),
  };
}

function fillPresetMasters(template: TemplateDraft, stations: { name: string }[], lanes: Lane[], workers: Worker[]): TemplateDraft {
  return {
    ...template,
    routes: template.routes.map((route, index) => ({ ...route, stationName: route.stationName || stations[index % Math.max(stations.length, 1)]?.name || "" })),
    tasks: template.tasks.map((task, index) => ({
      ...task,
      workerName: task.workerName || workers[index % Math.max(workers.length, 1)]?.displayName || workers[index % Math.max(workers.length, 1)]?.name || "",
      laneName: task.laneName || lanes[index % Math.max(lanes.length, 1)]?.name || "",
    })),
  };
}

function buildTemplateImportItems(
  rows: ParsedCsvRow[],
  existingTemplates: DialTemplate[],
  stations: { name: string }[],
  lanes: Lane[],
  workers: Worker[],
): TemplateImportItem[] {
  if (rows.length === 0) return [];
  const missingColumns = templateImportColumns.filter((column) => !(column in rows[0]));
  const grouped = new Map<string, { draft: TemplateDraft; sourceRows: number[]; rowIssues: string[] }>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = normalize(row["テンプレート名"]);
    const kind = normalize(row["行種別"]);
    if (!name) return;
    const current = grouped.get(name) || {
      draft: { name, description: normalize(row["説明"]), active: parseCsvActive(row["有効"]), routes: [], tasks: [] },
      sourceRows: [],
      rowIssues: [],
    };
    current.sourceRows.push(rowNumber);
    if (!current.draft.description && normalize(row["説明"])) current.draft.description = normalize(row["説明"]);
    if (normalize(row["有効"])) current.draft.active = parseCsvActive(row["有効"]);

    if (isRouteCsvKind(kind)) {
      current.draft.routes.push({
        key: normalize(row["キー"]),
        type: parseRouteType(row["便種別"]),
        routeName: normalize(row["便名"]),
        flightNumber: normalize(row["便番号"]),
        stationName: normalize(row["ステーション名"]),
        start: normalize(row["予定開始"]),
        end: normalize(row["予定終了"]),
      });
    } else if (isTaskCsvKind(kind)) {
      current.draft.tasks.push({
        taskName: normalize(row["タスク"]),
        routeKey: normalize(row["対象便キー"]),
        workerName: normalize(row["作業員名"]),
        laneName: normalize(row["レーン名"]),
        start: normalize(row["予定開始"]),
        end: normalize(row["予定終了"]),
        instruction: normalize(row["指示"]),
      });
    } else {
      current.rowIssues.push(`${rowNumber}行目: 行種別は「便」または「タスク」にしてください。`);
    }
    grouped.set(name, current);
  });

  const items = [...grouped.entries()].map(([name, group]) => {
    const existing = existingTemplates.some((template) => !template.deleted && template.name === name);
    const issues = [
      ...missingColumns.map((column) => `CSVに列「${column}」がありません。`),
      ...group.rowIssues,
      ...validateDraft(group.draft, stations, lanes, workers),
    ];
    if (existing) {
      return { name, draft: group.draft, sourceRows: group.sourceRows, status: "skip" as const, issues: ["同名テンプレートが既にあります。"] };
    }
    return {
      name,
      draft: group.draft,
      sourceRows: group.sourceRows,
      status: issues.length > 0 ? "error" as const : "ready" as const,
      issues,
    };
  });

  if (items.length === 0 && rows.length > 0) {
    return [{
      name: "CSV全体",
      draft: createEmptyDraft(),
      sourceRows: rows.map((_, index) => index + 2),
      status: "error",
      issues: ["テンプレート名が入力された行がありません。"],
    }];
  }

  return items;
}

function normalize(value: string | undefined): string {
  return String(value || "").trim();
}

function parseCsvActive(value: string | undefined): boolean {
  const text = normalize(value).toLowerCase();
  return !["false", "0", "no", "無効"].includes(text);
}

function isRouteCsvKind(value: string): boolean {
  return ["便", "route", "routes"].includes(value.toLowerCase());
}

function isTaskCsvKind(value: string): boolean {
  return ["タスク", "task", "tasks"].includes(value.toLowerCase());
}

function parseRouteType(value: string | undefined): RouteType {
  const text = normalize(value).toLowerCase();
  return text === "sub" || text === "サブ" ? "sub" : "main";
}

function importStatusLabel(status: TemplateImportItem["status"]): string {
  if (status === "ready") return "登録予定";
  if (status === "skip") return "スキップ";
  return "要修正";
}

function validateDraft(draft: TemplateDraft, stations: { name: string }[], lanes: Lane[], workers: Worker[]): string[] {
  const issues: string[] = [];
  if (!draft.name.trim()) issues.push("テンプレート名を入力してください。");
  if (draft.routes.length === 0) issues.push("便行を1件以上登録してください。");
  const routeKeys = new Set<string>();
  const flightNumbers = new Set<string>();
  draft.routes.forEach((route, index) => {
    if (!route.key.trim()) issues.push(`便行${index + 1}: キーを入力してください。`);
    if (route.key && routeKeys.has(route.key)) issues.push(`便行${index + 1}: キーが重複しています。`);
    routeKeys.add(route.key);
    if (!route.routeName.trim()) issues.push(`便行${index + 1}: 便名を入力してください。`);
    if (!route.flightNumber.trim()) issues.push(`便行${index + 1}: 便番号を入力してください。`);
    if (route.flightNumber && flightNumbers.has(route.flightNumber)) issues.push(`便行${index + 1}: 便番号が重複しています。`);
    flightNumbers.add(route.flightNumber);
    if (!stations.some((station) => station.name === route.stationName)) issues.push(`便行${index + 1}: 有効なステーションを選択してください。`);
    if (!validTimeRange(route.start, route.end)) issues.push(`便行${index + 1}: 予定時刻を確認してください。`);
  });
  draft.tasks.forEach((task, index) => {
    if (!task.taskName.trim()) issues.push(`タスク行${index + 1}: タスク名を入力してください。`);
    if (!routeKeys.has(task.routeKey)) issues.push(`タスク行${index + 1}: 対象便キーがテンプレート内にありません。`);
    if (!workers.some((worker) => (worker.displayName || worker.name) === task.workerName)) issues.push(`タスク行${index + 1}: 有効な作業員を選択してください。`);
    if (!lanes.some((lane) => lane.name === task.laneName)) issues.push(`タスク行${index + 1}: 有効なレーンを選択してください。`);
    if (!validTimeRange(task.start, task.end)) issues.push(`タスク行${index + 1}: 予定時刻を確認してください。`);
  });
  return [...new Set(issues)];
}

async function buildTemplatePlan(siteId: string, template: DialTemplate, startDate: string, endDate: string, days: string[], mode: BatchMode): Promise<TemplatePlan> {
  const issues: string[] = [];
  const rangeIssue = getBatchRangeIssue(startDate, endDate, days);
  if (rangeIssue) issues.push(rangeIssue);
  const constraints = [where("siteId", "==", siteId), where("businessDate", ">=", startDate), where("businessDate", "<=", endDate)];
  const [routes, tasks] = await Promise.all([
    fetchCollectionOnce<Route>("routes", constraints),
    fetchCollectionOnce<Task>("tasks", constraints),
  ]);
  const existingRoutes = routes.filter((route) => route.templateId === template.id);
  const existingTasks = tasks.filter((task) => task.templateId === template.id);
  const protectedRoutes = existingRoutes.filter(hasRouteActual);
  const protectedTasks = existingTasks.filter(hasTaskActual);
  if ((mode === "recreate" || mode === "delete") && existingRoutes.length + existingTasks.length === 0) {
    issues.push("対象期間に、このテンプレートから作成された計画がありません。");
  }
  if ((mode === "recreate" || mode === "delete") && protectedRoutes.length + protectedTasks.length > 0) {
    issues.push("実績または作業中/完了のデータが含まれるため、一括削除・再作成できません。");
  }
  if (mode === "create") {
    const duplicateFlights = days.flatMap((date) =>
      template.routes
        .filter((route) => routes.some((item) => item.businessDate === date && item.flightNumber === route.flightNumber))
        .map((route) => `${date} ${route.flightNumber}`),
    );
    if (duplicateFlights.length > 0) issues.push(`既存便番号があります: ${duplicateFlights.slice(0, 5).join("、")}`);
  }
  return { days, existingRoutes, existingTasks, protectedRoutes, protectedTasks, issues };
}

async function createPlansForDays(
  template: DialTemplate,
  days: string[],
  user: AppUser,
  stations: { id: string; name: string }[],
  lanes: Lane[],
  workers: Worker[],
): Promise<void> {
  const templateRunId = `${template.id}-${Date.now()}`;
  const templateRunLabel = `${template.name} ${days[0]} - ${days[days.length - 1]}`;
  for (const day of days) {
    const routeByKey = new Map<string, Route>();
    for (const routeTemplate of template.routes) {
      const station = stations.find((item) => item.name === routeTemplate.stationName);
      if (!station) throw new Error(`ステーションが見つかりません: ${routeTemplate.stationName}`);
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
        templateId: template.id,
        templateName: template.name,
        templateRunId,
        templateRunLabel,
        siteId: user.siteId,
        businessDate: day,
      }, user);
      routeByKey.set(routeTemplate.key, {
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
        templateId: template.id,
        templateName: template.name,
        templateRunId,
        templateRunLabel,
        siteId: user.siteId,
        businessDate: day,
        createdAt: null,
        createdBy: user.id,
        updatedAt: null,
        updatedBy: user.id,
      });
    }
    for (const taskTemplate of template.tasks) {
      const route = routeByKey.get(taskTemplate.routeKey);
      if (!route) throw new Error(`対象便キーが見つかりません: ${taskTemplate.routeKey}`);
      const worker = workers.find((item) => (item.displayName || item.name) === taskTemplate.workerName);
      if (!worker) throw new Error(`作業員が見つかりません: ${taskTemplate.workerName}`);
      const lane = lanes.find((item) => item.name === taskTemplate.laneName);
      if (!lane) throw new Error(`レーンが見つかりません: ${taskTemplate.laneName}`);
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
        templateId: template.id,
        templateName: template.name,
        templateRunId,
        templateRunLabel,
        siteId: user.siteId,
        businessDate: day,
      }, user);
    }
  }
}

function enumerateDates(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate || startDate > endDate) return [];
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (current <= end && dates.length <= MAX_BATCH_DAYS + 1) {
    dates.push(toDateInputValue(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getBatchRangeIssue(startDate: string, endDate: string, days: string[]): string {
  if (!startDate || !endDate) return "開始日と終了日を入力してください。";
  if (startDate > endDate) return "開始日は終了日以前にしてください。";
  if (days.length > MAX_BATCH_DAYS) return "一括操作できる期間は最大31日分です。";
  return "";
}

function validTimeRange(start: string, end: string): boolean {
  return Boolean(start && end && labelToOffsetMin(end) > labelToOffsetMin(start));
}

function hasRouteActual(route: Route): boolean {
  return Boolean(route.actualStartAt || route.actualEndAt || route.status === "in_progress" || route.status === "completed");
}

function hasTaskActual(task: Task): boolean {
  return Boolean(task.actualStartAt || task.actualEndAt || task.status === "in_progress" || task.status === "completed");
}

function buildBatchImpact(
  template: DialTemplate,
  dayCount: number,
  mode: BatchMode,
): { title: string; description: string; notes: string[]; tone: "warning" | "error" } {
  const routeCount = dayCount * template.routes.length;
  const taskCount = dayCount * template.tasks.length;
  const notes = [
    `対象日数は${dayCount}日、作成予定は便${mode === "delete" ? 0 : routeCount}件・タスク${mode === "delete" ? 0 : taskCount}件です。`,
    "実行前チェックで、対象期間の既存計画と実績有無を確認します。",
  ];

  if (mode === "create") {
    return {
      title: "新規作成の確認",
      description: "既存の便番号と重なる場合は、実行前チェックで止めます。",
      notes,
      tone: "warning",
    };
  }

  if (mode === "recreate") {
    return {
      title: "再作成/上書きの確認",
      description: "実績なしの既存計画だけを論理削除し、同じ期間へ作り直します。",
      notes: [...notes, "作業開始済み・完了済み・実績時刻ありのデータが含まれる場合は実行できません。"],
      tone: "warning",
    };
  }

  return {
    title: "一括削除の確認",
    description: "テンプレートから作成された実績なし計画だけを論理削除します。新しい計画は作成しません。",
    notes: [...notes, "削除後に必要な場合は、新規作成モードで再作成してください。"],
    tone: "error",
  };
}

function batchModeLabel(mode: BatchMode): string {
  if (mode === "recreate") return "再作成/上書き（実績なしのみ）";
  if (mode === "delete") return "一括削除（実績なしのみ）";
  return "新規作成";
}

function buildSuccessMessage(mode: BatchMode, template: DialTemplate, days: string[]): string {
  if (mode === "delete") return `${template.name}の計画を${days.length}日分、一括削除しました。`;
  if (mode === "recreate") return `${template.name}の計画を${days.length}日分、再作成/上書きしました。`;
  return `${template.name}の計画を${days.length}日分、作成しました。`;
}
