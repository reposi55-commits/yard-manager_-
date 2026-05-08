export const BUSINESS_DAY_START_HOUR = 5;
export const BUSINESS_DAY_MINUTES = 24 * 60;

export function getDefaultBusinessDate(now = new Date()): string {
  const local = new Date(now);
  if (local.getHours() < BUSINESS_DAY_START_HOUR) {
    local.setDate(local.getDate() - 1);
  }
  return toDateInputValue(local);
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function labelToOffsetMin(label: string): number {
  const [hourText, minuteText] = label.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }
  const raw = hour * 60 + minute;
  const start = BUSINESS_DAY_START_HOUR * 60;
  return raw >= start ? raw - start : raw + BUSINESS_DAY_MINUTES - start;
}

export function offsetMinToLabel(offsetMin: number): string {
  const start = BUSINESS_DAY_START_HOUR * 60;
  const raw = (start + offsetMin) % BUSINESS_DAY_MINUTES;
  const hour = Math.floor(raw / 60);
  const minute = raw % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatTimestamp(value: { toDate: () => Date } | null | undefined): string {
  if (!value) return "-";
  const date = value.toDate();
  return `${toDateInputValue(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function isBeforePlannedStart(taskOffsetMin: number): boolean {
  const now = new Date();
  const currentOffset = labelToOffsetMin(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
  return currentOffset < taskOffsetMin;
}
