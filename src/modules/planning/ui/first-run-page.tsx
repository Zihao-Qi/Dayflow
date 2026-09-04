"use client";

import { Layers3, NotebookPen, Play } from "lucide-react";
import { formatLongDate } from "@/components/dashboard-formatters";
import { PageHeader } from "@/components/workspace-ui";

export function FirstRunPage({
  today,
  title,
  saving,
  onTitleChange,
  onBegin,
  onCreateProject,
  onOpenCapture
}: {
  today: string;
  title: string;
  saving: boolean;
  onTitleChange: (title: string) => void;
  onBegin: (title: string, startFocus: boolean) => Promise<void>;
  onCreateProject: () => void;
  onOpenCapture: () => void;
}) {
  return (
    <div className="first-run-page page-stack">
      <PageHeader eyebrow={formatLongDate(today)} title="Nothing here yet" />
      <p className="first-run-intro">
        Dayflow keeps one honest record of where your attention went. There is nothing
        to import and nothing to configure — the first block of focus is the whole setup.
      </p>
      <ol className="first-run-loop" aria-label="Dayflow workflow">
        <li>
          <strong>Decide</strong>
          <small>what matters</small>
        </li>
        <li>
          <strong>Plan</strong>
          <small>when to do it</small>
        </li>
        <li>
          <strong>Record</strong>
          <small>what happened</small>
        </li>
        <li>
          <strong>Capture</strong>
          <small>useful context</small>
        </li>
        <li>
          <strong>Review</strong>
          <small>evidence, choose next</small>
        </li>
      </ol>
      <section className="first-run-start">
        <span className="eyebrow focus-eyebrow">Start here</span>
        <label>
          What are you working on right now?
          <input
            id="first-task"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Name one thing"
          />
        </label>
        <div>
          <button
            type="button"
            className="primary-button"
            disabled={saving || !title.trim()}
            onClick={() => void onBegin(title, true)}
          >
            <Play size={15} />
            {saving ? "Saving…" : "Focus on it for 25m"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={saving || !title.trim()}
            onClick={() => void onBegin(title, false)}
          >
            Just add it to today
          </button>
        </div>
      </section>
      <section className="first-run-ready">
        <span className="eyebrow">When you are ready</span>
        <button
          type="button"
          disabled={saving}
          onClick={onCreateProject}
        >
          <Layers3 size={17} />
          <span>
            <strong>Group work under a project</strong>
            <small>Only worth it when something takes more than a few days.</small>
          </span>
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onOpenCapture}
        >
          <NotebookPen size={17} />
          <span>
            <strong>
              Capture anything<span className="desktop-shortcut"> with ⌘K</span>
            </strong>
            <small>Tasks, notes, links and time you already spent.</small>
          </span>
        </button>
      </section>
      <p className="first-run-footnote">
        Review and Log stay empty until there is something to show. That is
        intentional — they fill themselves in.
      </p>
    </div>
  );
}
