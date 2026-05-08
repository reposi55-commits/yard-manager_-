import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, Modal, PrimaryButton, SecondaryButton, StatusBadge } from "../components/ui";
import { changeRouteStatus, subscribeDaily, subscribeMasters } from "../services/firestoreService";
import type { AppUser, Route, Station } from "../types";
import { BUSINESS_DAY_MINUTES, formatTimestamp, offsetMinToLabel } from "../utils/date";

const timeTicks = Array.from({ length: 13 }, (_, index) => index * 120);

export function DriverBoard({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState<Route | null>(null);
  const [error, setError] = useState("");

  useEffect(() => subscribeMasters("stations", user.siteId, setStations, setError), [user.siteId]);
  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);

  const groupedStations = useMemo(() => {
    const groups = new Map<string, Station[]>();
    const routeStationIds = new Set(routes.map((route) => route.stationId));
    stations.filter((station) => station.active || routeStationIds.has(station.id)).forEach((station) => {
      const area = station.area || "未設定エリア";
      groups.set(area, [...(groups.get(area) || []), station]);
    });
    return [...groups.entries()];
  }, [stations, routes]);

  return (
    <Card>
      <div className="section-header"><div><p className="eyebrow">Driver Board</p><h2>ステーション別ガント</h2></div></div>
      {error ? <p className="alert">{error}</p> : null}
      {routes.length === 0 ? <EmptyState message="この対象日の便はまだありません。" /> : null}
      <div className="gantt-wrap">
        <div className="gantt-time">
          <div className="station-label-head">ステーション</div>
          <div className="time-axis">
            {timeTicks.map((tick) => <span key={tick} style={{ left: `${(tick / BUSINESS_DAY_MINUTES) * 100}%` }}>{offsetMinToLabel(tick)}</span>)}
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
                    {stationRoutes.map((route) => {
                      const start = Math.max(0, route.plannedStartOffsetMin);
                      const end = Math.min(BUSINESS_DAY_MINUTES, Math.max(route.plannedEndOffsetMin, start + 30));
                      return (
                        <button
                          key={route.id}
                          type="button"
                          className={`route-bar route-${route.status}`}
                          style={{ left: `${(start / BUSINESS_DAY_MINUTES) * 100}%`, width: `${((end - start) / BUSINESS_DAY_MINUTES) * 100}%` }}
                          onClick={() => setSelected(route)}
                        >
                          <span>{route.routeName}</span>
                          <small>{route.flightNumber}</small>
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
