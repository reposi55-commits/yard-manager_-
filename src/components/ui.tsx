import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import type { RouteStatus, TaskStatus } from "../types";
import { getRouteStatusTone, getTaskStatusTone, routeStatusLabels, taskStatusLabels, type StatusTone } from "../utils/status";

type ButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>;

function Button({ children, className = "", ...props }: ButtonProps & { className?: string }) {
  return (
    <button className={`btn ${className}`} {...props}>
      {children}
    </button>
  );
}

export function PrimaryButton(props: ButtonProps) {
  return <Button className="btn-primary" {...props} />;
}

export function SecondaryButton(props: ButtonProps) {
  return <Button className="btn-secondary" {...props} />;
}

export function DangerButton(props: ButtonProps) {
  return <Button className="btn-danger" {...props} />;
}

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Modal({
  title,
  children,
  onClose,
  footer,
}: PropsWithChildren<{ title: string; onClose: () => void; footer?: ReactNode }>) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function StatusBadge({
  type,
  status,
  blocked = false,
  label,
}: {
  type: "route" | "task";
  status: RouteStatus | TaskStatus;
  blocked?: boolean;
  label?: string;
}) {
  const tone: StatusTone = type === "route" ? getRouteStatusTone(status as RouteStatus) : getTaskStatusTone(status as TaskStatus, blocked);
  const text = label || (type === "route" ? routeStatusLabels[status as RouteStatus] : taskStatusLabels[status as TaskStatus]);
  return <span className={`status status-${tone}`}>{text}</span>;
}

export function DateSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="date-selector">
      <span>対象日</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function Field({ label, children }: PropsWithChildren<{ label: string }>) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

export function FormCheckPanel({ issues, warnings }: { issues: string[]; warnings: string[] }) {
  const ok = issues.length === 0 && warnings.length === 0;
  const tone = issues.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok";

  return (
    <div className={`form-check-panel ${tone}`}>
      <strong>保存前チェック</strong>
      {ok ? <p>入力内容に問題は見つかりません。</p> : null}
      {issues.length > 0 ? (
        <ul>
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <ul>
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
