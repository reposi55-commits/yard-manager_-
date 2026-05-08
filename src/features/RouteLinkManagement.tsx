import { useEffect, useMemo, useState } from "react";
import { Card, DangerButton, EmptyState, Field, PrimaryButton } from "../components/ui";
import { createEntity, softDeleteEntity, subscribeDaily } from "../services/firestoreService";
import type { AppUser, Route, RouteLink } from "../types";

export function RouteLinkManagement({ user, businessDate }: { user: AppUser; businessDate: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [links, setLinks] = useState<RouteLink[]>([]);
  const [subRouteId, setSubRouteId] = useState("");
  const [mainRouteId, setMainRouteId] = useState("");
  const [error, setError] = useState("");

  const subRoutes = useMemo(() => routes.filter((route) => route.type === "sub"), [routes]);
  const mainRoutes = useMemo(() => routes.filter((route) => route.type === "main"), [routes]);

  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routeLinks", user.siteId, businessDate, setLinks, setError), [user.siteId, businessDate]);

  async function save() {
    const sub = subRoutes.find((route) => route.id === subRouteId);
    const main = mainRoutes.find((route) => route.id === mainRouteId);
    if (!sub || !main) {
      setError("サブ便とメイン便を選択してください。");
      return;
    }
    if (sub.id === main.id) {
      setError("同じ便同士は紐付けできません。");
      return;
    }
    if (links.some((link) => link.subRouteId === sub.id && link.mainRouteId === main.id)) {
      setError("同じ紐付けがすでに存在します。");
      return;
    }
    try {
      await createEntity(
        "routeLinks",
        {
          siteId: user.siteId,
          businessDate,
          subRouteId: sub.id,
          subRouteName: sub.routeName,
          subFlightNumber: sub.flightNumber,
          mainRouteId: main.id,
          mainRouteName: main.routeName,
          mainFlightNumber: main.flightNumber,
        },
        user,
      );
      setSubRouteId("");
      setMainRouteId("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "便紐付けの保存に失敗しました。");
    }
  }

  async function remove(link: RouteLink) {
    const label = `${link.subRouteName} / ${link.subFlightNumber} → ${link.mainRouteName} / ${link.mainFlightNumber}`;
    if (!window.confirm(`${label} の紐付けを削除しますか？`)) return;
    await softDeleteEntity("routeLinks", link, user);
  }

  return (
    <Card>
      <div className="section-header"><div><p className="eyebrow">Links</p><h2>サブ便とメイン便の紐付け</h2></div></div>
      {error ? <p className="alert">{error}</p> : null}
      <div className="form-grid inline-form">
        <Field label="サブ便">
          <select value={subRouteId} onChange={(e) => setSubRouteId(e.target.value)}>
            <option value="">選択</option>
            {subRoutes.map((route) => <option key={route.id} value={route.id}>{route.routeName} / {route.flightNumber}</option>)}
          </select>
        </Field>
        <Field label="メイン便">
          <select value={mainRouteId} onChange={(e) => setMainRouteId(e.target.value)}>
            <option value="">選択</option>
            {mainRoutes.map((route) => <option key={route.id} value={route.id}>{route.routeName} / {route.flightNumber}</option>)}
          </select>
        </Field>
        <div className="form-actions"><PrimaryButton type="button" onClick={save} disabled={!subRouteId || !mainRouteId}>追加</PrimaryButton></div>
      </div>
      {links.length === 0 ? <EmptyState message="便紐付けはまだありません。" /> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>サブ便</th><th>メイン便</th><th>操作</th></tr></thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id}>
                <td>{link.subRouteName} / {link.subFlightNumber}</td>
                <td>{link.mainRouteName} / {link.mainFlightNumber}</td>
                <td><DangerButton type="button" onClick={() => remove(link)}>削除</DangerButton></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
