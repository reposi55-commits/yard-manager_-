import type { Timestamp } from "firebase/firestore";

export type UserRole = "admin" | "user";
export type RouteStatus = "waiting" | "in_progress" | "completed";
export type TaskStatus = "pending" | "ready" | "in_progress" | "completed";
export type RouteType = "main" | "sub";
export type LogTargetType = "station" | "lane" | "worker" | "route" | "task" | "routeLink";
export type LogAction = "create" | "update" | "delete" | "status_change";

export type FirestoreDate = Timestamp | null;

export interface BaseRecord {
  id: string;
  siteId: string;
  businessDate: string;
  createdAt: FirestoreDate;
  createdBy: string;
  updatedAt: FirestoreDate;
  updatedBy: string;
  deleted?: boolean;
  deletedAt?: FirestoreDate;
  deletedBy?: string;
}

export interface AppUser extends BaseRecord {
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  workerId?: string;
}

export interface Station extends BaseRecord {
  name: string;
  area: string;
  sortOrder: number;
  active: boolean;
}

export interface Lane extends BaseRecord {
  name: string;
  area: string;
  adjacentLaneIds: string[];
  sortOrder: number;
  active: boolean;
}

export interface Worker extends BaseRecord {
  name: string;
  displayName: string;
  active: boolean;
}

export interface Route extends BaseRecord {
  type: RouteType;
  routeName: string;
  flightNumber: string;
  stationId: string;
  stationName: string;
  plannedStartLabel: string;
  plannedEndLabel: string;
  plannedStartOffsetMin: number;
  plannedEndOffsetMin: number;
  status: RouteStatus;
  actualStartAt?: FirestoreDate;
  actualEndAt?: FirestoreDate;
}

export interface Task extends BaseRecord {
  taskName: string;
  workerId: string;
  workerName: string;
  laneId: string;
  laneName: string;
  targetMainRouteId: string;
  targetMainRouteName: string;
  targetMainFlightNumber: string;
  instruction: string;
  plannedStartLabel: string;
  plannedEndLabel: string;
  plannedStartOffsetMin: number;
  plannedEndOffsetMin: number;
  status: TaskStatus;
  actualStartAt?: FirestoreDate;
  actualEndAt?: FirestoreDate;
}

export interface RouteLink extends BaseRecord {
  subRouteId: string;
  subRouteName: string;
  subFlightNumber: string;
  mainRouteId: string;
  mainRouteName: string;
  mainFlightNumber: string;
}

export interface OperationLog {
  id: string;
  siteId: string;
  businessDate: string;
  targetType: LogTargetType;
  targetId: string;
  targetLabel?: string;
  action: LogAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  operatedAt: FirestoreDate;
  operatedBy: string;
}

export type EntityMap = {
  stations: Station;
  lanes: Lane;
  workers: Worker;
  routes: Route;
  tasks: Task;
  routeLinks: RouteLink;
};
