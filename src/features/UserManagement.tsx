import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, Field, Modal, PrimaryButton, SecondaryButton } from "../components/ui";
import { createAppUserProfile, subscribeMasters, subscribeUsers, updateAppUserProfile } from "../services/firestoreService";
import type { AppUser, UserRole, Worker } from "../types";

type UserDraft = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  workerId: string;
};

const emptyDraft: UserDraft = {
  uid: "",
  email: "",
  displayName: "",
  role: "user",
  active: true,
  workerId: "",
};

const roleLabels: Record<UserRole, string> = {
  admin: "管理者",
  user: "一般ユーザー",
};

export function UserManagement({ user }: { user: AppUser }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeUsers(user.siteId, setUsers, setError), [user.siteId]);
  useEffect(() => subscribeMasters("workers", user.siteId, setWorkers, setError), [user.siteId]);

  const filteredUsers = useMemo(
    () =>
      users.filter((item) => {
        const keyword = searchText.trim().toLowerCase();
        const worker = workers.find((workerItem) => workerItem.id === item.workerId);
        const matchesRole = roleFilter === "all" || item.role === roleFilter;
        const matchesKeyword =
          !keyword ||
          [item.id, item.email, item.displayName, roleLabels[item.role], worker?.displayName, worker?.name]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(keyword));
        return matchesRole && matchesKeyword;
      }),
    [users, workers, searchText, roleFilter],
  );

  function startCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setOpen(true);
  }

  function startEdit(item: AppUser) {
    setEditing(item);
    setDraft({
      uid: item.id,
      email: item.email,
      displayName: item.displayName,
      role: item.role,
      active: item.active,
      workerId: item.workerId || "",
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
    setDraft(emptyDraft);
  }

  async function save() {
    const payload = {
      email: draft.email.trim(),
      displayName: draft.displayName.trim(),
      role: draft.role,
      active: draft.active,
      workerId: draft.role === "user" ? draft.workerId : "",
    };
    const uid = draft.uid.trim();

    if (!editing && !uid) {
      window.alert("AuthenticationのUIDを入力してください。");
      return;
    }
    if (!payload.email || !payload.displayName) {
      window.alert("メールアドレスと表示名は必須です。");
      return;
    }
    if (payload.role === "user" && !payload.workerId) {
      window.alert("一般ユーザーには作業員を紐付けてください。");
      return;
    }
    if (editing?.id === user.id && (payload.role !== "admin" || !payload.active)) {
      window.alert("ログイン中の管理者を無効化したり、一般ユーザーへ変更したりすることはできません。");
      return;
    }

    try {
      if (editing) {
        await updateAppUserProfile(editing, payload, user);
      } else {
        await createAppUserProfile(uid, { ...payload, siteId: user.siteId }, user);
      }
      closeModal();
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "ユーザー情報の保存に失敗しました。");
    }
  }

  function workerName(workerId?: string): string {
    if (!workerId) return "-";
    const worker = workers.find((item) => item.id === workerId);
    return worker ? `${worker.displayName || worker.name} (${worker.id})` : workerId;
  }

  return (
    <Card>
      <div className="section-header">
        <div>
          <p className="eyebrow">Users</p>
          <h2>ユーザー管理</h2>
        </div>
        <PrimaryButton type="button" onClick={startCreate}>ユーザー設定を追加</PrimaryButton>
      </div>
      <p className="helper-text">
        Authenticationで作成済みのユーザーUIDに対して、YardManager側の権限と作業員紐付けを登録します。
      </p>
      {error ? <p className="alert">{error}</p> : null}
      <div className="filter-bar">
        <Field label="検索">
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="UID・メール・表示名・作業員" />
        </Field>
        <Field label="権限">
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | UserRole)}>
            <option value="all">すべて</option>
            <option value="admin">管理者</option>
            <option value="user">一般ユーザー</option>
          </select>
        </Field>
      </div>
      {users.length === 0 ? <EmptyState message="ユーザー設定がまだありません。" /> : null}
      {users.length > 0 && filteredUsers.length === 0 ? <EmptyState message="条件に一致するユーザーがありません。" /> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>UID</th>
              <th>表示名</th>
              <th>メール</th>
              <th>権限</th>
              <th>作業員紐付け</th>
              <th>状態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((item) => (
              <tr key={item.id}>
                <td><code>{item.id}</code></td>
                <td>{item.displayName}</td>
                <td>{item.email}</td>
                <td>{roleLabels[item.role]}</td>
                <td>{workerName(item.workerId)}</td>
                <td>{item.active ? "有効" : "無効"}</td>
                <td className="table-actions">
                  <SecondaryButton type="button" onClick={() => startEdit(item)}>編集</SecondaryButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <Modal title={editing ? "ユーザー設定を編集" : "ユーザー設定を追加"} onClose={closeModal}>
          <div className="form-grid">
            <Field label="Authentication UID">
              <input value={draft.uid} disabled={Boolean(editing)} onChange={(event) => setDraft({ ...draft, uid: event.target.value })} />
            </Field>
            <Field label="メールアドレス">
              <input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
            </Field>
            <Field label="表示名">
              <input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
            </Field>
            <Field label="権限">
              <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as UserRole })}>
                <option value="admin">管理者</option>
                <option value="user">一般ユーザー</option>
              </select>
            </Field>
            <Field label="作業員紐付け">
              <select
                value={draft.workerId}
                disabled={draft.role === "admin"}
                onChange={(event) => setDraft({ ...draft, workerId: event.target.value })}
              >
                <option value="">未設定</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>{worker.displayName || worker.name}</option>
                ))}
              </select>
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
              有効
            </label>
            <div className="form-actions">
              <PrimaryButton type="button" onClick={save}>{editing ? "更新" : "追加"}</PrimaryButton>
              <SecondaryButton type="button" onClick={closeModal}>キャンセル</SecondaryButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}
