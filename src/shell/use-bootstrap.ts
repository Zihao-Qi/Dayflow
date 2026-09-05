"use client";

import { GENERIC_BOOTSTRAP_FAILURE, loadBootstrap } from "@/components/dashboard-api";
import { useFocusSession } from "@/components/focus-session-provider";
import { millisecondsUntilNextLocalDay } from "@/lib/dates";
import { ApiError } from "@/shared/client/api-client";
import type { Bootstrap } from "@/shared/client/decoders";
import { useEffect, useRef } from "react";
import { createReadGeneration } from "@/shared/client/read-generation";

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
  data,
  setData,
  setBootstrapFailure,
  setFirstRunSeen,
  setAppAnnouncement,
  setAppError,
  focus,
  initializeActivityClock
}: Pick<
  ShellState,
  | "data"
  | "setData"
  | "setBootstrapFailure"
  | "setFirstRunSeen"
  | "setAppAnnouncement"
  | "setAppError"
> & {
  focus: ReturnType<typeof useFocusSession>;
  initializeActivityClock: () => void;
}) {
  const owner = useRef(createReadGeneration()).current;
  const calendarKey = useRef(data?.todayKey);
  if (calendarKey.current !== data?.todayKey) {
    calendarKey.current = data?.todayKey;
    owner.invalidate();
  }

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
    void refresh().catch(() => {});
    scheduleDayRefresh();

    return () => {
      disposed = true;
      owner.invalidate();
      if (dayRefreshTimer !== null) window.clearTimeout(dayRefreshTimer);
    };
  }, []);

  useEffect(() => {
    if (focus.activityRevision > 0) void refresh().catch(() => {});
  }, [focus.activityRevision]);

  async function refresh() {
    await owner.run(loadBootstrap, (result) => {
      setData(result as Bootstrap);
      setBootstrapFailure(null);
    }, (error) => setBootstrapFailure(describeBootstrapFailure(error)));
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
    } catch (error) {
      setBootstrapFailure(describeBootstrapFailure(error));
      return;
    }
    await refresh().catch(() => {});
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
