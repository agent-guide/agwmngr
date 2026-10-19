"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, clearSession } from "@/lib/auth";
import { adminFetch, ApiError } from "@/lib/api";
import { useI18n } from "@/components/i18n-provider";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [backendError, setBackendError] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    adminFetch("/admin/auth/me")
      .then(() => setReady(true))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          router.replace("/login");
        } else {
          setBackendError(true);
        }
      });
  }, [router]);

  if (backendError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-white/60">{t("auth.backendUnavailable")}</p>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
          onClick={() => {
            setBackendError(false);
            adminFetch("/admin/auth/me")
              .then(() => setReady(true))
              .catch((err) => {
                if (err instanceof ApiError && err.status === 401) {
                  clearSession();
                  router.replace("/login");
                } else {
                  setBackendError(true);
                }
              });
          }}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
