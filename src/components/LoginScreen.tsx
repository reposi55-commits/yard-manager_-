import { FormEvent, useState } from "react";
import { firebaseConfigError } from "../lib/firebase";
import { Card, Field, PrimaryButton } from "./ui";

export function LoginScreen({ error, loading, onLogin }: { error: string; loading: boolean; onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin(email, password);
  }

  return (
    <div className="login-page">
      <Card className="login-card">
        <p className="eyebrow">YardManager Phase 2</p>
        <h1>ログイン</h1>
        <form onSubmit={handleSubmit} className="form-stack">
          <Field label="メールアドレス">
            <input type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label="パスワード">
            <input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required />
          </Field>
          {firebaseConfigError ? <p className="alert">{firebaseConfigError}</p> : null}
          {error ? <p className="alert">{error}</p> : null}
          <PrimaryButton type="submit" disabled={loading || Boolean(firebaseConfigError)}>
            {loading ? "確認中..." : "ログイン"}
          </PrimaryButton>
        </form>
      </Card>
    </div>
  );
}
