import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  Timestamp,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

const BUSINESS_DAY_START_HOUR = 5;
const MASTER_BUSINESS_DATE = "global";

const stations = [
  { id: "sample-station-north-01", name: "北ヤード 1番", area: "北ヤード", sortOrder: 10, active: true },
  { id: "sample-station-north-02", name: "北ヤード 2番", area: "北ヤード", sortOrder: 20, active: true },
  { id: "sample-station-south-01", name: "南ドック A", area: "南ドック", sortOrder: 30, active: true },
  { id: "sample-station-south-02", name: "南ドック B", area: "南ドック", sortOrder: 40, active: true },
  { id: "sample-station-hold-01", name: "保留スペース", area: "一時待機", sortOrder: 90, active: false },
];

const lanes = [
  { id: "sample-lane-a01", name: "A-01", area: "入庫レーン", adjacentLaneIds: ["sample-lane-a02"], sortOrder: 10, active: true },
  { id: "sample-lane-a02", name: "A-02", area: "入庫レーン", adjacentLaneIds: ["sample-lane-a01", "sample-lane-b01"], sortOrder: 20, active: true },
  { id: "sample-lane-b01", name: "B-01", area: "仕分けレーン", adjacentLaneIds: ["sample-lane-a02", "sample-lane-b02"], sortOrder: 30, active: true },
  { id: "sample-lane-b02", name: "B-02", area: "仕分けレーン", adjacentLaneIds: ["sample-lane-b01"], sortOrder: 40, active: true },
  { id: "sample-lane-c01", name: "C-01", area: "出庫レーン", adjacentLaneIds: [], sortOrder: 50, active: true },
  { id: "sample-lane-maintenance", name: "整備待ち", area: "予備", adjacentLaneIds: [], sortOrder: 90, active: false },
];

const workers = [
  { id: "sample-worker-aoki", name: "青木 太郎", displayName: "青木", active: true },
  { id: "sample-worker-sato", name: "佐藤 花子", displayName: "佐藤", active: true },
  { id: "sample-worker-tanaka", name: "田中 一郎", displayName: "田中", active: true },
  { id: "sample-worker-suzuki", name: "鈴木 美咲", displayName: "鈴木", active: true },
  { id: "sample-worker-yamada", name: "山田 健", displayName: "山田", active: true },
  { id: "sample-worker-kobayashi", name: "小林 翔", displayName: "小林", active: true },
  { id: "sample-worker-night", name: "夜勤 応援", displayName: "夜勤応援", active: true },
  { id: "sample-worker-retired", name: "退職 サンプル", displayName: "退職者", active: false },
];

const firebaseConfigKeys = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

function buildRoutes(businessDate) {
  return [
    {
      id: "sample-route-main-001",
      type: "main",
      routeName: "札幌便 A",
      flightNumber: "M-1001",
      stationId: "sample-station-north-01",
      stationName: "北ヤード 1番",
      plannedStartLabel: "08:00",
      plannedEndLabel: "09:30",
      status: "waiting",
    },
    {
      id: "sample-route-main-002",
      type: "main",
      routeName: "東京便 B",
      flightNumber: "M-1002",
      stationId: "sample-station-north-02",
      stationName: "北ヤード 2番",
      plannedStartLabel: "09:00",
      plannedEndLabel: "10:30",
      status: "in_progress",
      actualStartAt: timestampFor(businessDate, "09:05"),
    },
    {
      id: "sample-route-main-003",
      type: "main",
      routeName: "大阪便 C",
      flightNumber: "M-1003",
      stationId: "sample-station-south-01",
      stationName: "南ドック A",
      plannedStartLabel: "10:30",
      plannedEndLabel: "12:00",
      status: "completed",
      actualStartAt: timestampFor(businessDate, "10:35"),
      actualEndAt: timestampFor(businessDate, "11:55"),
    },
    {
      id: "sample-route-main-004",
      type: "main",
      routeName: "名古屋便 D",
      flightNumber: "M-1004",
      stationId: "sample-station-south-02",
      stationName: "南ドック B",
      plannedStartLabel: "13:00",
      plannedEndLabel: "14:30",
      status: "waiting",
    },
    {
      id: "sample-route-main-005",
      type: "main",
      routeName: "深夜便 E",
      flightNumber: "M-1005",
      stationId: "sample-station-north-01",
      stationName: "北ヤード 1番",
      plannedStartLabel: "23:30",
      plannedEndLabel: "00:30",
      status: "waiting",
    },
    {
      id: "sample-route-sub-001",
      type: "sub",
      routeName: "札幌前工程",
      flightNumber: "S-2001",
      stationId: "sample-station-north-02",
      stationName: "北ヤード 2番",
      plannedStartLabel: "07:20",
      plannedEndLabel: "08:10",
      status: "completed",
      actualStartAt: timestampFor(businessDate, "07:18"),
      actualEndAt: timestampFor(businessDate, "08:05"),
    },
    {
      id: "sample-route-sub-002",
      type: "sub",
      routeName: "東京前工程",
      flightNumber: "S-2002",
      stationId: "sample-station-south-02",
      stationName: "南ドック B",
      plannedStartLabel: "08:30",
      plannedEndLabel: "09:20",
      status: "waiting",
    },
  ].map((route) => ({
    ...route,
    plannedStartOffsetMin: labelToOffsetMin(route.plannedStartLabel),
    plannedEndOffsetMin: labelToOffsetMin(route.plannedEndLabel),
  }));
}

const routeLinks = [
  {
    id: "sample-link-sub001-main001",
    subRouteId: "sample-route-sub-001",
    subRouteName: "札幌前工程",
    subFlightNumber: "S-2001",
    mainRouteId: "sample-route-main-001",
    mainRouteName: "札幌便 A",
    mainFlightNumber: "M-1001",
  },
  {
    id: "sample-link-sub002-main002",
    subRouteId: "sample-route-sub-002",
    subRouteName: "東京前工程",
    subFlightNumber: "S-2002",
    mainRouteId: "sample-route-main-002",
    mainRouteName: "東京便 B",
    mainFlightNumber: "M-1002",
  },
];

function buildTasks(businessDate) {
  return [
    {
      id: "sample-task-aoki-001",
      taskName: "入庫確認",
      workerId: "sample-worker-aoki",
      workerName: "青木",
      laneId: "sample-lane-a01",
      laneName: "A-01",
      targetMainRouteId: "sample-route-main-001",
      targetMainRouteName: "札幌便 A",
      targetMainFlightNumber: "M-1001",
      instruction: "到着後、荷台番号と封印番号を確認してください。",
      plannedStartLabel: "08:15",
      plannedEndLabel: "08:45",
      status: "ready",
    },
    {
      id: "sample-task-sato-001",
      taskName: "前工程待ち仕分け",
      workerId: "sample-worker-sato",
      workerName: "佐藤",
      laneId: "sample-lane-a02",
      laneName: "A-02",
      targetMainRouteId: "sample-route-main-002",
      targetMainRouteName: "東京便 B",
      targetMainFlightNumber: "M-1002",
      instruction: "サブ便完了後に開始してください。",
      plannedStartLabel: "09:15",
      plannedEndLabel: "09:45",
      status: "pending",
    },
    {
      id: "sample-task-tanaka-001",
      taskName: "積込作業",
      workerId: "sample-worker-tanaka",
      workerName: "田中",
      laneId: "sample-lane-b01",
      laneName: "B-01",
      targetMainRouteId: "sample-route-main-003",
      targetMainRouteName: "大阪便 C",
      targetMainFlightNumber: "M-1003",
      instruction: "重量物を先に積み込んでください。",
      plannedStartLabel: "10:40",
      plannedEndLabel: "11:20",
      status: "in_progress",
      actualStartAt: timestampFor(businessDate, "10:42"),
    },
    {
      id: "sample-task-suzuki-001",
      taskName: "完了確認",
      workerId: "sample-worker-suzuki",
      workerName: "鈴木",
      laneId: "sample-lane-b02",
      laneName: "B-02",
      targetMainRouteId: "sample-route-main-003",
      targetMainRouteName: "大阪便 C",
      targetMainFlightNumber: "M-1003",
      instruction: "写真記録後、完了にしてください。",
      plannedStartLabel: "11:20",
      plannedEndLabel: "11:50",
      status: "completed",
      actualStartAt: timestampFor(businessDate, "11:18"),
      actualEndAt: timestampFor(businessDate, "11:47"),
    },
    {
      id: "sample-task-yamada-001",
      taskName: "午後便準備",
      workerId: "sample-worker-yamada",
      workerName: "山田",
      laneId: "sample-lane-c01",
      laneName: "C-01",
      targetMainRouteId: "sample-route-main-004",
      targetMainRouteName: "名古屋便 D",
      targetMainFlightNumber: "M-1004",
      instruction: "14時までに空レーンを確保してください。",
      plannedStartLabel: "13:05",
      plannedEndLabel: "13:45",
      status: "pending",
    },
    {
      id: "sample-task-kobayashi-001",
      taskName: "長文指示の表示確認",
      workerId: "sample-worker-kobayashi",
      workerName: "小林",
      laneId: "sample-lane-a01",
      laneName: "A-01",
      targetMainRouteId: "sample-route-main-001",
      targetMainRouteName: "札幌便 A",
      targetMainFlightNumber: "M-1001",
      instruction: "作業カード内で長い補足指示が折り返されることを確認するためのサンプルです。無理に横スクロールさせず、スマホ幅でも読めることを見ます。",
      plannedStartLabel: "08:45",
      plannedEndLabel: "09:20",
      status: "ready",
    },
    {
      id: "sample-task-night-001",
      taskName: "深夜便チェック",
      workerId: "sample-worker-night",
      workerName: "夜勤応援",
      laneId: "sample-lane-c01",
      laneName: "C-01",
      targetMainRouteId: "sample-route-main-005",
      targetMainRouteName: "深夜便 E",
      targetMainFlightNumber: "M-1005",
      instruction: "日付またぎの表示確認用タスクです。",
      plannedStartLabel: "23:40",
      plannedEndLabel: "00:20",
      status: "pending",
    },
  ].map((task) => ({
    ...task,
    plannedStartOffsetMin: labelToOffsetMin(task.plannedStartLabel),
    plannedEndOffsetMin: labelToOffsetMin(task.plannedEndLabel),
  }));
}

function loadLocalEnv() {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = valueParts.join("=").trim();
    }
  }
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function getFirebaseConfig() {
  for (const key of firebaseConfigKeys) {
    getRequiredEnv(key);
  }

  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
}

function withBaseFields(item, userId, siteId, businessDate = MASTER_BUSINESS_DATE) {
  const { id, ...rest } = item;
  return {
    ...rest,
    siteId,
    businessDate,
    createdAt: serverTimestamp(),
    createdBy: userId,
    updatedAt: serverTimestamp(),
    updatedBy: userId,
    deleted: false,
  };
}

function upsertSampleDocuments({ db, batch, collectionName, items, userId, siteId, businessDate }) {
  for (const item of items) {
    const ref = doc(db, collectionName, item.id);
    const payload = withBaseFields(item, userId, siteId, businessDate);
    batch.set(ref, payload);
  }

  return items.length;
}

function getDefaultBusinessDate(now = new Date()) {
  const local = new Date(now);
  if (local.getHours() < BUSINESS_DAY_START_HOUR) {
    local.setDate(local.getDate() - 1);
  }
  return toDateInputValue(local);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function labelToOffsetMin(label) {
  const [hourText, minuteText] = label.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }
  const raw = hour * 60 + minute;
  const start = BUSINESS_DAY_START_HOUR * 60;
  return raw >= start ? raw - start : raw + 24 * 60 - start;
}

function timestampFor(businessDate, timeLabel) {
  const [hourText, minuteText] = timeLabel.split(":");
  const hour = Number(hourText);
  const dateText = hour < BUSINESS_DAY_START_HOUR ? addDays(businessDate, 1) : businessDate;
  return Timestamp.fromDate(new Date(`${dateText}T${hourText}:${minuteText}:00+09:00`));
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

async function main() {
  loadLocalEnv();

  const email = getRequiredEnv("SEED_ADMIN_EMAIL");
  const password = getRequiredEnv("SEED_ADMIN_PASSWORD");
  const app = initializeApp(getFirebaseConfig());
  const auth = getAuth(app);
  const db = getFirestore(app);

  const credential = await signInWithEmailAndPassword(auth, email, password);
  const userRef = doc(db, "users", credential.user.uid);
  const userSnapshot = await getDoc(userRef);

  if (!userSnapshot.exists()) {
    throw new Error(`users/${credential.user.uid} was not found.`);
  }

  const appUser = userSnapshot.data();
  if (appUser.active !== true || appUser.role !== "admin") {
    throw new Error("SEED_ADMIN_EMAIL must be an active admin user.");
  }

  const siteId = process.env.SEED_SITE_ID || appUser.siteId || process.env.VITE_DEFAULT_SITE_ID || "demo-site";
  if (siteId !== appUser.siteId) {
    throw new Error(`SEED_SITE_ID must match the admin user's siteId. requested=${siteId}, adminSiteId=${appUser.siteId}`);
  }

  const demoBusinessDate = process.env.SEED_BUSINESS_DATE || getDefaultBusinessDate();
  const batch = writeBatch(db);
  const upsertedCount =
    upsertSampleDocuments({ db, batch, collectionName: "stations", items: stations, userId: credential.user.uid, siteId, businessDate: MASTER_BUSINESS_DATE })
    + upsertSampleDocuments({ db, batch, collectionName: "lanes", items: lanes, userId: credential.user.uid, siteId, businessDate: MASTER_BUSINESS_DATE })
    + upsertSampleDocuments({ db, batch, collectionName: "workers", items: workers, userId: credential.user.uid, siteId, businessDate: MASTER_BUSINESS_DATE })
    + upsertSampleDocuments({ db, batch, collectionName: "routes", items: buildRoutes(demoBusinessDate), userId: credential.user.uid, siteId, businessDate: demoBusinessDate })
    + upsertSampleDocuments({ db, batch, collectionName: "routeLinks", items: routeLinks, userId: credential.user.uid, siteId, businessDate: demoBusinessDate })
    + upsertSampleDocuments({ db, batch, collectionName: "tasks", items: buildTasks(demoBusinessDate), userId: credential.user.uid, siteId, businessDate: demoBusinessDate });

  if (upsertedCount > 0) {
    await batch.commit();
  }

  console.log(`Seed completed. upserted=${upsertedCount}, siteId=${siteId}, businessDate=${demoBusinessDate}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
