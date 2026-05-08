import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";
import type { AppUser } from "../types";

interface AuthState {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function toMessage(error: unknown): string {
  if (!(error instanceof Error)) return "予期しないエラーが発生しました。";
  if (error.message.includes("permission-denied")) {
    return "Firestoreのusers情報を読み取れません。users/{ログインUID}の作成とFirestore Rulesを確認してください。";
  }
  if (error.message.includes("auth/invalid-credential")) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }
  return error.message;
}

export function useAuthUser(): AuthState {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAppUser = useCallback(async (user: User | null) => {
    setFirebaseUser(user);
    setAppUser(null);

    if (!user) {
      setLoading(false);
      return;
    }

    setError("");

    try {
      const userSnapshot = await getDoc(doc(db, "users", user.uid));
      if (!userSnapshot.exists()) {
        setError(`users/${user.uid} が存在しません。AuthenticationのUIDと同じIDでusersドキュメントを作成してください。`);
        setLoading(false);
        return;
      }

      const loadedUser = { id: userSnapshot.id, ...userSnapshot.data() } as AppUser;
      if (loadedUser.active !== true) {
        setError("このユーザーはactiveがtrueではありません。Firestoreのusersドキュメントでactiveをbooleanのtrueにしてください。");
        setLoading(false);
        await signOut(auth);
        return;
      }

      if (loadedUser.role !== "admin" && loadedUser.role !== "user") {
        setError("このユーザーのroleが正しくありません。roleはadminまたはuserにしてください。");
        setLoading(false);
        await signOut(auth);
        return;
      }

      setAppUser(loadedUser);
      setLoading(false);
    } catch (caught) {
      setError(toMessage(caught));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setLoading(true);
        void loadAppUser(user);
      },
      (caught) => {
        setError(toMessage(caught));
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [loadAppUser]);

  async function login(email: string, password: string): Promise<void> {
    setLoading(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (caught) {
      setError(toMessage(caught));
      setLoading(false);
    }
  }

  async function logout(): Promise<void> {
    setError("");
    await signOut(auth);
  }

  return { firebaseUser, appUser, loading, error, login, logout };
}
