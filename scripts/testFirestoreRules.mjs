import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const projectId = "yardmanager-rules-test";
const siteId = "demo-site";
const businessDate = "2026-05-10";
const rules = readFileSync("firestore.rules", "utf8");
const now = Timestamp.fromMillis(Date.UTC(2026, 4, 10, 9, 0, 0));

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules },
});

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function seedData() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "admin-user"), {
      active: true,
      businessDate: "global",
      createdAt: now,
      createdBy: "system",
      deleted: false,
      displayName: "管理者",
      email: "admin@example.com",
      role: "admin",
      siteId,
      updatedAt: now,
      updatedBy: "system",
    });
    await setDoc(doc(db, "users", "worker-user"), {
      active: true,
      businessDate: "global",
      createdAt: now,
      createdBy: "system",
      deleted: false,
      displayName: "作業員A",
      email: "worker@example.com",
      role: "user",
      siteId,
      updatedAt: now,
      updatedBy: "system",
      workerId: "worker-1",
    });
    await setDoc(doc(db, "users", "other-worker-user"), {
      active: true,
      businessDate: "global",
      createdAt: now,
      createdBy: "system",
      deleted: false,
      displayName: "作業員B",
      email: "worker2@example.com",
      role: "user",
      siteId,
      updatedAt: now,
      updatedBy: "system",
      workerId: "worker-2",
    });
    await setDoc(doc(db, "routes", "route-1"), {
      businessDate,
      createdAt: now,
      createdBy: "admin-user",
      deleted: false,
      flightNumber: "A-001",
      plannedEndLabel: "09:00",
      plannedEndOffsetMin: 240,
      plannedStartLabel: "08:00",
      plannedStartOffsetMin: 180,
      routeName: "A便",
      siteId,
      stationId: "station-1",
      stationName: "北ヤード",
      status: "waiting",
      type: "main",
      updatedAt: now,
      updatedBy: "admin-user",
    });
    await setDoc(doc(db, "tasks", "task-1"), {
      businessDate,
      createdAt: now,
      createdBy: "admin-user",
      deleted: false,
      instruction: "到着確認",
      laneId: "lane-1",
      laneName: "A-01",
      plannedEndLabel: "08:40",
      plannedEndOffsetMin: 220,
      plannedStartLabel: "08:10",
      plannedStartOffsetMin: 190,
      siteId,
      status: "pending",
      targetMainFlightNumber: "A-001",
      targetMainRouteId: "route-1",
      targetMainRouteName: "A便",
      taskName: "荷下ろし",
      updatedAt: now,
      updatedBy: "admin-user",
      workerId: "worker-1",
      workerName: "作業員A",
    });
    await setDoc(doc(db, "tasks", "task-2"), {
      businessDate,
      createdAt: now,
      createdBy: "admin-user",
      deleted: false,
      instruction: "検品",
      laneId: "lane-2",
      laneName: "B-01",
      plannedEndLabel: "09:30",
      plannedEndOffsetMin: 270,
      plannedStartLabel: "09:00",
      plannedStartOffsetMin: 240,
      siteId,
      status: "pending",
      targetMainFlightNumber: "A-001",
      targetMainRouteId: "route-1",
      targetMainRouteName: "A便",
      taskName: "検品",
      updatedAt: now,
      updatedBy: "admin-user",
      workerId: "worker-2",
      workerName: "作業員B",
    });
    await setDoc(doc(db, "dialTemplates", "template-1"), {
      active: true,
      businessDate: "global",
      createdAt: now,
      createdBy: "admin-user",
      deleted: false,
      description: "テスト用テンプレート",
      name: "標準テンプレート",
      routes: [],
      siteId,
      tasks: [],
      updatedAt: now,
      updatedBy: "admin-user",
    });
  });
}

function dbFor(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

test("未ログインユーザーは計画データを読めない", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "routes", "route-1")));
});

test("管理者は同一siteIdの計画データを作成できる", async () => {
  const db = dbFor("admin-user");
  await assertSucceeds(setDoc(doc(db, "stations", "station-new"), {
    active: true,
    area: "北",
    businessDate: "global",
    createdAt: now,
    createdBy: "admin-user",
    deleted: false,
    name: "北ヤード2",
    siteId,
    sortOrder: 2,
    updatedAt: now,
    updatedBy: "admin-user",
  }));
});

test("管理者は同一siteIdのダイヤテンプレートを作成できる", async () => {
  const db = dbFor("admin-user");
  await assertSucceeds(setDoc(doc(db, "dialTemplates", "template-new"), {
    active: true,
    businessDate: "global",
    createdAt: now,
    createdBy: "admin-user",
    deleted: false,
    description: "追加テンプレート",
    name: "追加テンプレート",
    routes: [],
    siteId,
    tasks: [],
    updatedAt: now,
    updatedBy: "admin-user",
  }));
});

test("一般ユーザーはダイヤテンプレートを読めない", async () => {
  const db = dbFor("worker-user");
  await assertFails(getDoc(doc(db, "dialTemplates", "template-1")));
});

test("管理者はテンプレート実行履歴を作成できる", async () => {
  const db = dbFor("admin-user");
  await assertSucceeds(setDoc(doc(db, "templateRuns", "template-run-1"), {
    businessDate: "global",
    createdAt: now,
    createdBy: "admin-user",
    days: 1,
    deleted: false,
    endDate: businessDate,
    mode: "create",
    routeCount: 1,
    siteId,
    startDate: businessDate,
    status: "completed",
    taskCount: 1,
    templateId: "template-1",
    templateName: "標準テンプレート",
    templateRunLabel: "標準テンプレート 2026-05-10 - 2026-05-10",
    updatedAt: now,
    updatedBy: "admin-user",
  }));
});

test("管理者でも別siteIdの計画データは作成できない", async () => {
  const db = dbFor("admin-user");
  await assertFails(setDoc(doc(db, "stations", "station-other-site"), {
    active: true,
    area: "別",
    businessDate: "global",
    createdAt: now,
    createdBy: "admin-user",
    deleted: false,
    name: "別サイト",
    siteId: "other-site",
    sortOrder: 1,
    updatedAt: now,
    updatedBy: "admin-user",
  }));
});

test("一般ユーザーは自分のタスクだけ読める", async () => {
  const db = dbFor("worker-user");
  await assertSucceeds(getDoc(doc(db, "tasks", "task-1")));
  await assertFails(getDoc(doc(db, "tasks", "task-2")));
});

test("一般ユーザーは計画内容を書き換えられない", async () => {
  const db = dbFor("worker-user");
  await assertFails(updateDoc(doc(db, "tasks", "task-1"), {
    taskName: "不正な変更",
    updatedAt: now,
    updatedBy: "worker-user",
  }));
});

test("一般ユーザーは自分のタスクの状態と実績時刻だけ更新できる", async () => {
  const db = dbFor("worker-user");
  await assertSucceeds(updateDoc(doc(db, "tasks", "task-1"), {
    actualStartAt: now,
    status: "in_progress",
    updatedAt: now,
    updatedBy: "worker-user",
  }));
  await assertFails(updateDoc(doc(db, "tasks", "task-2"), {
    actualStartAt: now,
    status: "in_progress",
    updatedAt: now,
    updatedBy: "worker-user",
  }));
});

test("一般ユーザーは自分のタスク状態変更ログだけ作成できる", async () => {
  const db = dbFor("worker-user");
  await updateDoc(doc(db, "tasks", "task-1"), {
    actualStartAt: now,
    status: "in_progress",
    updatedAt: now,
    updatedBy: "worker-user",
  });
  await assertSucceeds(addDoc(collection(db, "operationLogs"), {
    action: "status_change",
    after: {
      id: "task-1",
      siteId,
      status: "in_progress",
      workerId: "worker-1",
    },
    before: {
      id: "task-1",
      siteId,
      status: "pending",
      workerId: "worker-1",
    },
    businessDate,
    operatedAt: now,
    operatedBy: "worker-user",
    siteId,
    targetId: "task-1",
    targetLabel: "荷下ろし / 作業員A",
    targetType: "task",
  }));
  await assertFails(addDoc(collection(db, "operationLogs"), {
    action: "status_change",
    after: {
      id: "task-2",
      siteId,
      status: "in_progress",
      workerId: "worker-2",
    },
    before: {
      id: "task-2",
      siteId,
      status: "pending",
      workerId: "worker-2",
    },
    businessDate,
    operatedAt: now,
    operatedBy: "worker-user",
    siteId,
    targetId: "task-2",
    targetLabel: "検品 / 作業員B",
    targetType: "task",
  }));
});

let failed = 0;

try {
  for (const item of tests) {
    await seedData();
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${item.name}`);
      console.error(error);
    }
  }
} finally {
  await testEnv.cleanup();
}

assert.equal(failed, 0, `${failed} Firestore rules test(s) failed`);
console.log(`${tests.length} Firestore rules tests passed`);
