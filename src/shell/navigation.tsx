"use client";

import { formatMinutes } from "@/components/dashboard-formatters";
import { useFocusSession } from "@/components/focus-session-provider";
import { DEFAULT_FOCUS_MINUTES } from "@/lib/focus-domain";
import type { Bootstrap } from "@/shared/client/decoders";
import {
  CalendarDays,
  Circle,
  DatabaseBackup,
  FolderKanban,
  Layers3,
  LayoutDashboard,
  Menu,
  NotebookPen,
  Play,
  Plus,
  Sparkles
} from "lucide-react";

import type { useShellModel } from "./use-shell-model";
import { type Screen } from "./use-shell-state";
type ShellModel = ReturnType<typeof useShellModel>;
const nav = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "day", label: "Log", icon: CalendarDays },
  { id: "projects", label: "Projects", icon: Layers3 },
  { id: "backlog", label: "Backlog", icon: Circle },
  { id: "journal", label: "Journal", icon: NotebookPen },
  { id: "review", label: "Review", icon: Sparkles }
] as const;

export function Navigation({
  screen,
  openCommandPalette,
  navigate,
  openTodayTasks,
  backlogTasks,
  mobileMoreOpen,
  setMobileMoreOpen,
  setFocusDraft,
  setRailExpanded,
  setDataManagementOpen,
  data,
  liveFocus,
  isToday,
  focusedMinutes,
  completedSessions
}: Pick<
  ShellModel,
  | "screen"
  | "openCommandPalette"
  | "navigate"
  | "openTodayTasks"
  | "backlogTasks"
  | "mobileMoreOpen"
  | "setMobileMoreOpen"
  | "setFocusDraft"
  | "setRailExpanded"
  | "setDataManagementOpen"
> & {
  data: Bootstrap;
  liveFocus: ReturnType<typeof useFocusSession>["active"] | ReturnType<typeof useFocusSession>["pendingCompletion"];
  isToday: boolean;
  focusedMinutes: number;
  completedSessions: number;
}) {
  return (
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <strong>Dayflow</strong>
        </div>
        <button className="search-trigger" onClick={openCommandPalette}>
          <Plus size={15} />
          <span>Search or add</span>
          <kbd>⌘K</kbd>
        </button>
        <nav className="nav-list" aria-label="Primary">
          {nav.map((item) => {
            const Icon = item.icon;
            const itemScreen = item.id === "day" ? "day-stream" : item.id;
            const active =
              item.id === "day" ? screen.startsWith("day-") : screen === itemScreen;
            const count =
              item.id === "today"
                ? openTodayTasks.length
                : item.id === "projects"
                  ? data.projects.filter((project) => project.status === "ACTIVE").length
                  : item.id === "backlog"
                    ? backlogTasks.length
                    : null;
            return (
              <button
                key={item.id}
                className={active ? "nav-item active" : "nav-item"}
                data-nav-id={item.id}
                onClick={() => navigate(itemScreen as Screen)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                {count !== null && <small>{count}</small>}
              </button>
            );
          })}
          <button
            className={mobileMoreOpen ? "nav-item mobile-more active" : "nav-item mobile-more"}
            onClick={() => setMobileMoreOpen((open) => !open)}
          >
            <Menu size={16} />
            <span>More</span>
          </button>
        </nav>
        {!liveFocus && !isToday && (
          <button
            className="sidebar-focus-button focus-button"
            onClick={() => {
              setFocusDraft({ revision: Date.now(), plannedMinutes: DEFAULT_FOCUS_MINUTES });
              setRailExpanded(true);
            }}
          >
            <Play size={14} />
            Start focus
            <kbd>⌘⇧F</kbd>
          </button>
        )}
        <button
          className="sidebar-data-button"
          aria-label="Data & backups"
          onClick={() => setDataManagementOpen(true)}
        >
          <DatabaseBackup size={15} />
          <span>Data &amp; backups</span>
        </button>
        <footer className="sidebar-focus-summary">
          <span className="eyebrow">Today&apos;s focus</span>
          <strong>{formatMinutes(focusedMinutes)}</strong>
          <div className="focus-pips" aria-label={`${completedSessions} of 4 focus sessions`}>
            {[0, 1, 2, 3].map((index) => (
              <i key={index} className={index < completedSessions ? "filled" : ""} />
            ))}
          </div>
          <small>{completedSessions} of 4 focus sessions</small>
        </footer>
      </aside>

  );
}

export function MobileMoreMenu({
  mobileMoreOpen,
  navigate,
  backlogTasks,
  setMobileMoreOpen,
  setDataManagementOpen
}: Pick<
  ShellModel,
  | "mobileMoreOpen"
  | "navigate"
  | "backlogTasks"
  | "setMobileMoreOpen"
  | "setDataManagementOpen"
>) {
  return (
    <>
      {mobileMoreOpen && (
        <div className="mobile-more-menu" role="menu" aria-label="More destinations">
          <button role="menuitem" onClick={() => navigate("backlog")}>
            <FolderKanban size={17} />
            Backlog
            <small>{backlogTasks.length}</small>
          </button>
          <button role="menuitem" onClick={() => navigate("journal")}>
            <NotebookPen size={17} />
            Journal
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMobileMoreOpen(false);
              setDataManagementOpen(true);
            }}
          >
            <DatabaseBackup size={17} />
            Data &amp; backups
          </button>
        </div>
      )}

    </>
  );
}
