import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Card, EmptyState, Modal, PrimaryButton, SecondaryButton, StatusBadge } from "../components/ui";
import { changeRouteStatus, subscribeDaily, subscribeMasters } from "../services/firestoreService";
import type { AppUser, Route, Station } from "../types";
import { BUSINESS_DAY_MINUTES, formatTimestamp, getDefaultBusinessDate, labelToOffsetMin, offsetMinToLabel } from "../utils/date";
import { routeStatusLabels } from "../utils/status";

type DriverViewMode = "all" | "near";
type GanttRange = { start: number; end: number; label: string };
type PositionedRoute = { route: Route; start: number; end: number; level: number };

const FULL_DAY_RANGE: GanttRange = { start: 0, end: BUSINESS_DAY_MINUTES, label: "全日" };
const HOUR_MINUTES = 60;
const NEAR_WINDOW_MINUTES = 120;
const ROUTE_BAR_HEIGHT = 58;
const ROUTE_BAR_GAP = 8;
const ROUTE_LANE_PADDING = 16;
const MIN_ROUTE_DURATION_MINUTES = 30;

export function DriverBoard({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState<Route | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<DriverViewMode>("all");

  useEffect(() => subscribeMasters("stations", user.siteId, setStations, setError), [user.siteId]);
  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const groupedStations = useMemo(() => {
    const groups = new Map<string, Station[]>();
    const routeStationIds = new Set(routes.map((route) => route.stationId));
    stations.filter((station) => station.active || routeStationIds.has(station.id)).forEach((station) => {
      const area = station.area || "未設定エリア";
      groups.set(area, [...(groups.get(area) || []), station]);
    });
    return [...groups.entries()];
  }, [stations, routes]);
  const currentTime = useMemo(() => getCurrentTimeMarker(now, businessDate), [businessDate, now]);
  const visibleRange = useMemo(() => buildVisibleRange(viewMode, currentTime), [currentTime, viewMode]);
  const timeTicks = useMemo(() => buildTimeTicks(visibleRange), [visibleRange]);
  const rangeMinutes = visibleRange.end - visibleRange.start;
  const gridColumnCount = Math.max(1, rangeMinutes / HOUR_MINUTES);

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Driver Board</p>
          <h2>ステーション別ガント</h2>
        </div>
        <div className="driver-view-switch" role="group" aria-label="ガント表示範囲">
          <button type="button" className={viewMode === "all" ? "active" : ""} onClick={() => setViewMode("all")}>全日</button>
          <button type="button" className={viewMode === "near" ? "active" : ""} onClick={() => setViewMode("near")} disabled={!currentTime}>現在前後2時間</button>
        </div>
      </div>
      {error ? <p className="alert">{error}</p> : null}
      {routes.length === 0 ? <EmptyState message="この対象日の便はまだありません。" /> : null}
      <p className="helper-text">表示範囲: {visibleRange.label} / 目盛りは1時間単位です。</p>
      <div className="gantt-legend">
        <span className="legend-waiting">{routeStatusLabels.waiting}</span>
        <span className="legend-in-progress">{routeStatusLabels.in_progress}</span>
        <span className="legend-completed">{routeStatusLabels.completed}</span>
        <span className="legend-actual">実績あり</span>
        {currentTime ? <span className="legend-current">現在 {currentTime.label}</span> : null}
      </div>
      <div className="gantt-wrap">
        <div className="gantt-table" style={{ "--gantt-grid-columns": gridColumnCount } as CSSProperties}>
          <div className="gantt-time">
            <div className="station-label-head">ステーション</div>
            <div className="time-axis">
              {timeTicks.map((tick) => <span key={tick} style={{ left: `${offsetToPercent(tick, visibleRange)}%` }}>{offsetMinToLabel(tick)}</span>)}
              {currentTime && isOffsetInRange(currentTime.offset, visibleRange) ? <CurrentTimeMarker currentTime={currentTime} range={visibleRange} labelOnly /> : null}
            </div>
          </div>
          {groupedStations.map(([area, group]) => (
            <section key={area} className="gantt-area">
              <h3>{area}</h3>
              {group.map((station) => {
                const positionedRoutes = layoutStationRoutes(
                  routes.filter((route) => route.stationId === station.id),
                  visibleRange,
                );
                const laneHeight = buildLaneHeight(positionedRoutes);
                return (
                  <div className="gantt-row" key={station.id} style={{ "--gantt-lane-height": `${laneHeight}px` } as CSSProperties}>
                    <div className="station-label">
                      {station.name}
                      {!station.active ? <small>無効</small> : null}
                    </div>
                    <div className="gantt-lane">
                      {currentTime && isOffsetInRange(currentTime.offset, visibleRange) ? <CurrentTimeMarker currentTime={currentTime} range={visibleRange} compact /> : null}
                      {positionedRoutes.map(({ route, start, end, level }) => {
                        return (
                          <button
                            key={route.id}
                            type="button"
                            className={`route-bar route-${route.status} ${route.actualStartAt ? "route-has-start" : ""} ${route.actualEndAt ? "route-has-end" : ""}`}
                            style={{
                              left: `${offsetToPercent(start, visibleRange)}%`,
                              width: `${durationToPercent(end - start, visibleRange)}%`,
                              top: `${8 + level * (ROUTE_BAR_HEIGHT + ROUTE_BAR_GAP)}px`,
                            }}
                            title={`${route.routeName} / ${route.flightNumber} / ${routeStatusLabels[route.status]}`}
                            onClick={() => setSelected(route)}
                          >
                            <span>{route.routeName}</span>
                            <small>{route.flightNumber}</small>
                            <em>{routeStatusLabels[route.status]}</em>
                            {route.actualStartAt ? <strong>{route.actualEndAt ? "実績完了" : "実績開始"}</strong> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
      {selected ? (
        <Modal
          title="便詳細"
          onClose={() => setSelected(null)}
          footer={
            <>
              {selected.status === "waiting" ? <PrimaryButton type="button" onClick={() => changeRouteStatus(selected, "in_progress", user).then(() => setSelected(null))}>作業開始</PrimaryButton> : null}
              {selected.status === "in_progress" ? <PrimaryButton type="button" onClick={() => changeRouteStatus(selected, "completed", user).then(() => setSelected(null))}>作業完了</PrimaryButton> : null}
              {selected.status !== "waiting" ? <SecondaryButton type="button" onClick={() => changeRouteStatus(selected, "waiting", user).then(() => setSelected(null))}>待機に戻す</SecondaryButton> : null}
            </>
          }
        >
          <div className="detail-list">
            <div><span>便名</span><strong>{selected.routeName}</strong></div>
            <div><span>便番号</span><strong>{selected.flightNumber}</strong></div>
            <div><span>ステーション</span><strong>{selected.stationName}</strong></div>
            <div><span>予定</span><strong>{selected.plannedStartLabel} - {selected.plannedEndLabel}</strong></div>
            <div><span>ステータス</span><StatusBadge type="route" status={selected.status} /></div>
            <div><span>開始実績</span><strong>{formatTimestamp(selected.actualStartAt)}</strong></div>
            <div><span>完了実績</span><strong>{formatTimestamp(selected.actualEndAt)}</strong></div>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

function CurrentTimeMarker({
  currentTime,
  range,
  compact = false,
  labelOnly = false,
}: {
  currentTime: { label: string; offset: number };
  range: GanttRange;
  compact?: boolean;
  labelOnly?: boolean;
}) {
  return (
    <div
      className={`current-time-marker ${compact ? "compact" : ""} ${labelOnly ? "label-only" : ""}`}
      style={{ left: `${offsetToPercent(currentTime.offset, range)}%` }}
      aria-label={`現在時刻 ${currentTime.label}`}
    >
      {!compact || labelOnly ? <span>{currentTime.label}</span> : null}
    </div>
  );
}

function getCurrentTimeMarker(now: Date, businessDate: string): { label: string; offset: number } | null {
  if (getDefaultBusinessDate(now) !== businessDate) return null;
  const label = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const offset = labelToOffsetMin(label);
  return {
    label,
    offset,
  };
}

function buildVisibleRange(viewMode: DriverViewMode, currentTime: { offset: number } | null): GanttRange {
  if (viewMode !== "near" || !currentTime) return FULL_DAY_RANGE;

  const start = Math.max(0, currentTime.offset - NEAR_WINDOW_MINUTES);
  const end = Math.min(BUSINESS_DAY_MINUTES, currentTime.offset + NEAR_WINDOW_MINUTES);
  return {
    start,
    end,
    label: `${offsetMinToLabel(start)} - ${offsetMinToLabel(end)}`,
  };
}

function buildTimeTicks(range: GanttRange): number[] {
  const firstTick = Math.ceil(range.start / HOUR_MINUTES) * HOUR_MINUTES;
  const ticks: number[] = [];
  for (let tick = firstTick; tick <= range.end; tick += HOUR_MINUTES) {
    ticks.push(tick);
  }
  if (!ticks.includes(range.start)) ticks.unshift(range.start);
  if (!ticks.includes(range.end)) ticks.push(range.end);
  return [...new Set(ticks)].sort((a, b) => a - b);
}

function layoutStationRoutes(routes: Route[], range: GanttRange): PositionedRoute[] {
  const lanes: number[] = [];
  return routes
    .map((route) => {
      const plannedStart = Math.max(0, route.plannedStartOffsetMin);
      const plannedEnd = Math.min(BUSINESS_DAY_MINUTES, Math.max(route.plannedEndOffsetMin, plannedStart + MIN_ROUTE_DURATION_MINUTES));
      return { route, plannedStart, plannedEnd };
    })
    .filter((item) => item.plannedStart < range.end && item.plannedEnd > range.start)
    .sort((a, b) => a.plannedStart - b.plannedStart || a.plannedEnd - b.plannedEnd)
    .map((item) => {
      const start = Math.max(range.start, item.plannedStart);
      const end = Math.min(range.end, item.plannedEnd);
      const level = findAvailableLevel(lanes, start);
      lanes[level] = end;
      return { route: item.route, start, end, level };
    });
}

function findAvailableLevel(lanes: number[], start: number): number {
  const level = lanes.findIndex((lastEnd) => lastEnd <= start);
  return level >= 0 ? level : lanes.length;
}

function buildLaneHeight(routes: PositionedRoute[]): number {
  const levels = routes.length === 0 ? 1 : Math.max(...routes.map((route) => route.level)) + 1;
  return ROUTE_LANE_PADDING + levels * ROUTE_BAR_HEIGHT + Math.max(0, levels - 1) * ROUTE_BAR_GAP;
}

function offsetToPercent(offset: number, range: GanttRange): number {
  return durationToPercent(offset - range.start, range);
}

function durationToPercent(duration: number, range: GanttRange): number {
  return Math.min(100, Math.max(0, (duration / (range.end - range.start)) * 100));
}

function isOffsetInRange(offset: number, range: GanttRange): boolean {
  return offset >= range.start && offset <= range.end;
}
