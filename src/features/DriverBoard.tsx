import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, Modal, PrimaryButton, SecondaryButton, StatusBadge } from "../components/ui";
import { changeRouteStatus, subscribeDaily, subscribeMasters } from "../services/firestoreService";
import type { AppUser, Route, Station } from "../types";
import { BUSINESS_DAY_MINUTES, formatTimestamp, getDefaultBusinessDate, labelToOffsetMin, offsetMinToLabel } from "../utils/date";
import { routeStatusLabels } from "../utils/status";

const timeTicks = Array.from({ length: 13 }, (_, index) => index * 120);

export function DriverBoard({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState<Route | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

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

  return (
    <Card>
      <div className="section-header"><div><p className="eyebrow">Driver Board</p><h2>ステーション別ガント</h2></div></div>
      {error ? <p className="alert">{error}</p> : null}
      {routes.length === 0 ? <EmptyState message="この対象日の便はまだありません。" /> : null}
      <div className="gantt-legend">
        <span className="legend-waiting">{routeStatusLabels.waiting}</span>
        <span className="legend-in-progress">{routeStatusLabels.in_progress}</span>
        <span className="legend-completed">{routeStatusLabels.completed}</span>
        <span className="legend-actual">実績あり</span>
        {currentTime ? <span className="legend-current">現在 {currentTime.label}</span> : null}
      </div>
      <div className="gantt-wrap">
        <div className="gantt-table">
          <div className="gantt-time">
            <div className="station-label-head">ステーション</div>
            <div className="time-axis">
              {timeTicks.map((tick) => <span key={tick} style={{ left: `${(tick / BUSINESS_DAY_MINUTES) * 100}%` }}>{offsetMinToLabel(tick)}</span>)}
              {currentTime ? <CurrentTimeMarker currentTime={currentTime} labelOnly /> : null}
            </div>
          </div>
          {groupedStations.map(([area, group]) => (
            <section key={area} className="gantt-area">
              <h3>{area}</h3>
              {group.map((station) => {
                const stationRoutes = routes.filter((route) => route.stationId === station.id);
                return (
                  <div className="gantt-row" key={station.id}>
                    <div className="station-label">
                      {station.name}
                      {!station.active ? <small>無効</small> : null}
                    </div>
                    <div className="gantt-lane">
                      {currentTime ? <CurrentTimeMarker currentTime={currentTime} compact /> : null}
                      {stationRoutes.map((route) => {
                        const start = Math.max(0, route.plannedStartOffsetMin);
                        const end = Math.min(BUSINESS_DAY_MINUTES, Math.max(route.plannedEndOffsetMin, start + 30));
                        return (
                          <button
                            key={route.id}
                            type="button"
                            className={`route-bar route-${route.status} ${route.actualStartAt ? "route-has-start" : ""} ${route.actualEndAt ? "route-has-end" : ""}`}
                            style={{ left: `${(start / BUSINESS_DAY_MINUTES) * 100}%`, width: `${((end - start) / BUSINESS_DAY_MINUTES) * 100}%` }}
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
  compact = false,
  labelOnly = false,
}: {
  currentTime: { label: string; percent: number };
  compact?: boolean;
  labelOnly?: boolean;
}) {
  return (
    <div
      className={`current-time-marker ${compact ? "compact" : ""} ${labelOnly ? "label-only" : ""}`}
      style={{ left: `${currentTime.percent}%` }}
      aria-label={`現在時刻 ${currentTime.label}`}
    >
      {!compact || labelOnly ? <span>{currentTime.label}</span> : null}
    </div>
  );
}

function getCurrentTimeMarker(now: Date, businessDate: string): { label: string; percent: number } | null {
  if (getDefaultBusinessDate(now) !== businessDate) return null;
  const label = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const offset = labelToOffsetMin(label);
  return {
    label,
    percent: Math.min(100, Math.max(0, (offset / BUSINESS_DAY_MINUTES) * 100)),
  };
}
