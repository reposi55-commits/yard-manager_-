import type { Lane, LoadingItem, LoadingItemStatus, Route, RouteLink } from "../types";
import { parseCsv, type ParsedCsvRow } from "./csv";

export type LoadingItemImportEncoding = "utf-8" | "shift-jis";
export type LoadingItemImportAction = "create" | "update" | "skip" | "error";

export type LoadingItemImportCsvRow = {
  importKey: string;
  subFlightNumber: string;
  subRouteName: string;
  mainFlightNumber: string;
  mainRouteName: string;
  laneName: string;
  supplierName: string;
  receivingName: string;
  orderNo: string;
  statusText: string;
  qualityInstruction: string;
  safetyInstruction: string;
  note: string;
  issueMemo: string;
};

export type LoadingItemImportPayload = Omit<
  LoadingItem,
  "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "deleted" | "deletedAt" | "deletedBy"
>;

export type LoadingItemImportPreviewRow = {
  rowNumber: number;
  action: LoadingItemImportAction;
  values: LoadingItemImportCsvRow;
  externalKey: string;
  subRoute?: Route;
  mainRoute?: Route;
  lane?: Lane;
  existingItem?: LoadingItem;
  payload?: LoadingItemImportPayload;
  errors: string[];
  warnings: string[];
};

export type LoadingItemImportContext = {
  siteId: string;
  businessDate: string;
  routes: Route[];
  lanes: Lane[];
  routeLinks: RouteLink[];
  loadingItems: LoadingItem[];
};

type LoadingItemImportColumn = keyof LoadingItemImportCsvRow;

const requiredColumns: LoadingItemImportColumn[] = ["subFlightNumber", "mainFlightNumber", "laneName"];

const loadingItemColumns: Record<LoadingItemImportColumn, string[]> = {
  importKey: ["取込キー"],
  subFlightNumber: ["サブ便番号", "サブ便No", "前工程便番号"],
  subRouteName: ["サブ便名", "サブ便", "前工程便名"],
  mainFlightNumber: ["メイン便番号", "メイン便No", "後工程便番号"],
  mainRouteName: ["メイン便名", "メイン便", "後工程便名"],
  laneName: ["レーン", "投入レーン", "投入先レーン"],
  supplierName: ["仕入先", "仕入先名"],
  receivingName: ["受入", "納入先受入", "受入名"],
  orderNo: ["オーダー", "オーダーNo", "注文番号"],
  statusText: ["状態"],
  qualityInstruction: ["品質指示", "品質注意", "検品指示"],
  safetyInstruction: ["安全指示", "安全注意"],
  note: ["備考", "メモ"],
  issueMemo: ["異常メモ", "欠品メモ", "不足メモ"],
};

export const loadingItemImportTemplate = [
  {
    取込キー: "",
    サブ便番号: "S-001",
    サブ便名: "サブ便A",
    メイン便番号: "M-001",
    メイン便名: "メイン便A",
    レーン: "A-01",
    仕入先: "仕入先A",
    受入: "第1受入",
    オーダー: "ORD-001",
    状態: "planned",
    品質指示: "検品時にラベル確認",
    安全指示: "投入前に周辺確認",
    備考: "",
    異常メモ: "",
  },
];

const emptyImportRow: LoadingItemImportCsvRow = {
  importKey: "",
  subFlightNumber: "",
  subRouteName: "",
  mainFlightNumber: "",
  mainRouteName: "",
  laneName: "",
  supplierName: "",
  receivingName: "",
  orderNo: "",
  statusText: "",
  qualityInstruction: "",
  safetyInstruction: "",
  note: "",
  issueMemo: "",
};

const headerToColumn = new Map<string, LoadingItemImportColumn>(
  Object.entries(loadingItemColumns).flatMap(([column, aliases]) =>
    aliases.map((alias) => [normalizeHeader(alias), column as LoadingItemImportColumn]),
  ),
);

export async function readLoadingItemCsv(file: File, encoding: LoadingItemImportEncoding): Promise<LoadingItemImportCsvRow[]> {
  const buffer = await file.arrayBuffer();
  const text = new TextDecoder(encoding).decode(buffer);
  return normalizeLoadingItemCsvRows(parseCsv(text));
}

export function normalizeLoadingItemCsvRows(rows: ParsedCsvRow[]): LoadingItemImportCsvRow[] {
  return rows.map((row) => {
    const normalized: LoadingItemImportCsvRow = { ...emptyImportRow };

    Object.entries(row).forEach(([header, value]) => {
      const column = headerToColumn.get(normalizeHeader(header));
      if (!column) return;
      normalized[column] = normalizeCellValue(column, value);
    });

    return normalized;
  });
}

export function buildLoadingItemImportPreviewRows(
  rows: LoadingItemImportCsvRow[],
  context: LoadingItemImportContext,
): LoadingItemImportPreviewRow[] {
  const existingByExternalKey = new Map(
    context.loadingItems
      .filter((item) => item.externalKey)
      .map((item) => [String(item.externalKey), item]),
  );
  const externalKeyCounts = new Map<string, number>();

  rows.forEach((row) => {
    const key = buildExternalKey(row);
    if (!key) return;
    externalKeyCounts.set(key, (externalKeyCounts.get(key) || 0) + 1);
  });

  return rows.map((row, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const externalKey = buildExternalKey(row);

    requiredColumns.forEach((column) => {
      if (!row[column]) errors.push(`${columnLabel(column)}は必須です。`);
    });
    if (!externalKey) errors.push("取込キーを生成できません。サブ便番号・メイン便番号・レーンを確認してください。");
    if (externalKey && (externalKeyCounts.get(externalKey) || 0) > 1) {
      errors.push(`CSV内で取込キーが重複しています: ${externalKey}`);
    }

    const statusResult = normalizeStatus(row.statusText);
    if (!statusResult.status) errors.push(statusResult.message);
    if (statusResult.warning) warnings.push(statusResult.warning);

    const subRouteResult = resolveRoute(context.routes, "sub", row.subFlightNumber, row.subRouteName);
    const mainRouteResult = resolveRoute(context.routes, "main", row.mainFlightNumber, row.mainRouteName);
    const laneResult = resolveLane(context.lanes, row.laneName);

    if (subRouteResult.error) errors.push(subRouteResult.error);
    if (mainRouteResult.error) errors.push(mainRouteResult.error);
    if (laneResult.error) errors.push(laneResult.error);

    if (subRouteResult.route && mainRouteResult.route) {
      const hasRouteLink = context.routeLinks.some(
        (link) => link.subRouteId === subRouteResult.route?.id && link.mainRouteId === mainRouteResult.route?.id,
      );
      if (!hasRouteLink) warnings.push("routeLinksに該当するサブ便・メイン便の紐付けがありません。取込実行時に自動作成します。");
    }

    const existingItem = externalKey ? existingByExternalKey.get(externalKey) : undefined;
    if (existingItem && isProtectedLoadingItem(existingItem)) {
      errors.push("既存データに投入実績があるため上書きできません。");
    }

    const payload =
      errors.length === 0 && statusResult.status && subRouteResult.route && mainRouteResult.route && laneResult.lane
        ? buildPayload({
            row,
            externalKey,
            status: statusResult.status,
            subRoute: subRouteResult.route,
            mainRoute: mainRouteResult.route,
            lane: laneResult.lane,
            context,
            rowNumber,
          })
        : undefined;
    const action = getPreviewAction(errors, payload, existingItem);

    return {
      rowNumber,
      action,
      values: row,
      externalKey,
      subRoute: subRouteResult.route,
      mainRoute: mainRouteResult.route,
      lane: laneResult.lane,
      existingItem,
      payload,
      errors,
      warnings,
    };
  });
}

export function withImportBatch(payload: LoadingItemImportPayload, importBatchId: string): LoadingItemImportPayload {
  return {
    ...payload,
    importBatchId,
  };
}

export function formatLoadingItemImportRoute(route: Route | undefined): string {
  if (!route) return "-";
  return [route.routeName, route.flightNumber].filter(Boolean).join(" / ");
}

function buildPayload({
  row,
  externalKey,
  status,
  subRoute,
  mainRoute,
  lane,
  context,
  rowNumber,
}: {
  row: LoadingItemImportCsvRow;
  externalKey: string;
  status: LoadingItemStatus;
  subRoute: Route;
  mainRoute: Route;
  lane: Lane;
  context: LoadingItemImportContext;
  rowNumber: number;
}): LoadingItemImportPayload {
  return {
    subRouteId: subRoute.id,
    mainRouteId: mainRoute.id,
    laneId: lane.id,
    laneName: lane.name,
    supplierName: row.supplierName,
    receivingName: row.receivingName,
    orderNo: row.orderNo,
    status,
    qualityInstruction: row.qualityInstruction,
    safetyInstruction: row.safetyInstruction,
    note: row.note,
    issueMemo: row.issueMemo,
    siteId: context.siteId,
    businessDate: context.businessDate,
    source: "csv",
    externalKey,
    importRowNo: rowNumber,
  };
}

function getPreviewAction(
  errors: string[],
  payload: LoadingItemImportPayload | undefined,
  existingItem: LoadingItem | undefined,
): LoadingItemImportAction {
  if (errors.length > 0 || !payload) return "error";
  if (!existingItem) return "create";
  return isSameImportPayload(existingItem, payload) ? "skip" : "update";
}

function isProtectedLoadingItem(item: LoadingItem): boolean {
  return (
    item.status === "lane_in_progress" ||
    item.status === "lane_in_completed" ||
    Boolean(item.actualLaneInStartAt) ||
    Boolean(item.actualLaneInEndAt)
  );
}

function isSameImportPayload(item: LoadingItem, payload: LoadingItemImportPayload): boolean {
  const keys: Array<keyof LoadingItemImportPayload> = [
    "subRouteId",
    "mainRouteId",
    "laneId",
    "laneName",
    "supplierName",
    "receivingName",
    "orderNo",
    "status",
    "qualityInstruction",
    "safetyInstruction",
    "note",
    "issueMemo",
    "siteId",
    "businessDate",
    "source",
    "externalKey",
    "importRowNo",
  ];
  return keys.every((key) => (item[key] || "") === (payload[key] || ""));
}

function resolveRoute(
  routes: Route[],
  type: "sub" | "main",
  flightNumber: string,
  routeName: string,
): { route?: Route; error?: string } {
  if (!flightNumber) return {};
  const label = type === "sub" ? "サブ便" : "メイン便";
  const byNumber = routes.filter((route) => route.type === type && normalizeCode(route.flightNumber) === flightNumber);
  if (byNumber.length === 0) return { error: `${label}が見つかりません: ${flightNumber}` };

  if (routeName) {
    const byName = byNumber.filter((route) => normalizeText(route.routeName) === routeName);
    if (byName.length === 1) return { route: byName[0] };
    if (byName.length === 0) return { error: `${label}名が一致する便が見つかりません: ${routeName} / ${flightNumber}` };
    return { error: `${label}が複数見つかりました。便名で一意にしてください: ${routeName} / ${flightNumber}` };
  }

  if (byNumber.length === 1) return { route: byNumber[0] };
  return { error: `${label}番号が複数見つかりました。${label}名も指定してください: ${flightNumber}` };
}

function resolveLane(lanes: Lane[], laneName: string): { lane?: Lane; error?: string } {
  if (!laneName) return {};
  const matches = lanes.filter((lane) => normalizeCode(lane.name) === laneName || normalizeText(lane.name) === laneName);
  if (matches.length === 0) return { error: `レーンが見つかりません: ${laneName}` };
  const activeMatches = matches.filter((lane) => lane.active);
  if (activeMatches.length === 0) return { error: `無効なレーンのため取込できません: ${laneName}` };
  if (activeMatches.length > 1) return { error: `レーンが複数見つかりました: ${laneName}` };
  return { lane: activeMatches[0] };
}

function normalizeStatus(value: string): { status?: LoadingItemStatus; message: string; warning?: string } {
  const normalized = normalizeText(value);
  const key = normalized.toLowerCase();
  const statusMap = new Map<string, LoadingItemStatus>([
    ["", "planned"],
    ["未投入", "planned"],
    ["登録済み", "planned"],
    ["planned", "planned"],
    ["欠品", "shortage"],
    ["不足", "shortage"],
    ["shortage", "shortage"],
    ["対象外", "cancelled"],
    ["キャンセル", "cancelled"],
    ["cancelled", "cancelled"],
    ["投入中", "lane_in_progress"],
    ["lane_in_progress", "lane_in_progress"],
    ["投入完了", "lane_in_completed"],
    ["完了", "lane_in_completed"],
    ["lane_in_completed", "lane_in_completed"],
  ]);
  const status = statusMap.get(key) || statusMap.get(normalized);
  if (!status) return { message: `状態の値が不正です: ${value}` };
  const warning =
    status === "lane_in_progress" || status === "lane_in_completed"
      ? "CSV取込で投入中・投入完了を扱う場合は、実績上書きにならないか確認してください。"
      : undefined;
  return { status, message: "", warning };
}

function buildExternalKey(row: LoadingItemImportCsvRow): string {
  if (row.importKey) return row.importKey;
  const parts = [
    row.subFlightNumber,
    row.mainFlightNumber,
    row.laneName,
    row.supplierName,
    row.receivingName,
    row.orderNo,
  ];
  if (parts.slice(0, 3).some((part) => !part)) return "";
  return `auto:${parts.join("|")}`;
}

function normalizeCellValue(column: LoadingItemImportColumn, value: string): string {
  if (column === "subFlightNumber" || column === "mainFlightNumber" || column === "laneName" || column === "orderNo" || column === "importKey") {
    return normalizeCode(value);
  }
  return normalizeText(value);
}

function normalizeHeader(value: string): string {
  return normalizeText(value).toLowerCase();
}

function normalizeCode(value: string): string {
  return normalizeText(value).toUpperCase();
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−－ｰー]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function columnLabel(column: LoadingItemImportColumn): string {
  return loadingItemColumns[column][0];
}
