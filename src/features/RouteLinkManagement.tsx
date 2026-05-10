import { useEffect, useMemo, useState } from "react";
import { Card, DangerButton, EmptyState, Field, FormCheckPanel, PrimaryButton } from "../components/ui";
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
  const formIssues = useMemo(
    () => buildRouteLinkIssues(subRouteId, mainRouteId, subRoutes, mainRoutes, links),
    [links, mainRouteId, mainRoutes, subRouteId, subRoutes],
  );

  useEffect(() => subscribeDaily("routes", user.siteId, businessDate, setRoutes, setError), [user.siteId, businessDate]);
  useEffect(() => subscribeDaily("routeLinks", user.siteId, businessDate, setLinks, setError), [user.siteId, businessDate]);

  async function save() {
    const sub = subRoutes.find((route) => route.id === subRouteId);
    const main = mainRoutes.find((route) => route.id === mainRouteId);
    if (formIssues.length > 0) {
      setError(formIssues[0]);
      return;
    }
    if (!sub || !main) return;
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
      <FormCheckPanel issues={formIssues} warnings={[]} />
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
        <div className="form-actions"><PrimaryButton type="button" onClick={save} disabled={formIssues.length > 0} title={formIssues[0] || ""}>追加</PrimaryButton></div>
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

function buildRouteLinkIssues(
  subRouteId: string,
  mainRouteId: string,
  subRoutes: Route[],
  mainRoutes: Route[],
  links: RouteLink[],
): string[] {
  const issues: string[] = [];
  const sub = subRoutes.find((route) => route.id === subRouteId);
  const main = mainRoutes.find((route) => route.id === mainRouteId);
  if (!subRouteId) issues.push("サブ便を選択してください。");
  if (!mainRouteId) issues.push("メイン便を選択してください。");
  if (subRouteId && !sub) issues.push("選択したサブ便が見つかりません。");
  if (mainRouteId && !main) issues.push("選択したメイン便が見つかりません。");
  if (sub && main && sub.id === main.id) issues.push("同じ便同士は紐付けできません。");
  if (sub && main && links.some((link) => link.subRouteId === sub.id && link.mainRouteId === main.id)) {
    issues.push("同じ紐付けがすでに存在します。");
  }
  return issues;
}
