"use client";

import { GENERIC_BOOTSTRAP_FAILURE, loadBootstrap } from "@/components/dashboard-api";
import { useFocusSession } from "@/components/focus-session-provider";
import { millisecondsUntilNextLocalDay } from "@/lib/dates";
import { ApiError } from "@/shared/client/api-client";
import type { Bootstrap } from "@/shared/client/decoders";
import { useEffect } from "react";

import { type BootstrapFailure, type ShellState } from "./use-shell-state";

class BootstrapRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BootstrapRequestError";
    this.code = code;
  }
}

function describeBootstrapFailure(error: unknown): BootstrapFailure {
  if (error instanceof BootstrapRequestError || error instanceof ApiError) {
    return { code: error.code ?? "BOOTSTRAP_UNAVAILABLE", message: error.message };
  }

  return { code: "BOOTSTRAP_UNAVAILABLE", message: GENERIC_BOOTSTRAP_FAILURE };
}

export function useBootstrap({
  setData,
  setBootstrapFailure,
  setFirstRunSeen,
  setAppAnnouncement,
  setAppError,
  focus,
  initializeActivityClock
}: Pick<
  ShellState,
  | "setData"
  | "setBootstrapFailure"
  | "setFirstRunSeen"
  | "setAppAnnouncement"
  | "setAppError"
> & {
  focus: ReturnType<typeof useFocusSession>;
  initializeActivityClock: () => void;
}) {
  useEffect(() => {
    let dayRefreshTimer: number | null = null;
    let disposed = false;

    function scheduleDayRefresh() {
      dayRefreshTimer = window.setTimeout(() => {
        void refresh()
          .catch(() => {
            if (disposed) return;
            setAppError(
              "Dayflow could not refresh for the new day. Reload to try again."
            );
            setAppAnnouncement("The new day could not be loaded.");
          })
          .finally(() => {
            if (!disposed) scheduleDayRefresh();
          });
      }, millisecondsUntilNextLocalDay() + 100);
    }

    initializeActivityClock();
    setFirstRunSeen(window.localStorage.getItem("dayflow-first-run-seen") === "1");
    void refresh().catch((error: unknown) => {
      if (!disposed) setBootstrapFailure(describeBootstrapFailure(error));
    });
    scheduleDayRefresh();

    return () => {
      disposed = true;
      if (dayRefreshTimer !== null) window.clearTimeout(dayRefreshTimer);
    };
  }, []);

  useEffect(() => {
    if (focus.activityRevision > 0) void refresh();
  }, [focus.activityRevision]);

  async function refresh() {
    const result = await loadBootstrap();
    setData(result as Bootstrap);
    setBootstrapFailure(null);
  }

  async function retryBootstrap() {
    setBootstrapFailure(null);
    try {
      if (!(await focus.reload())) {
        throw new BootstrapRequestError(
          "STARTUP_UNAVAILABLE",
          GENERIC_BOOTSTRAP_FAILURE
        );
      }
      await refresh();
    } catch (error) {
      setBootstrapFailure(describeBootstrapFailure(error));
    }
  }

  async function refreshAfterConfirmedMutation() {
    try {
      await refresh();
      return true;
    } catch {
      setAppError(
        "Your change was saved, but Dayflow could not refresh the latest view. Reload to try again."
      );
      setAppAnnouncement("Saved, but the latest view could not be refreshed.");
      return false;
    }
  }

  return { refresh, retryBootstrap, refreshAfterConfirmedMutation };
}
