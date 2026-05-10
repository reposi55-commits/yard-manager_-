# YardManager

React + TypeScript + Firebaseで作成した、トラックヤード管理アプリです。

## 技術構成

- React
- TypeScript
- Vite
- Firebase Authentication
- Cloud Firestore
- Firebase Hosting

Phase 1では、Cloud Functions、Excel取込、Excel出力、テンプレート生成、ダッシュボード、実績分析は対象外でした。
Phase 2では、Phase 1の運用基盤を保ったまま、ダッシュボード、Excel入出力、実績分析などを段階的に追加します。

## 実装済み機能

- Firebase Authenticationによるログイン
- `users`コレクションによる管理者・一般ユーザー判定
- ユーザー管理と作業員`workerId`紐付け
- 対象日選択
- ステーション管理
- レーン管理
- 作業員管理
- 便管理
- タスク管理
- サブ便とメイン便の紐付け
- ドライバー画面のステーション別ガント
- 作業員スマホ画面のカードUI
- 作業開始、作業完了、未完了への戻し
- `actualStartAt`、`actualEndAt`の記録
- `operationLogs`への操作履歴記録
- 操作履歴の検索・絞り込み
- 便・タスクの検索・絞り込み
- 削除確認
- 重複・時間かぶり警告
- Firestore Security Rulesによる権限制御
- Phase 2ダッシュボード
- Phase 2 CSV出力
- Phase 2 CSV取込
- Phase 2実績分析
- 過去データ確認
- Phase 2ダイヤテンプレート
- Phase 2入力改善
- Firestore Rules自動テスト

## Phase 1機能整理

Phase 1では、日々のヤード作業をブラウザ上で登録・確認・実績更新できることをゴールにします。

| 区分 | Phase 1で扱う機能 | 状態 |
| --- | --- | --- |
| 認証・権限 | ログイン、管理者/一般ユーザー判定、有効/無効、`workerId`紐付け | 実装済み |
| マスタ | ステーション、レーン、作業員、ユーザー設定 | 実装済み |
| 計画 | 便、タスク、サブ便/メイン便紐付け、対象日切替 | 実装済み |
| 現場操作 | 作業員カード、前工程待ち、開始、完了、未完了戻し | 実装済み |
| 実績 | `actualStartAt`、`actualEndAt`、一覧表示 | 実装済み |
| 履歴 | 操作履歴、対象ラベル、検索・絞り込み | 実装済み |
| セキュリティ | 一般ユーザーの計画編集禁止、自分のタスクだけ更新、物理削除禁止 | 実装済み |
| 確認 | 権限別の手動確認、スマホ幅表示確認、本番デプロイ確認 | 実施対象 |

Phase 1完了の判断は、`Phase 1確認シナリオ`を一通り通し、管理者・一般ユーザーの両方で想定通り操作できることを基準にします。

## Phase 2機能整理

Phase 2では、日々の運用状況を見やすくし、入力・出力・分析を効率化することをゴールにします。

| 区分 | Phase 2で扱う機能 | 状態 |
| --- | --- | --- |
| ダッシュボード | 当日の便・タスク進捗、前工程待ち、作業員別/ステーション別進捗 | 実装済み |
| CSV/Excel出力 | 当日計画・実績・操作履歴のCSV出力 | 実装済み |
| Excel取込 | 便・タスク計画のCSV取込 | 新規登録・判定改善まで実装済み |
| ダイヤテンプレート | 定型便・定型タスクの生成 | 実装済み |
| 実績分析 | 作業時間、遅れ、完了率の集計 | 実装済み |
| 過去データ確認 | 対象期間の日別件数と履歴件数の確認 | 実装済み |
| 入力改善 | フォームの使いやすさ、入力バリデーション強化 | 主要フォーム実装済み |
| テスト | Firestore Rulesの自動テスト | 代表シナリオ実装済み |

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

## 初期ユーザー設定

Authenticationでユーザーを作成したあと、Firestoreの`users/{uid}`に同じUIDでドキュメントを作成します。

管理者ユーザー例:

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
  "workerId": "workersコレクションのドキュメントID",
  "createdAt": null,
  "createdBy": "system",
  "updatedAt": null,
  "updatedBy": "system",
  "deleted": false
}
```

`workerId`には作業員名ではなく、`workers`コレクションのドキュメントIDを設定します。

管理者ログイン後は、アプリの「ユーザー管理」画面から`users/{uid}`を追加・編集できます。Authenticationユーザー自体の作成はFirebase Consoleで行い、発行されたUIDを「ユーザー管理」に登録してください。

## 権限設計

- 管理者は同じ`siteId`のマスタ、便、タスク、紐付け、操作履歴を扱えます。
- 一般ユーザーは自分の`workerId`に紐づくタスクだけを読み取り・ステータス更新できます。
- 一般ユーザーは便、マスタ、タスク計画、紐付けを作成・編集・削除できません。
- 一般ユーザーが作成できる操作履歴は、自分のタスクのステータス変更ログだけです。
- 物理削除はRulesで禁止し、アプリでは`deleted: true`による論理削除を使います。

## 確認コマンド

```powershell
npm.cmd run lint
npm.cmd run build
```

`build`が成功すると、公開用ファイルが`dist`に生成されます。

Firestore Security Rulesの自動テスト:

```powershell
npm.cmd run test:rules
```

`test:rules`はFirestore Emulatorを使うため、Javaが必要です。Javaが入っていない環境では、`Could not spawn java -version` で停止します。

Codex環境では`npm.cmd run build`が`spawn EPERM`で止まる場合があります。ユーザー側PowerShellで成功している場合は、その結果を優先してください。

## サンプルデータ投入

表示確認用に、ステーション、レーン、作業員、便、タスク、便の紐付けをまとめて投入できます。

投入される件数:

- ステーション: 5件
- レーン: 6件
- 作業員: 8件
- 便: 7件
- サブ便とメイン便の紐付け: 2件
- タスク: 7件

同じ固定IDのサンプルへ投入するため、同じスクリプトを複数回実行しても二重登録されません。既に同じIDのサンプルがある場合は、サンプル内容で上書きされます。

PowerShellで管理者ユーザーのメールアドレスとパスワードを一時的に設定してから実行してください。

```powershell
$env:SEED_ADMIN_EMAIL="admin@example.com"
$env:SEED_ADMIN_PASSWORD="管理者パスワード"
npm.cmd run seed:demo
```

別の`siteId`へ投入したい場合:

```powershell
$env:SEED_SITE_ID="demo-site"
npm.cmd run seed:demo
```

`SEED_SITE_ID`を指定する場合は、ログインする管理者ユーザーの`users/{uid}.siteId`と同じ値にしてください。Firestore Rulesにより、管理者でも別`siteId`のデータ作成は拒否されます。

別の日付へ便・タスクを投入したい場合:

```powershell
$env:SEED_BUSINESS_DATE="2026-05-09"
npm.cmd run seed:demo
```

`SEED_BUSINESS_DATE`を指定しない場合は、アプリと同じく現在時刻から対象日を自動判定します。5:00前に実行した場合は前日扱いです。

## Firebase公開

Firebase CLIへログイン:

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

Firestore Security Rulesだけ反映:

```powershell
npm.cmd run deploy:rules
```

PowerShellで`firebase deploy --only hosting`を直接実行して`firebase.ps1`の実行ポリシーエラーが出る場合は、`.cmd`版を使ってください。

```powershell
firebase.cmd deploy --only hosting
```

## Phase 1確認シナリオ

### 1. ログイン・権限

1. 公開URLでログイン画面が表示される
2. 管理者でログインできる
3. 管理者メニューが表示される
4. 一般ユーザーでログインできる
5. 一般ユーザーには作業員画面だけが表示される
6. `active: false`のユーザーは利用できない
7. `users/{uid}`がないユーザーは利用できない

### 2. 管理者操作

1. ステーションを登録・編集・削除できる
2. レーンを登録・編集・削除できる
3. 作業員を登録・編集・削除できる
4. ユーザー設定を追加・編集し、一般ユーザーへ作業員を紐付けできる
5. 便を登録・編集・削除できる
6. タスクを登録・編集・削除できる
7. サブ便とメイン便を紐付け・解除できる
8. 同じ便番号や時間かぶりの警告が表示される
9. 実績時刻がある便・タスクを削除しても、実績情報は履歴として残る

### 3. 作業員操作

1. 自分に割り当てられたタスクだけが表示される
2. 他の作業員のタスクは表示されない
3. 前工程のサブ便が未完了の場合、該当タスクは開始できない
4. 作業開始で`status`が`in_progress`になり、`actualStartAt`が記録される
5. 作業完了で`status`が`completed`になり、`actualEndAt`が記録される
6. 未完了に戻しても、記録済みの実績時刻は削除されない
7. 操作後に`operationLogs`へ履歴が記録される

### 4. Firestore Security Rules

1. 一般ユーザーは便を作成・編集・削除できない
2. 一般ユーザーはマスタを作成・編集・削除できない
3. 一般ユーザーはタスク計画の担当者、予定時刻、対象便などを変更できない
4. 一般ユーザーは自分のタスクのステータスだけ更新できる
5. 一般ユーザーは他の作業員のタスクを読み取り・更新できない
6. 管理者でも別`siteId`のデータは扱えない
7. `operationLogs`は更新・削除できない

### 5. 表示・操作性

1. スマホ幅で作業員カードが横スクロール前提になっていない
2. 主要ボタンがタップしやすいサイズで表示される
3. ステータス表示に日本語ラベルが含まれる
4. 対象日を変更すると、その日の便・タスク・履歴へ切り替わる
5. 検索・絞り込みで目的の便、タスク、操作履歴を探せる

## Phase 2仕上げ確認

Phase 2の受入確認は、次のドキュメントを基準に行います。

- [Phase 2受入確認](docs/PHASE2_ACCEPTANCE.md)
- [Phase 2受入確認結果](docs/PHASE2_ACCEPTANCE_RESULT.md)
- [Phase 2残り確認チェックリスト](docs/PHASE2_REMAINING_CHECKS.md)
- [YardManager本番運用手順書](docs/OPERATION_MANUAL.md)
- [データ保管・過去データ運用方針](docs/DATA_RETENTION_POLICY.md)

ローカルで確認する場合:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:rules
```

`test:rules`はFirestore Emulatorを使うためJavaが必要です。

## 次フェーズ候補

詳しい優先度と判断ポイントは、[Phase 3候補整理](docs/PHASE3_CANDIDATES.md)にまとめています。

- 既存データを上書きするCSV取込モード
- 本格的なExcel `.xlsx` 出力
- ダッシュボード/分析の期間比較
- 無料枠向けデータ保管・アーカイブ方針
- 大規模データ向けのページング
- CI環境でのRules自動テスト実行
