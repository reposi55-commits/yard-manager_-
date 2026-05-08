import type { RouteStatus, TaskStatus } from "../types";

export const routeStatusLabels: Record<RouteStatus, string> = {
  waiting: "待機",
  in_progress: "作業中",
  completed: "完了",
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  pending: "未開始",
  ready: "開始可能",
  in_progress: "作業中",
  completed: "完了",
};

export const taskDisplayLabels = {
  waitingForPrevious: "前工程待ち",
  beforeStart: "未開始",
};

export type StatusTone = "gray" | "blue" | "green" | "amber";

export function getRouteStatusTone(status: RouteStatus): StatusTone {
  if (status === "in_progress") return "blue";
  if (status === "completed") return "green";
  return "gray";
}

export function getTaskStatusTone(status: TaskStatus, blocked = false): StatusTone {
  if (blocked) return "amber";
  if (status === "in_progress") return "blue";
  if (status === "completed") return "green";
  if (status === "ready") return "amber";
  return "gray";
}
