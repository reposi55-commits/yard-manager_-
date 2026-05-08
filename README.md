# YardManager Phase 1

React + TypeScript + Firebaseで作成した、トラックヤード管理アプリのPhase 1 MVPです。

## 技術構成

- React
- TypeScript
- Vite
- Firebase Authentication
- Cloud Firestore
- Firebase Hosting

Phase 1ではCloud Functions、Excel取込、Excel出力、テンプレート生成、ダッシュボード、実績分析は実装していません。

## 実装済み機能

- Firebase Authenticationによるログイン
- `users`コレクションによる管理者/一般ユーザー判定
- 対象日選択
- ステーション管理
- レーン管理
- 作業員管理
- 便管理
- タスク管理
- サブ便とメイン便の紐付け管理
- ドライバー画面のステーション別ガント
- 作業員スマホ画面の作業カード一覧
- 作業開始/作業完了
- 実績時刻の記録
- `operationLogs`への操作履歴記録
- 操作履歴タブ

## ローカル起動

```powershell
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

`.env.local`にはFirebase ConsoleのWebアプリ設定を入力してください。

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=new-yard-kanri
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_DEFAULT_SITE_ID=demo-site
```

## 初期ユーザー

Authenticationでユーザーを作成したあと、Firestoreの`users/{uid}`にドキュメントを作成します。

管理者例:

```json
{
  "siteId": "demo-site",
  "businessDate": "global",
  "email": "admin@example.com",
  "displayName": "管理者",
  "role": "admin",
  "active": true,
  "createdAt": null,
  "createdBy": "system",
  "updatedAt": null,
  "updatedBy": "system",
  "deleted": false
}
```

一般ユーザー例:

```json
{
  "siteId": "demo-site",
  "businessDate": "global",
  "email": "worker@example.com",
  "displayName": "作業員A",
  "role": "user",
  "active": true,
  "workerId": "workersのドキュメントID",
  "createdAt": null,
  "createdBy": "system",
  "updatedAt": null,
  "updatedBy": "system",
  "deleted": false
}
```

`workerId`には作業員名ではなく、`workers`コレクションのドキュメントIDを設定します。

## 確認コマンド

```powershell
npm.cmd run lint
npm.cmd run build
```

`build`が成功すると、公開用ファイルが`dist`に生成されます。

## Firebase Hosting公開

ログイン:

```powershell
npx.cmd firebase-tools login
```

Hosting、Firestore Rules、Firestore Indexesをまとめて反映:

```powershell
npm.cmd run deploy
```

Hostingだけ反映:

```powershell
npm.cmd run deploy:hosting
```

## 公開後チェックリスト

1. 公開URLでログイン画面が表示される
2. 管理者でログインできる
3. 管理メニューが表示される
4. ステーション、レーン、作業員を登録できる
5. 便とタスクを登録できる
6. 一般ユーザーでログインできる
7. 自分の作業カードだけが表示される
8. 作業開始で`actualStartAt`が記録される
9. 作業完了で`actualEndAt`が記録される
10. 未完了に戻しても実績時刻が削除されない
11. 操作履歴タブに`operationLogs`が表示される
12. スマホ幅で横スクロール前提になっていない

## Phase 2候補

- Excel取込
- Excel出力
- ダイヤテンプレート生成
- ダッシュボード
- 実績分析
- 入力フォームのモーダル化/入力補助強化
- Firestore Rulesのより細かい権限制御
