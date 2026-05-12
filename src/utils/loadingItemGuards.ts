import type { Lane, LoadingItem, Task } from "../types";

export const loadingItemStatusLabels: Record<LoadingItem["status"], string> = {
  planned: "登録済み",
  sub_arrived: "サブ便到着",
  lane_in_progress: "投入中",
  lane_in_completed: "投入完了",
  shortage: "欠品・不足",
  cancelled: "対象外",
};

export function uniqueText(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function sortAttentionLoadingItems(items: LoadingItem[]): LoadingItem[] {
  const rank: Record<LoadingItem["status"], number> = {
    shortage: 1,
    lane_in_progress: 2,
    sub_arrived: 3,
    planned: 4,
    lane_in_completed: 5,
    cancelled: 6,
  };
  return [...items].sort((a, b) => rank[a.status] - rank[b.status]);
}

export function buildBlockedReasons(
  routeBlocked: boolean,
  relatedLoadingItems: LoadingItem[],
  shortageItems: LoadingItem[],
  incompleteLoadingItems: LoadingItem[],
): string[] {
  const reasons: string[] = [];
  if (routeBlocked) reasons.push("開始不可：未完了のサブ便があります");
  if (relatedLoadingItems.length === 0) {
    reasons.push("積み付け情報が未登録です。管理者に確認してください。");
    return reasons;
  }
  if (shortageItems.length > 0) reasons.push("開始不可：欠品登録があります");
  if (incompleteLoadingItems.some((item) => item.status !== "shortage")) reasons.push("開始不可：製品未揃い");
  return reasons;
}

export function buildTaskLaneSafetyBlockedReasons(task: Pick<Task, "laneId">, loadingItems: LoadingItem[], lanes: Lane[]): string[] {
  const targetLane = lanes.find((lane) => lane.id === task.laneId);
  const targetLaneIds = new Set([task.laneId, ...(targetLane?.adjacentLaneIds || [])]);
  const inProgressItems = loadingItems.filter((item) => item.status === "lane_in_progress" && targetLaneIds.has(item.laneId));
  const reasons = new Set<string>();

  inProgressItems.forEach((item) => {
    const laneName = formatLaneName(item.laneName || lanes.find((lane) => lane.id === item.laneId)?.name || item.laneId);
    if (item.laneId === task.laneId) {
      reasons.add(`開始不可：${laneName}でリフト投入中です`);
    } else {
      reasons.add(`開始不可：隣接 ${laneName}でリフト投入中です`);
    }
  });

  return [...reasons];
}

export function buildLaneWorkSafetyIssue(laneId: string, lanes: Lane[], tasks: Task[]): string {
  const targetLane = lanes.find((lane) => lane.id === laneId);
  const targetLaneIds = new Set([laneId, ...(targetLane?.adjacentLaneIds || [])]);
  const inProgressTask = tasks.find((task) => task.status === "in_progress" && targetLaneIds.has(task.laneId));
  if (!inProgressTask) return "";

  const laneName = formatLaneName(inProgressTask.laneName || lanes.find((lane) => lane.id === inProgressTask.laneId)?.name || inProgressTask.laneId);
  if (inProgressTask.laneId === laneId) {
    return `投入開始不可：${laneName}で作業員が検品作業中です`;
  }
  return `投入開始不可：隣接 ${laneName}で作業員が検品作業中です`;
}

export function formatLoadingItemLabel(item: LoadingItem): string {
  const label = getLoadingItemProgressLabel(item);
  const detail = [
    item.supplierName || "仕入先未設定",
    item.receivingName || "受入未設定",
    item.orderNo || "オーダー未設定",
  ].join(" / ");
  return `${label}：${detail}`;
}

export function getLoadingItemProgressLabel(item: LoadingItem): string {
  if (item.status === "shortage") return "欠品";
  if (item.status === "lane_in_progress") return "投入中";
  if (item.status === "lane_in_completed") return "投入完了";
  if (item.status === "cancelled") return "対象外";
  return "未投入";
}

export function formatLaneName(name: string): string {
  if (!name) return "対象レーン";
  return name.endsWith("レーン") ? name : `${name}レーン`;
}
