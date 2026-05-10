import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";
import { db, MASTER_BUSINESS_DATE } from "../lib/firebase";
import type {
  AppUser,
  EntityMap,
  LogAction,
  LogTargetType,
  OperationLog,
  Route,
  RouteStatus,
  Task,
  TaskStatus,
} from "../types";

type CollectionName = keyof EntityMap;

const targetTypeByCollection: Record<CollectionName, LogTargetType> = {
  stations: "station",
  lanes: "lane",
  workers: "worker",
  routes: "route",
  tasks: "task",
  routeLinks: "routeLink",
  dialTemplates: "dialTemplate",
  templateRuns: "templateRun",
};

function buildTargetLabel(collectionName: CollectionName, value: Record<string, unknown>): string {
  if (collectionName === "stations") return String(value.name || "");
  if (collectionName === "lanes") return String(value.name || "");
  if (collectionName === "workers") return String(value.displayName || value.name || "");
  if (collectionName === "routes") {
    return [value.routeName, value.flightNumber].filter(Boolean).join(" / ");
  }
  if (collectionName === "tasks") {
    return [value.taskName, value.workerName].filter(Boolean).join(" / ");
  }
  if (collectionName === "routeLinks") {
    const sub = [value.subRouteName, value.subFlightNumber].filter(Boolean).join(" / ");
    const main = [value.mainRouteName, value.mainFlightNumber].filter(Boolean).join(" / ");
    return [sub, main].filter(Boolean).join(" → ");
  }
  if (collectionName === "dialTemplates") return String(value.name || "");
  if (collectionName === "templateRuns") return String(value.templateRunLabel || value.templateName || "");
  return "";
}

function buildUserTargetLabel(value: Pick<AppUser, "email" | "displayName">): string {
  return [value.displayName, value.email].filter(Boolean).join(" / ");
}

function clean<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function mapDocument<T>(id: string, data: DocumentData): T {
  return { id, ...data } as T;
}

export function subscribeCollection<T>(
  collectionName: string,
  constraints: QueryConstraint[],
  onData: (items: T[]) => void,
  onError: (message: string) => void,
  options: { includeDeleted?: boolean } = {},
): Unsubscribe {
  const ref = collection(db, collectionName);
  return onSnapshot(
    query(ref, ...constraints),
    (snapshot) => {
      const items = snapshot.docs
        .map((item) => mapDocument<T>(item.id, item.data()))
        .filter((item) => options.includeDeleted || !(item as { deleted?: boolean }).deleted);
      onData(items);
    },
    (error) => onError(error.message),
  );
}

export async function fetchCollectionOnce<T>(
  collectionName: string,
  constraints: QueryConstraint[],
  options: { includeDeleted?: boolean } = {},
): Promise<T[]> {
  const ref = collection(db, collectionName);
  const snapshot = await getDocs(query(ref, ...constraints));
  return snapshot.docs
    .map((item) => mapDocument<T>(item.id, item.data()))
    .filter((item) => options.includeDeleted || !(item as { deleted?: boolean }).deleted);
}

export function subscribeMasters<K extends "stations" | "lanes" | "workers">(
  collectionName: K,
  siteId: string,
  onData: (items: EntityMap[K][]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return subscribeCollection<EntityMap[K]>(
    collectionName,
    [where("siteId", "==", siteId)],
    (items) => {
      const sorted = [...items].sort((a, b) => {
        const aActive = "active" in a && a.active ? 0 : 1;
        const bActive = "active" in b && b.active ? 0 : 1;
        const aOrder = "sortOrder" in a ? Number(a.sortOrder) : 0;
        const bOrder = "sortOrder" in b ? Number(b.sortOrder) : 0;
        return aActive - bActive || aOrder - bOrder;
      });
      onData(sorted);
    },
    onError,
  );
}

export function subscribeDaily<K extends "routes" | "tasks" | "routeLinks">(
  collectionName: K,
  siteId: string,
  businessDate: string,
  onData: (items: EntityMap[K][]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return subscribeCollection<EntityMap[K]>(
    collectionName,
    [where("siteId", "==", siteId), where("businessDate", "==", businessDate)],
    onData,
    onError,
  );
}

export function subscribeWorkerTasks(
  siteId: string,
  businessDate: string,
  workerId: string,
  onData: (items: Task[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return subscribeCollection<Task>(
    "tasks",
    [where("siteId", "==", siteId), where("businessDate", "==", businessDate), where("workerId", "==", workerId)],
    onData,
    onError,
  );
}

export function subscribeUsers(
  siteId: string,
  onData: (items: AppUser[]) => void,
  onError: (message: string) => void,
): Unsubscribe {
  return subscribeCollection<AppUser>(
    "users",
    [where("siteId", "==", siteId)],
    (items) => {
      const sorted = [...items].sort((a, b) => {
        const activeOrder = Number(b.active) - Number(a.active);
        const roleOrder = a.role.localeCompare(b.role);
        const nameOrder = a.displayName.localeCompare(b.displayName);
        return activeOrder || roleOrder || nameOrder;
      });
      onData(sorted);
    },
    onError,
  );
}

export async function writeOperationLog(input: Omit<OperationLog, "id" | "operatedAt">): Promise<void> {
  await addDoc(collection(db, "operationLogs"), {
    ...input,
    operatedAt: Timestamp.now(),
  });
}

export async function createAppUserProfile(
  uid: string,
  data: Pick<AppUser, "email" | "displayName" | "role" | "active" | "workerId"> & { siteId: string },
  user: AppUser,
): Promise<void> {
  const now = Timestamp.now();
  const payload = clean({
    ...data,
    workerId: data.role === "user" ? data.workerId : undefined,
    businessDate: MASTER_BUSINESS_DATE,
    createdAt: now,
    createdBy: user.id,
    updatedAt: now,
    updatedBy: user.id,
    deleted: false,
  } as Record<string, unknown>);

  await setDoc(doc(db, "users", uid), payload);
  await writeOperationLog({
    siteId: data.siteId,
    businessDate: MASTER_BUSINESS_DATE,
    targetType: "user",
    targetId: uid,
    targetLabel: buildUserTargetLabel(data),
    action: "create",
    before: null,
    after: { id: uid, ...payload },
    operatedBy: user.id,
  });
}

export async function updateAppUserProfile(
  before: AppUser,
  patch: Pick<AppUser, "email" | "displayName" | "role" | "active" | "workerId">,
  user: AppUser,
): Promise<void> {
  const now = Timestamp.now();
  const afterData = clean({
    ...before,
    ...patch,
    workerId: patch.role === "user" ? patch.workerId : undefined,
    updatedAt: now,
    updatedBy: user.id,
  } as Record<string, unknown>);
  const updatePayload = clean({
    ...patch,
    workerId: patch.role === "user" ? patch.workerId : deleteField(),
    updatedAt: now,
    updatedBy: user.id,
  } as Record<string, unknown>);

  await updateDoc(doc(db, "users", before.id), updatePayload as Record<string, never>);
  await writeOperationLog({
    siteId: before.siteId,
    businessDate: MASTER_BUSINESS_DATE,
    targetType: "user",
    targetId: before.id,
    targetLabel: buildUserTargetLabel({
      email: String(afterData.email || ""),
      displayName: String(afterData.displayName || ""),
    }),
    action: "update",
    before: before as unknown as Record<string, unknown>,
    after: afterData,
    operatedBy: user.id,
  });
}

export async function createEntity<K extends CollectionName>(
  collectionName: K,
  data: Omit<EntityMap[K], "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "deleted">,
  user: AppUser,
  action: LogAction = "create",
): Promise<string> {
  const now = Timestamp.now();
  const payload = clean({
    ...data,
    createdAt: now,
    createdBy: user.id,
    updatedAt: now,
    updatedBy: user.id,
    deleted: false,
  } as Record<string, unknown>);
  const ref = await addDoc(collection(db, collectionName), payload);
  await writeOperationLog({
    siteId: String(payload.siteId),
    businessDate: String(payload.businessDate || MASTER_BUSINESS_DATE),
    targetType: targetTypeByCollection[collectionName],
    targetId: ref.id,
    targetLabel: buildTargetLabel(collectionName, payload),
    action,
    before: null,
    after: { id: ref.id, ...payload },
    operatedBy: user.id,
  });
  return ref.id;
}

export async function updateEntity<K extends CollectionName>(
  collectionName: K,
  before: EntityMap[K],
  patch: Partial<EntityMap[K]>,
  user: AppUser,
  action: LogAction = "update",
): Promise<void> {
  const updatePayload = clean({
    ...patch,
    updatedAt: Timestamp.now(),
    updatedBy: user.id,
  } as Record<string, unknown>);
  await updateDoc(doc(db, collectionName, before.id), updatePayload as Record<string, never>);
  const after = clean({ ...before, ...updatePayload } as Record<string, unknown>);
  await writeOperationLog({
    siteId: before.siteId,
    businessDate: before.businessDate || MASTER_BUSINESS_DATE,
    targetType: targetTypeByCollection[collectionName],
    targetId: before.id,
    targetLabel: buildTargetLabel(collectionName, after),
    action,
    before: before as unknown as Record<string, unknown>,
    after,
    operatedBy: user.id,
  });
}

export async function softDeleteEntity<K extends CollectionName>(collectionName: K, before: EntityMap[K], user: AppUser): Promise<void> {
  await updateEntity(collectionName, before, {
    deleted: true,
    deletedAt: Timestamp.now(),
    deletedBy: user.id,
  } as Partial<EntityMap[K]>, user, "delete");
}

export async function changeRouteStatus(route: Route, status: RouteStatus, user: AppUser): Promise<void> {
  const patch: Partial<Route> = { status };
  if (status === "in_progress" && !route.actualStartAt) {
    patch.actualStartAt = Timestamp.now();
  }
  if (status === "completed" && !route.actualEndAt) {
    patch.actualEndAt = Timestamp.now();
  }
  await updateEntity("routes", route, patch, user, "status_change");
}

export async function changeTaskStatus(task: Task, status: TaskStatus, user: AppUser): Promise<void> {
  const patch: Partial<Task> = { status };
  if (status === "in_progress" && !task.actualStartAt) {
    patch.actualStartAt = Timestamp.now();
  }
  if (status === "completed" && !task.actualEndAt) {
    patch.actualEndAt = Timestamp.now();
  }
  await updateEntity("tasks", task, patch, user, "status_change");
}
