import type { ProjectPhaseRecord, ProjectTaskRecord } from "@/lib/project-domain";
import { ApiError } from "@/shared/client/api-client";

/**
 * A List row's task drawer under overlapping reads and writes.
 *
 * Tasks are not in the Projects overview payload, so an open row reads the
 * Project detail and keeps it for later toggles. Those reads overlap with
 * writes: a write refreshes the plan and the overview together, the summary
 * can move while that refresh is in flight, and a response can be lost after
 * the server committed. The ordering rules for all of that live here. The row
 * renders `ProjectRowPlanState` and forwards intent; it never sees a read or a
 * read outcome, so it cannot act on one that belongs to another request.
 */

export type ProjectPlan = {
  tasks: ProjectTaskRecord[];
  phases: ProjectPhaseRecord[];
};

/** The detail read: tasks and phases, with summary counts when the API includes them. */
export type ProjectPlanDetail = {
  tasks: ProjectTaskRecord[];
  phases?: unknown;
  taskCount?: number;
  completedTaskCount?: number;
  nextTaskId?: string | null;
  progressPercent?: number | null;
};

export type ProjectRowPlanState = {
  plan: ProjectPlan | null;
  loading: boolean;
  loadError: string;
  editError: string;
};

export const initialProjectRowPlanState: ProjectRowPlanState = {
  plan: null,
  loading: false,
  loadError: "",
  editError: ""
};

type SummaryCounts = {
  taskCount?: number;
  completedTaskCount?: number;
  nextTaskId?: string | null;
  progressPercent?: number | null;
};

/**
 * The key both sides compare. The overview refreshes whenever Project data
 * changes, so its counts stand in for "the plan moved"; a detail read records
 * the key of what it published. One format, so the two cannot drift apart and
 * make a current plan look stale or a stale one look current.
 */
export function projectPlanKey(counts: SummaryCounts): string {
  return [
    counts.taskCount,
    counts.completedTaskCount,
    counts.nextTaskId ?? "",
    counts.progressPercent ?? ""
  ].join(":");
}

export type ProjectRowPlanDeps = {
  /** The row's summary key when it mounted. */
  summaryKey: string;
  readPlan: () => Promise<ProjectPlanDetail>;
  /** Refreshes the Projects overview. A moved summary comes back through `view`. */
  refreshSummary: () => Promise<void>;
  /**
   * What the row last rendered. It is consulted while a refresh settles, which
   * can happen after a render but before that render's effects run, so it must
   * be current as of the latest render rather than the latest effect.
   */
  view: () => { summaryKey: string; expanded: boolean };
  /** Receives every change. The module is the drawer state's only writer. */
  onChange: (state: ProjectRowPlanState) => void;
};

export type ProjectRowPlan = {
  /** The drawer state as last published. */
  getState(): ProjectRowPlanState;
  /** The user opened or closed the row. */
  toggle(opened: boolean): void;
  /** The row rendered a new summary key or disclosure. Call from an effect. */
  observe(): void;
  /**
   * Reads again without touching the disclosure. Routed through `toggle`, a
   * retry would read the drawer as open and close it instead of fetching.
   */
  retry(): void;
  update(write: () => Promise<unknown>): Promise<void>;
  /** Resolves true when the task is gone: deleted, or confirmed gone after a lost response. */
  remove(taskId: string, write: () => Promise<unknown>): Promise<boolean>;
  /** Resolves true when the server confirmed the create. */
  create(write: () => Promise<ProjectTaskRecord>): Promise<boolean>;
};

const LOAD_FAILED = "These tasks could not be loaded. Try again.";
const SAVE_FAILED = "The change could not be saved. Your draft is still here.";
const REFRESH_FAILED = "Your change was saved, but the Project list could not be refreshed.";
const DELETE_REFRESH_FAILED =
  "The task may have been deleted, but the Project list could not be refreshed.";

/** A read's identity. Every outcome names the read it belongs to. */
type PlanRead = { readonly id: number };

type ReadOutcome =
  | { read: PlanRead; kind: "published"; plan: ProjectPlan }
  | { read: PlanRead; kind: "failed" }
  | { read: PlanRead; kind: "superseded" };

export function createProjectRowPlan(deps: ProjectRowPlanDeps): ProjectRowPlan {
  let state = initialProjectRowPlanState;
  // The summary key of the plan that is currently published.
  let loadedKey = deps.summaryKey;
  let latestRead = 0;
  let latestOutcome: Promise<ReadOutcome> | null = null;
  // Writes whose plan and overview refreshes are still settling. Counted, so
  // an older write cannot release a newer write's retained summary change.
  let refreshing = 0;
  // Observing a summary key does not prove that an in-flight read contains it,
  // so a change seen while a refresh settles is reconciled afterwards instead.
  let summaryMovedDuringRefresh = false;

  function publish(change: Partial<ProjectRowPlanState>) {
    const next = { ...state, ...change };
    if (
      next.plan === state.plan &&
      next.loading === state.loading &&
      next.loadError === state.loadError &&
      next.editError === state.editError
    ) {
      return;
    }
    state = next;
    deps.onChange(state);
  }

  // Each read takes the next identity and only the latest one may publish. A
  // guard on `loading` would drop the newer read instead: when the summary
  // moves while a read is in flight, that read carries pre-change data, and
  // letting it settle unchallenged reinstates the staleness the newer read
  // exists to clear.
  function read(): Promise<ReadOutcome> {
    const own: PlanRead = { id: ++latestRead };
    publish({ loading: true, loadError: "" });
    const outcome = (async (): Promise<ReadOutcome> => {
      try {
        const detail = await deps.readPlan();
        if (own.id !== latestRead) return { read: own, kind: "superseded" };
        const plan: ProjectPlan = {
          tasks: detail.tasks,
          phases: Array.isArray(detail.phases) ? (detail.phases as ProjectPhaseRecord[]) : []
        };
        // Recorded in the overview's own terms, so that when this read lands
        // before the overview refresh, the summary that refresh is about to
        // render is already recognised as loaded and starts no further read.
        loadedKey = projectPlanKey({
          taskCount: detail.taskCount ?? plan.tasks.length,
          completedTaskCount:
            detail.completedTaskCount ??
            plan.tasks.filter((task) => task.status === "DONE").length,
          nextTaskId: detail.nextTaskId,
          progressPercent: detail.progressPercent
        });
        publish({ plan, loading: false });
        return { read: own, kind: "published", plan };
      } catch {
        if (own.id !== latestRead) return { read: own, kind: "superseded" };
        publish({ loadError: LOAD_FAILED, loading: false });
        return { read: own, kind: "failed" };
      }
    })();
    latestOutcome = outcome;
    return outcome;
  }

  // A superseded or overtaken outcome says nothing about the plan on screen.
  // Wait for the latest read and answer from that one instead.
  async function winning(outcome: ReadOutcome): Promise<ReadOutcome> {
    let current = outcome;
    while ((current.kind === "superseded" || current.read.id !== latestRead) && latestOutcome) {
      const next = await latestOutcome;
      if (next === current) break;
      current = next;
    }
    return current;
  }

  async function reconcileSummaryMovedDuringRefresh(outcome: ReadOutcome) {
    let current = outcome;
    for (;;) {
      current = await winning(current);
      if (current.kind === "superseded") return;
      // Another write may have started a read while the await resumed.
      if (current.read.id !== latestRead) continue;
      if (!summaryMovedDuringRefresh) return;
      summaryMovedDuringRefresh = false;

      const { summaryKey, expanded } = deps.view();
      if (loadedKey === summaryKey) return;
      if (!expanded) {
        loadedKey = summaryKey;
        publish({ plan: null });
        return;
      }
      // Keep a failed read's error and its explicit retry. Only a published
      // but outdated plan calls for another automatic read.
      if (current.kind === "failed") return;
      current = await read();
    }
  }

  // The write has committed. The plan and the overview refresh together,
  // since neither waits on the other. Renames leave the summary untouched, so
  // the plan read is explicit rather than left to a summary change.
  async function refreshAfterWrite(): Promise<{ own: ReadOutcome; overviewRefreshed: boolean }> {
    refreshing += 1;
    try {
      const [own, overviewRefreshed] = await Promise.all([
        read(),
        deps.refreshSummary().then(
          () => true,
          () => false
        )
      ]);
      // Reconciliation can run later reads that belong to no write. `own`
      // stays this write's outcome regardless: whether this write's plan was
      // published cannot be answered by a read made for another request.
      await reconcileSummaryMovedDuringRefresh(own);
      return { own, overviewRefreshed };
    } finally {
      refreshing -= 1;
    }
  }

  async function commit<T>(
    write: () => Promise<T>
  ): Promise<{ saved: true; value: T } | { saved: false }> {
    publish({ editError: "" });
    try {
      return { saved: true, value: await write() };
    } catch (error) {
      publish({ editError: error instanceof ApiError ? error.message : SAVE_FAILED });
      return { saved: false };
    }
  }

  return {
    getState() {
      return state;
    },

    toggle(opened) {
      // An edit error refers to a past write, and that context is gone once the
      // row is closed or reopened.
      publish({ editError: "" });
      // A read failure is unresolved staleness instead: opening reads again,
      // and the error stays visible if that read fails too.
      if (opened && (!state.plan || state.loadError)) void read();
    },

    observe() {
      const { summaryKey, expanded } = deps.view();
      if (loadedKey === summaryKey) return;
      if (refreshing > 0) {
        summaryMovedDuringRefresh = true;
        return;
      }
      // An open drawer stays mounted while it refreshes, so an unsubmitted add
      // draft survives edits to neighbouring tasks. A closed row can discard
      // its plan and read on the next opening.
      if (expanded) {
        void read();
      } else {
        loadedKey = summaryKey;
        publish({ plan: null });
      }
    },

    retry() {
      void read();
    },

    async update(write) {
      const written = await commit(write);
      if (!written.saved) return;
      const { overviewRefreshed } = await refreshAfterWrite();
      if (!overviewRefreshed) publish({ editError: REFRESH_FAILED });
    },

    async remove(taskId, write) {
      const written = await commit(write);
      if (written.saved) {
        const { overviewRefreshed } = await refreshAfterWrite();
        if (!overviewRefreshed) publish({ editError: REFRESH_FAILED });
        return true;
      }
      // A DELETE can commit and still lose its response. Reconcile before
      // inviting a retry: a second DELETE would receive 404, and the task would
      // otherwise stay in the drawer. The read settles before the overview
      // refresh starts, and the answer comes from the winning read's plan.
      let outcome = await winning(await read());
      let overviewRefreshed = true;
      try {
        await deps.refreshSummary();
      } catch {
        overviewRefreshed = false;
        publish({ editError: DELETE_REFRESH_FAILED });
      }
      outcome = await winning(outcome);
      if (
        outcome.kind === "published" &&
        !outcome.plan.tasks.some((task) => task.id === taskId)
      ) {
        if (overviewRefreshed) publish({ editError: "" });
        return true;
      }
      return false;
    },

    async create(write) {
      const written = await commit(write);
      if (!written.saved) return false;
      const { own, overviewRefreshed } = await refreshAfterWrite();
      if (!overviewRefreshed) publish({ editError: REFRESH_FAILED });
      // Merge the confirmed record by hand only when this write's own read
      // failed and no later read has started since, so nothing else will show
      // it. If that read published, the task is already on screen; if a later
      // read started, that read is the authority, and one that has removed the
      // task must not be undone by this older confirmation.
      if (own.kind === "failed" && own.read.id === latestRead) {
        const record = written.value;
        const plan = state.plan;
        if (!plan) {
          publish({ plan: { tasks: [record], phases: [] } });
        } else if (!plan.tasks.some((task) => task.id === record.id)) {
          publish({ plan: { ...plan, tasks: [...plan.tasks, record] } });
        }
      }
      return true;
    }
  };
}
