"use client";

import { useState } from "react";
import { BookOpen, Check, Save } from "lucide-react";
import { SaveStateChip, useSaveState } from "@/components/save-state";
import { useReviewHistory } from "@/components/use-review-history";
import { PageHeader } from "@/components/workspace-ui";
import { ReviewMetric } from "@/components/review-metric";
import {
  formatDiaryAverage,
  formatMinutes,
  formatReviewPeriodEnd
} from "@/components/dashboard-formatters";
import type { ProjectSummary } from "@/lib/project-domain";
import { formatInvestedMinutes } from "@/lib/project-domain";
import type { PastReviewRecord } from "@/lib/review-records";
import { addDays, localDateKey } from "@/lib/dates";
import {
  REVIEW_INTENTION_MAX_LENGTH,
  REVIEW_NARRATIVE_MAX_LENGTH
} from "@/lib/review-domain";

type Review = {
  id: string | null;
  periodStart: string;
  periodEnd: string;
  narrative: string;
  nextPeriodIntention: string;
  persisted: boolean;
};

type ReviewSummary = {
  recordedMinutes: number;
  focusedMinutes: number;
  categoryMinutes: Array<{
    category: string;
    minutes: number;
  }>;
  completedTaskCount: number;
  noteCount: number;
  materialCount: number;
  diaryDayCount: number;
  averageMood: number | null;
  averageEnergy: number | null;
  movedProjectCount: number;
  pendingEnrichmentSessions: number;
  pendingEnrichmentMinutes: number;
};

function reviewsEqual(left: Review, right: Review) {
  return (
    left.periodStart === right.periodStart &&
    left.periodEnd === right.periodEnd &&
    left.narrative === right.narrative &&
    left.nextPeriodIntention === right.nextPeriodIntention
  );
}

function normalizeReview(review: Review): Review {
  return {
    ...review,
    narrative: review.narrative.trim(),
    nextPeriodIntention: review.nextPeriodIntention.trim()
  };
}

function hasReviewContent(review: Review) {
  return Boolean(
    review.narrative.trim() || review.nextPeriodIntention.trim()
  );
}

export function ReviewPage({
  projects,
  review,
  summary,
  onSaveReview,
  onSaveError,
  onSaveRecovered,
  onOpenProject
}: {
  projects: ProjectSummary[];
  review: Review;
  summary: ReviewSummary;
  onSaveReview: (review: Review) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
  onOpenProject: (id: string) => void;
}) {
  const history = useReviewHistory();
  const past = history.selected;
  const window = history.window;
  const detail = window ?? past;
  const activeSummary: ReviewSummary = detail ? detail.reviewSummary : summary;
  const activeProjects: ReviewMovedProject[] = detail ? detail.projects : projects;
  const activePeriodEnd = window
    ? window.periodEnd
    : past
      ? past.review.periodEnd
      : review.periodEnd;
  const eyebrow = window
    ? "Review window \u00b7 seven days ending"
    : past
      ? "Past review \u00b7 seven days ending"
      : "Seven days ending";
  const latestWindowEnding = localDateKey(
    addDays(new Date(review.periodEnd), -2)
  );

  return (
    <div className="review-page page-stack">
      <PageHeader
        eyebrow={`${eyebrow} ${formatReviewPeriodEnd(activePeriodEnd)}`}
        title="Review"
        actions={
          <button
            type="button"
            className="secondary-button"
            aria-expanded={history.open}
            onClick={history.open ? history.closeHistory : history.openHistory}
          >
            <BookOpen size={14} />
            {history.open ? "Hide earlier reviews" : "Earlier reviews"}
          </button>
        }
      />

      {history.open && (
        <ReviewHistoryPanel
          history={history}
          latestWindowEnding={latestWindowEnding}
        />
      )}

      <ReviewEvidenceSections
        summary={activeSummary}
        projects={activeProjects}
        onOpenProject={onOpenProject}
      />

      {window?.review ? (
        <PastReviewCard
          review={window.review}
          onReturnToCurrent={history.clearSelection}
        />
      ) : window ? (
        <EmptyReviewWindowCard onReturnToCurrent={history.clearSelection} />
      ) : past ? (
        <PastReviewCard
          review={past.review}
          onReturnToCurrent={history.clearSelection}
        />
      ) : (
        <CurrentReviewEditor
          key={`${review.periodStart}:${review.periodEnd}`}
          review={review}
          onSaveReview={onSaveReview}
          onSaveError={onSaveError}
          onSaveRecovered={onSaveRecovered}
        />
      )}
    </div>
  );
}

function EmptyReviewWindowCard({
  onReturnToCurrent
}: {
  onReturnToCurrent: () => void;
}) {
  return (
    <section
      className="panel review-editor-card review-past-card"
      aria-labelledby="review-window-empty-heading"
    >
      <div className="review-editor-heading">
        <div>
          <span className="eyebrow">Evidence without saved writing</span>
          <h2 id="review-window-empty-heading">
            No review was saved for this window
          </h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onReturnToCurrent}
        >
          Back to this week
        </button>
      </div>
      <p className="review-editor-intro">
        The evidence is still available because Dayflow derives it from your
        current records. Opening this window did not create or change a Review.
      </p>
    </section>
  );
}

type ReviewMovedProject = {
  id: string;
  name: string;
  taskCount: number;
  completedTaskCount: number;
  progressPercent: number | null;
  reviewPeriodInvestedMinutes: number;
  movedDuringReviewPeriod: boolean;
};

function ReviewEvidenceSections({
  summary,
  projects,
  onOpenProject
}: {
  summary: ReviewSummary;
  projects: ReviewMovedProject[];
  onOpenProject: (id: string) => void;
}) {
  const moved = projects.filter(
    (project) => project.movedDuringReviewPeriod
  );
  const categories = summary.categoryMinutes.filter(
    (item) => item.minutes > 0
  );
  const diaryAverageNote =
    summary.diaryDayCount === 0
      ? "no saved Diary days"
      : `across ${summary.diaryDayCount} saved Diary ${
          summary.diaryDayCount === 1 ? "day" : "days"
        }`;

  return (
    <>
      <dl className="review-metrics" aria-label="Review period totals">
        <ReviewMetric
          label="Recorded"
          value={formatMinutes(summary.recordedMinutes)}
          note="Activity time"
        />
        <ReviewMetric
          label="Focused"
          value={formatMinutes(summary.focusedMinutes)}
          note="Focus-origin Activity"
        />
        <ReviewMetric
          label="Tasks done"
          value={String(summary.completedTaskCount)}
          note={
            summary.completedTaskCount === 1
              ? "task completed"
              : "tasks completed"
          }
        />
        <ReviewMetric
          label="Diary days"
          value={`${summary.diaryDayCount}/7`}
          note="intentionally saved"
        />
      </dl>

      <div className="review-evidence-grid">
        <section
          className="panel review-evidence-panel"
          aria-labelledby="review-evidence-heading"
        >
          <div className="review-panel-heading">
            <div>
              <span className="eyebrow">Supporting evidence</span>
              <h2 id="review-evidence-heading">Evidence captured</h2>
            </div>
          </div>
          <dl className="review-evidence-counts">
            <ReviewMetric
              label="Notes"
              value={String(summary.noteCount)}
              note={summary.noteCount === 1 ? "note captured" : "notes captured"}
            />
            <ReviewMetric
              label="References"
              value={String(summary.materialCount)}
              note={
                summary.materialCount === 1
                  ? "reference saved"
                  : "references saved"
              }
            />
            <ReviewMetric
              label="Projects"
              value={String(summary.movedProjectCount)}
              note="moved forward"
            />
            <ReviewMetric
              label="Average mood"
              value={formatDiaryAverage(summary.averageMood)}
              note={diaryAverageNote}
            />
            <ReviewMetric
              label="Average energy"
              value={formatDiaryAverage(summary.averageEnergy)}
              note={diaryAverageNote}
            />
          </dl>
          <p className="review-missing-evidence-note">
            Mood and energy average only saved Diary days. Missing days stay
            missing.
          </p>
        </section>

        <section
          className="panel review-category-panel"
          aria-labelledby="review-category-heading"
        >
          <div className="review-panel-heading">
            <div>
              <span className="eyebrow">Activity distribution</span>
              <h2 id="review-category-heading">Where the time went</h2>
            </div>
            <strong>{formatMinutes(summary.recordedMinutes)}</strong>
          </div>
          {categories.length ? (
            <ul
              className="review-category-list"
              aria-label="Activity time by category"
            >
              {categories.map((item) => {
                const percentage = Math.round(
                  (item.minutes / Math.max(summary.recordedMinutes, 1)) * 100
                );
                return (
                  <li key={item.category}>
                    <div className="review-category-copy">
                      <span>{item.category}</span>
                      <strong>{formatMinutes(item.minutes)}</strong>
                      <small>{percentage}%</small>
                    </div>
                    <div className="review-category-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${Math.max(0, Math.min(percentage, 100))}%`
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="review-empty-copy">
              No Activity time was recorded in this review period.
            </p>
          )}
        </section>
      </div>

      {summary.pendingEnrichmentSessions > 0 && (
        <p className="review-pending-note" role="status">
          <Check size={14} />
          <span>
            <strong>
              {formatMinutes(summary.pendingEnrichmentMinutes)} is already
              counted.
            </strong>{" "}
            {summary.pendingEnrichmentSessions === 1
              ? "This session"
              : "These sessions"}{" "}
            can receive optional notes and categories later.
          </span>
        </p>
      )}

      <section
        className="panel moved-projects"
        aria-labelledby="review-projects-heading"
      >
        <div className="review-panel-heading">
          <div>
            <span className="eyebrow">Outcomes in motion</span>
            <h2 id="review-projects-heading">Projects moved forward</h2>
          </div>
          <strong>{summary.movedProjectCount}</strong>
        </div>
        <div className="review-project-list">
          {moved.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onOpenProject(project.id)}
            >
              <strong>{project.name}</strong>
              <div className="meter" aria-hidden="true">
                <i style={{ width: `${project.progressPercent ?? 0}%` }} />
              </div>
              <small>
                {project.completedTaskCount}/{project.taskCount} tasks ·{" "}
                {formatInvestedMinutes(
                  project.reviewPeriodInvestedMinutes
                )}{" "}
                invested this review period
              </small>
            </button>
          ))}
          {!moved.length && (
            <p>No project movement was recorded in this review period.</p>
          )}
        </div>
      </section>
    </>
  );
}

function CurrentReviewEditor({
  review,
  onSaveReview,
  onSaveError,
  onSaveRecovered
}: {
  review: Review;
  onSaveReview: (review: Review) => Promise<boolean>;
  onSaveError: () => void;
  onSaveRecovered: () => void;
}) {
  const reviewSave = useSaveState<Review>({
    value: review,
    save: onSaveReview,
    normalize: normalizeReview,
    isEqual: reviewsEqual,
    isValid: hasReviewContent,
    onFinalError: onSaveError,
    onRecovered: onSaveRecovered
  });
  const hasDraft = hasReviewContent(reviewSave.draft);

  return (
      <section
        className="panel review-editor-card"
        aria-labelledby="review-editor-heading"
      >
        <div className="review-editor-heading">
          <div>
            <span className="eyebrow">Saved separately from Journal</span>
            <h2 id="review-editor-heading">Your review</h2>
          </div>
          <div
            className="review-save-state"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <SaveStateChip
              state={reviewSave.state}
              onRetry={() => void reviewSave.flush(true)}
            />
          </div>
        </div>
        <p className="review-editor-intro">
          Interpret the evidence without changing it. This writing belongs to
          this exact seven-day period, not today&apos;s Diary.
        </p>
        <form
          className="review-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void reviewSave.flush(true);
          }}
        >
          <div className="review-writing-fields">
            <label htmlFor="review-narrative">
              <span>Looking back</span>
              <strong>What moved forward?</strong>
              <textarea
                id="review-narrative"
                aria-label="What moved forward?"
                value={reviewSave.draft.narrative}
                maxLength={REVIEW_NARRATIVE_MAX_LENGTH}
                aria-describedby="review-narrative-help"
                onChange={(event) =>
                  reviewSave.setDraft({
                    ...reviewSave.draft,
                    narrative: event.target.value
                  })
                }
                {...reviewSave.inputProps}
              />
              <small id="review-narrative-help">
                A short account grounded in the evidence above ·{" "}
                {reviewSave.draft.narrative.length.toLocaleString()}/
                {REVIEW_NARRATIVE_MAX_LENGTH.toLocaleString()}
              </small>
            </label>
            <label htmlFor="review-intention">
              <span>Looking ahead</span>
              <strong>What deserves protection next?</strong>
              <textarea
                id="review-intention"
                aria-label="What deserves protection next?"
                value={reviewSave.draft.nextPeriodIntention}
                maxLength={REVIEW_INTENTION_MAX_LENGTH}
                aria-describedby="review-intention-help"
                onChange={(event) =>
                  reviewSave.setDraft({
                    ...reviewSave.draft,
                    nextPeriodIntention: event.target.value
                  })
                }
                {...reviewSave.inputProps}
              />
              <small id="review-intention-help">
                One intention for the next seven days ·{" "}
                {reviewSave.draft.nextPeriodIntention.length.toLocaleString()}/
                {REVIEW_INTENTION_MAX_LENGTH.toLocaleString()}
              </small>
            </label>
          </div>
          <div className="review-editor-actions">
            <p>
              {hasDraft
                ? "Changes also save after a short pause, on blur, or with ⌘/Ctrl+Enter."
                : "Write in at least one field to save this Review."}
            </p>
            <button
              type="submit"
              className="primary-button"
              disabled={!hasDraft || reviewSave.state === "saving"}
            >
              <Save size={14} />
              {reviewSave.state === "saving" ? "Saving…" : "Save review"}
            </button>
          </div>
        </form>
      </section>
  );
}

function PastReviewCard({
  review,
  onReturnToCurrent
}: {
  review: PastReviewRecord;
  onReturnToCurrent: () => void;
}) {
  return (
    <section
      className="panel review-editor-card review-past-card"
      aria-labelledby="review-past-heading"
    >
      <div className="review-editor-heading">
        <div>
          <span className="eyebrow">Saved for this period</span>
          <h2 id="review-past-heading">Your review</h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onReturnToCurrent}
        >
          Back to this week
        </button>
      </div>
      <p className="review-editor-intro">
        This review belongs to a period that has already ended, so it is shown
        as it was written. The evidence above is derived from your records as
        they exist now.
      </p>
      <div className="review-past-writing">
        <section aria-labelledby="review-past-narrative-heading">
          <span className="eyebrow">Looking back</span>
          <h3 id="review-past-narrative-heading">What moved forward?</h3>
          {review.narrative ? (
            <p className="review-past-text">{review.narrative}</p>
          ) : (
            <p className="review-empty-copy">
              Nothing was written for this field.
            </p>
          )}
        </section>
        <section aria-labelledby="review-past-intention-heading">
          <span className="eyebrow">Looking ahead</span>
          <h3 id="review-past-intention-heading">
            What deserves protection next?
          </h3>
          {review.nextPeriodIntention ? (
            <p className="review-past-text">{review.nextPeriodIntention}</p>
          ) : (
            <p className="review-empty-copy">
              Nothing was written for this field.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

function ReviewHistoryPanel({
  history,
  latestWindowEnding
}: {
  history: ReturnType<typeof useReviewHistory>;
  latestWindowEnding: string;
}) {
  const [windowEnding, setWindowEnding] = useState(latestWindowEnding);

  return (
    <section
      className="panel review-history-panel"
      aria-labelledby="review-history-heading"
    >
      <div className="review-panel-heading">
        <div>
          <span className="eyebrow">Saved reviews</span>
          <h2 id="review-history-heading">Earlier reviews</h2>
        </div>
        {history.totalCount !== null && (
          <strong>{history.totalCount}</strong>
        )}
      </div>

      <section
        className="review-window-picker"
        aria-labelledby="review-window-picker-heading"
      >
        <div>
          <span className="eyebrow">Browse evidence</span>
          <h3 id="review-window-picker-heading">Open any past seven days</h3>
        </div>
        <form
          className="review-window-form"
          onSubmit={(event) => {
            event.preventDefault();
            void history.selectWindow(windowEnding);
          }}
        >
          <label htmlFor="review-window-ending">
            <span>Review window ending</span>
            <input
              id="review-window-ending"
              type="date"
              required
              max={latestWindowEnding}
              value={windowEnding}
              onChange={(event) => setWindowEnding(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="secondary-button"
            disabled={!windowEnding}
          >
            {history.windowLoading ? "Opening\u2026" : "Open window"}
          </button>
        </form>
        {history.windowError && (
          <p className="review-history-error" role="alert">
            <span>{history.windowError}</span>
            <button
              type="button"
              className="secondary-button"
              onClick={history.retryWindow}
            >
              Try again
            </button>
          </p>
        )}
      </section>

      {history.error ? (
        <p className="review-history-error" role="alert">
          <span>{history.error}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={history.retry}
          >
            Try again
          </button>
        </p>
      ) : !history.loaded && history.loading ? (
        <p className="review-empty-copy" role="status">
          Loading earlier reviews\u2026
        </p>
      ) : history.loaded && !history.items.length ? (
        <p className="review-empty-copy">
          No earlier review has been saved yet. A review joins this list once
          its seven-day period has ended.
        </p>
      ) : (
        <>
          <ul
            className="review-history-list"
            aria-label="Reviews saved for earlier periods"
          >
            {history.items.map((item) => {
              const selected = history.selected?.review.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => void history.select(item.id)}
                  >
                    <strong>
                      Seven days ending {formatReviewPeriodEnd(item.periodEnd)}
                    </strong>
                    <small>
                      {item.narrative ||
                        item.nextPeriodIntention ||
                        "No writing saved"}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
          {history.selectionError && (
            <p className="review-history-error" role="alert">
              {history.selectionError}
            </p>
          )}
          {history.nextCursor && (
            <button
              type="button"
              className="secondary-button"
              disabled={history.loading}
              onClick={history.loadNext}
            >
              {history.loading ? "Loading\u2026" : "Show older reviews"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
