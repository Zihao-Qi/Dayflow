"use client";

import { CommandPalette } from "@/components/command-palette";
import { formatLongLocalDateKey } from "@/components/dashboard-formatters";
import { ProjectsWorkspace } from "@/components/projects-workspace";
import { TimeBlockDialog } from "@/components/time-block-dialog";
import { DataManagementDialog } from "@/modules/data-ops/ui/data-management-dialog";
import { FocusRail } from "@/modules/focus/ui/focus-rail";
import { JournalPage } from "@/modules/journal/ui";
import { BacklogPage, FirstRunPage, TodayPage } from "@/modules/planning/ui";
import { DayPage } from "@/modules/planning/ui/log/day-workspace";
import { ReviewPage } from "@/modules/review/ui/review-workspace";
import { Plus, RefreshCw } from "lucide-react";

import { ActivityDialog } from "@/modules/evidence/ui/activity-dialog";
import { MobileMoreMenu, Navigation } from "./navigation";
import { useShellModel } from "./use-shell-model";
import { type DayView } from "./use-shell-state";
import { mergeTimeBlockTaskOptions } from "./use-time-block-actions";

export function WorkspaceShell() {
  const model = useShellModel();
  const {
    wideFocusRail,
    data,
    bootstrapFailure,
    screen,
    railExpanded,
    setRailExpanded,
    paletteOpen,
    paletteQuery,
    setPaletteQuery,
    projectById,
    journal,
    newTask,
    setNewTask,
    taskCreatePending,
    noteDraft,
    setNoteDraft,
    noteSaving,
    materialDraft,
    setMaterialDraft,
    materialSaving,
    selectedProjectId,
    setSelectedProjectId,
    projectCreateOpen,
    setProjectCreateOpen,
    focusDraft,
    timeBlockEditor,
    setTimeBlockEditor,
    timeBlockError,
    setTimeBlockError,
    timeBlockErrorField,
    setTimeBlockErrorField,
    timeBlockSaving,
    setDismissedUnfinished,
    dataManagementOpen,
    setDataManagementOpen,
    firstRunSeen,
    appAnnouncement,
    setAppAnnouncement,
    appError,
    setAppError,
    focus,
    compactLayout,
    phoneLayout,
    activity,
    backlog,
    queuedTasks,
    today,
    viewedDay,
    dayTasks,
    dayActivities,
    dayTimeBlocks,
    dayBlockedMinutes,
    dayRecordedMinutes,
    timeBlockTaskCandidates,
    refresh,
    retryBootstrap,
    paletteResolution,
    openCommandPalette,
    dismissCommandPalette,
    activatePaletteItem,
    navigate,
    openFirstProject,
    openFocus,
    openProject,
    openProjectBacklog,
    addTask,
    beginFirstRun,
    saveTaskAttempt,
    reportTaskSaveFailure,
    reportTaskSaveRecovery,
    updateTask,
    deleteTask,
    reorderTask,
    queueTask,
    removeQueuedTask,
    reorderQueue,
    selectNoteTask,
    selectMaterialTask,
    addNote,
    addMaterial,
    saveDiary,
    reportDiarySaveFailure,
    reportDiarySaveRecovery,
    setDiaryValue,
    saveReview,
    reportReviewSaveFailure,
    reportReviewSaveRecovery,
    openTimeBlockEditor,
    editTimeBlock,
    changeTimeBlockTask,
    saveTimeBlock,
    deleteTimeBlock
  } = model;
  if (!data && bootstrapFailure) {
    const migrationRequired =
      bootstrapFailure.code === "DATABASE_MIGRATION_REQUIRED";
    return (
      <main className="startup-error-screen">
        <section className="startup-error-card" role="alert">
          <span className="eyebrow">Local data</span>
          <h1>
            {migrationRequired
              ? "Update Dayflow's local database"
              : "Dayflow could not open"}
          </h1>
          {migrationRequired ? (
            <>
              <p>
                Your data is still in place, but this version of Dayflow needs
                the latest checked-in database migrations.
              </p>
              <code>npm run db:migrate</code>
              <p className="startup-error-note">
                Stop Dayflow before running the command, then start it again.
              </p>
            </>
          ) : (
            <p>{bootstrapFailure.message}</p>
          )}
          <button
            className="primary-button"
            onClick={() => void retryBootstrap()}
          >
            <RefreshCw aria-hidden="true" size={16} />
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="loading-screen">
        <RefreshCw className="spin" size={22} />
        <span>Opening Dayflow</span>
      </main>
    );
  }

  const timeBlockDialogTasks = mergeTimeBlockTaskOptions(
    timeBlockTaskCandidates,
    timeBlockEditor
  );
  const isToday = screen === "today";
  const liveFocus = focus.active ?? focus.pendingCompletion;
  const showFullRail =
    Boolean(focus.retryNext) ||
    (compactLayout && railExpanded && Boolean(liveFocus || focusDraft)) ||
    (!compactLayout &&
      (isToday ||
        (wideFocusRail && Boolean(liveFocus)) ||
        (railExpanded && Boolean(liveFocus || focusDraft))));
  const showStrip =
    Boolean(liveFocus) &&
    !showFullRail &&
    (compactLayout || !isToday);
  const focusedMinutes = focus.snapshot?.today.focusedMinutes ?? 0;
  const completedSessions = focus.snapshot?.today.completedSessions ?? 0;
  const firstRun =
    firstRunSeen === false &&
    data.workspaceEmpty;

  return (
    <main className="app-shell focus-shell">
      <Navigation
        {...model}
        data={data}
        liveFocus={liveFocus}
        isToday={isToday}
        focusedMinutes={focusedMinutes}
        completedSessions={completedSessions}
      />

      <section className="workspace">
        <button
          className="mobile-capture-button"
          aria-label="Search or add"
          onClick={openCommandPalette}
        >
          <Plus size={19} />
          <span>Capture</span>
        </button>
        {screen === "today" && firstRun && (
          <FirstRunPage
            today={data.today}
            title={newTask}
            saving={taskCreatePending}
            onTitleChange={setNewTask}
            onBegin={beginFirstRun}
            onCreateProject={openFirstProject}
            onOpenCapture={openCommandPalette}
          />
        )}
        {screen === "today" && !firstRun && today.page && (
          <TodayPage
            {...today.page}
            onFocusTransition={focus.transition}
            onAddTask={addTask}
            newTask={newTask}
            taskCreatePending={taskCreatePending}
            onNewTaskChange={setNewTask}
            onUpdateTask={updateTask}
            onSaveTaskField={saveTaskAttempt}
            onTaskSaveError={reportTaskSaveFailure}
            onTaskSaveRecovered={reportTaskSaveRecovery}
            onDeleteTask={deleteTask}
            onReorderTask={reorderTask}
            onAnnounce={setAppAnnouncement}
            onStartFocus={openFocus}
            onQueueTask={queueTask}
            onOpenProject={openProject}
            onOpenBacklog={() => navigate("backlog")}
            onLeaveUnfinished={(id) =>
              setDismissedUnfinished((current) => [...current, id])
            }
          />
        )}

        {screen.startsWith("day-") && (
          <DayPage
            view={screen.replace("day-", "") as DayView}
            today={data.today}
            todayKey={data.todayKey}
            dayKey={viewedDay.dayKey}
            dayKind={viewedDay.kind}
            earliestDayKey={viewedDay.earliestDayKey}
            forwardWeeks={
              viewedDay.forwardWeeks ?? data.dayViewForwardWeeks
            }
            dayLoading={viewedDay.loading}
            dayError={viewedDay.error}
            onChangeDay={(next) => {
              void viewedDay.setDay(next);
              // A future day opens on Timeline: Stream is built around
              // recorded Activity that such a day cannot have.
              if (next > (data?.todayKey ?? "")) navigate("day-timeline");
            }}
            onGoToToday={viewedDay.goToToday}
            tasks={dayTasks}
            activities={dayActivities}
            timeBlocks={dayTimeBlocks}
            projects={projectById}
            blockedMinutes={dayBlockedMinutes}
            recordedMinutes={dayRecordedMinutes}
            noteCount={data.notes.length}
            activeFocus={focus.active}
            focusNow={focus.now}
            focusBusy={focus.busy}
            onViewChange={(view) => navigate(`day-${view}`)}
            onStartFocus={openFocus}
            onQueueTask={queueTask}
            onFocusTransition={focus.transition}
            onOpenPalette={openCommandPalette}
            onCreateTimeBlock={openTimeBlockEditor}
            onEditTimeBlock={editTimeBlock}
            onEditActivity={activity.openEdit}
          />
        )}

        {screen === "projects" && (
          <ProjectsWorkspace
            projects={data.projects}
            selectedProjectId={selectedProjectId}
            createOpen={projectCreateOpen}
            today={data.today}
            onSelectedProjectChange={setSelectedProjectId}
            onCreateOpenChange={setProjectCreateOpen}
            onDataChanged={refresh}
            onStartFocus={openFocus}
            onOpenBacklog={openProjectBacklog}
          />
        )}

        {screen === "backlog" && backlog.page && (
          <BacklogPage
            {...backlog.page}
            onOpenProject={openProject}
            activeTaskId={focus.active?.taskId ?? null}
            onStartFocus={openFocus}
            onUpdateTask={updateTask}
            onOpenPalette={openCommandPalette}
          />
        )}

        {screen === "journal" && journal.page && (
          <JournalPage
            {...journal.page}
            onDiaryChange={setDiaryValue}
            onSaveDiary={saveDiary}
            onSaveError={reportDiarySaveFailure}
            onSaveRecovered={reportDiarySaveRecovery}
            noteDraft={noteDraft}
            noteSaving={noteSaving}
            onNoteDraftChange={(field, value) =>
              setNoteDraft((current) => ({ ...current, [field]: value }))
            }
            onNoteTaskChange={selectNoteTask}
            onAddNote={addNote}
            materialDraft={materialDraft}
            materialSaving={materialSaving}
            onMaterialDraftChange={(field, value) =>
              setMaterialDraft((current) => ({ ...current, [field]: value }))
            }
            onMaterialTaskChange={selectMaterialTask}
            onAddMaterial={addMaterial}
          />
        )}

        {screen === "review" && (
          <ReviewPage
            projects={data.projects}
            review={data.review}
            summary={data.reviewSummary}
            onSaveReview={saveReview}
            onSaveError={reportReviewSaveFailure}
            onSaveRecovered={reportReviewSaveRecovery}
            onOpenProject={openProject}
          />
        )}
      </section>

      <MobileMoreMenu {...model} />

      {phoneLayout && railExpanded && (liveFocus || focusDraft) && (
        <button
          className="focus-sheet-backdrop"
          aria-label="Close focus sheet"
          onClick={() => setRailExpanded(false)}
        />
      )}
      {showFullRail && (
        <FocusRail
          tasks={data.paletteTasks}
          projects={data.projects}
          today={data.today}
          draft={focusDraft}
          activities={data.activities}
          queuedTasks={queuedTasks}
          mode="full"
          collapsible={
            !focus.retryNext &&
            (compactLayout || (!isToday && !wideFocusRail))
          }
          onCollapse={() => setRailExpanded(false)}
          onOpenPalette={openCommandPalette}
          onQueueTask={(taskId, placement) => {
            const task = data.paletteTasks.find((item) => item.id === taskId);
            return task ? queueTask(task, placement) : Promise.resolve(false);
          }}
          onRemoveQueuedTask={(taskId) => {
            const task = data.paletteTasks.find((item) => item.id === taskId);
            return task ? removeQueuedTask(task) : Promise.resolve(false);
          }}
          onReorderQueue={reorderQueue}
          onQueueChanged={refresh}
          onAnnounce={setAppAnnouncement}
        />
      )}
      {showStrip && (
        <FocusRail
          tasks={data.paletteTasks}
          projects={data.projects}
          today={data.today}
          draft={focusDraft}
          activities={data.activities}
          queuedTasks={queuedTasks}
          mode="strip"
          onExpand={
            phoneLayout || !compactLayout ? () => setRailExpanded(true) : undefined
          }
        />
      )}

      {paletteOpen && (
        <CommandPalette
          resolution={paletteResolution}
          query={paletteQuery}
          onQueryChange={setPaletteQuery}
          onActivate={activatePaletteItem}
          onDismiss={dismissCommandPalette}
        />
      )}

      {timeBlockEditor && (
        <TimeBlockDialog
          mode={timeBlockEditor.id === null ? "create" : "edit"}
          dateLabel={formatLongLocalDateKey(timeBlockEditor.date)}
          draft={timeBlockEditor.draft}
          tasks={timeBlockDialogTasks}
          saving={timeBlockSaving}
          error={timeBlockError}
          errorField={timeBlockErrorField}
          onDraftChange={(draft) => {
            setTimeBlockEditor((current) =>
              current ? { ...current, draft } : current
            );
            setTimeBlockError("");
            setTimeBlockErrorField(null);
          }}
          onTaskChange={changeTimeBlockTask}
          onClose={() => {
            setTimeBlockEditor(null);
            setTimeBlockError("");
            setTimeBlockErrorField(null);
          }}
          onSave={saveTimeBlock}
          onDelete={
            timeBlockEditor.id === null ? undefined : deleteTimeBlock
          }
        />
      )}

      {activity.open && (
        <ActivityDialog
          mode={activity.editor ? "edit" : "create"}
          tasks={activity.dialogTasks}
          projects={data.projects}
          todayKey={data.todayKey}
          categorySuggestions={data.activityCategorySuggestions}
          draft={activity.draft}
          originalTaskId={activity.editor?.original.taskId ?? null}
          originalInheritedProjectId={
            activity.editor?.original.taskId &&
            activity.editor.original.projectId === null
              ? activity.editor.original.attributedProjectId
              : null
          }
          error={activity.error}
          saving={activity.saving}
          onDraftChange={activity.changeDraft}
          onClose={activity.close}
          onSave={activity.save}
        />
      )}
      {dataManagementOpen && (
        <DataManagementDialog
          onClose={() => setDataManagementOpen(false)}
          onAnnounce={setAppAnnouncement}
        />
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {appAnnouncement}
      </div>
      {appError && (
        <div className="app-error-toast" role="alert">
          <span>{appError}</span>
          <button className="text-button" onClick={() => setAppError("")}>
            Dismiss
          </button>
        </div>
      )}
    </main>
  );
}
