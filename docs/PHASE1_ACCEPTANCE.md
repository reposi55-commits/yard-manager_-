# Phase 1受入確認

確認日: 2026-05-09

## 判定

Phase 1は、機能実装としてはPhase 2へ進める状態です。

ただし、最終判定はユーザー側PowerShellでのビルド・デプロイ確認と、Firebase上の一般ユーザー実ログイン確認を通したあとにしてください。

## 確認結果

| 区分 | 確認内容 | 判定 | 補足 |
| --- | --- | --- | --- |
| 型チェック | `npm.cmd run lint` | OK | TypeScriptエラーなし |
| ビルド | `npm.cmd run build` | 要ユーザー確認 | Codex側ではフォルダアクセス制限でViteが停止。ユーザー側PowerShellで確認する |
| デプロイ | `npm.cmd run deploy` | 要ユーザー確認 | Firebase認証情報とネットワークが必要 |
| 認証 | `users/{uid}`による管理者/一般ユーザー判定 | OK | `useAuthUser`でmissing/inactive/invalid userをエラー表示 |
| ユーザー管理 | UID、メール、表示名、権限、有効/無効、`workerId`紐付け | OK | `UserManagement`で実装済み |
| マスタ管理 | ステーション、レーン、作業員 | OK | 作成、更新、論理削除を実装済み |
| 計画管理 | 便、タスク、サブ便/メイン便紐付け | OK | 対象日別、検索・絞り込み、重複/時間かぶり警告あり |
| ドライバー画面 | ステーション別ガント、便の開始/完了/戻し | OK | 実績時刻を一覧・詳細に表示 |
| 作業員画面 | 自分のタスクだけカード表示 | OK | `workerId`で購読し、前工程待ち判定あり |
| 作業実績 | 開始/完了で`actualStartAt`/`actualEndAt`記録 | OK | 未完了に戻しても実績時刻は保持 |
| 操作履歴 | `operationLogs`記録、検索・絞り込み、targetLabel | OK | 管理者操作と作業員ステータス変更を記録 |
| Firestore Rules | 一般ユーザーの計画編集禁止、自分のタスクだけ更新 | OK | Rulesで制限済み |
| Firestore Rules | 物理削除禁止 | OK | app collections、users、operationLogsでdelete禁止 |
| 画面確認 | 公開URLでの管理者ログイン後操作 | OK | Codexアプリ内ブラウザで管理者ログイン後の全メニュー表示を確認。ブラウザエラー/警告なし |
| 画面確認 | 公開URLでの一般ユーザーログイン | OK | Edgeで一般ユーザーのログイン成功を確認。Codexアプリ内ブラウザではFirebase Auth通信が`auth/network-request-failed`で停止 |
| 画面確認 | 公開URLでの作業カード操作 | OK | Edgeで作業カード表示と操作が機能することを確認 |

## ユーザー側で行う最終確認

```powershell
npm.cmd run build
npm.cmd run deploy
```

公開URLで以下を確認します。

1. 管理者でログインできる
2. ユーザー管理で一般ユーザーに作業員を紐付けできる
3. 便、タスク、紐付けを登録できる
4. 一般ユーザーでログインすると自分の作業カードだけ表示される
5. 作業開始、作業完了、未完了戻しができる
6. 操作履歴に対象名と変更内容が表示される
7. 一般ユーザーで計画データを編集しようとすると拒否される

## Phase 2へ進める条件

次の条件を満たせばPhase 2へ移行できます。

- ユーザー側PowerShellでビルドが成功する
- Firebaseへ最新RulesとHostingをデプロイできる
- 一般ユーザーの作業カード操作確認が完了する
- READMEのPhase 1確認シナリオに重大なNGが残っていない

2026-05-09時点では、管理者画面と一般ユーザーの作業カード操作まで確認済みです。ユーザー側PowerShellでビルド・デプロイが通っている状態であれば、Phase 2へ進んで問題ありません。

小さな文言調整や見た目の微修正だけであれば、Phase 2へ進んで問題ありません。
