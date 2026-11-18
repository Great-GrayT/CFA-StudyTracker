"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  useDeclare,
  useDeleteMock,
  useDeleteTask,
  usePatchMock,
  usePlan,
  usePlanPackages,
  usePackages,
  useRemoveDeclaration,
  useSubmitTask,
} from "@/lib/hooks";
import {
  asksQuestions,
  CONF_WORD,
  deleteEffect,
  mockFormError,
  STEP_TITLES,
  taskFormError,
  taskFormOf,
  taskPatch,
  type MockForm,
  type TaskForm,
} from "@/lib/history";
import { declarationItem, questionsError } from "@/lib/record";
import { dateError, todayIn } from "@/lib/starting-point";
import { DeclaredDate } from "@/components/record/declared-date";
import { cn } from "@/lib/utils";
import type { HistoryDeclarationRecord, HistoryMock, HistoryRecord, HistoryTaskRecord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA").format(d);
const dayToDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p className="text-alarm-ink text-[13px]" role="alert">
      {message}
    </p>
  ) : null;
}

/** Confidence 1 to 5, the Record sheet's control without its decorative bar. */
function ConfidenceField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium">Confidence</legend>
      <ToggleGroup
        type="single"
        variant="outline"
        value={String(value)}
        onValueChange={(v) => v && onChange(Number(v))}
        className="grid w-full grid-cols-5"
        aria-label="Confidence, 1 to 5"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <ToggleGroupItem
            key={n}
            value={String(n)}
            aria-label={`${n} of 5, ${CONF_WORD[n - 1].toLowerCase()}`}
            className="data-[state=on]:bg-accent h-11 flex-col gap-0 px-0 md:h-10"
          >
            <span className="tabular-nums">{n}</span>
            <span className="text-muted-foreground text-[12px] font-normal max-sm:hidden">{CONF_WORD[n - 1]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </fieldset>
  );
}

const DIALOG = "max-h-[92dvh] gap-5 overflow-y-auto sm:max-w-md";

// ---- Edit a recorded task ---------------------------------------------------

export function EditTaskDialog({
  planId,
  rec,
  onClose,
}: {
  planId: string;
  rec: HistoryTaskRecord | null;
  onClose: () => void;
}) {
  // Kept through the close animation so the fields do not blank as it fades.
  const [shown, setShown] = useState<HistoryTaskRecord | null>(rec);
  if (rec && rec !== shown) setShown(rec);
  return (
    <Dialog open={!!rec} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={DIALOG}>
        {shown ? <TaskFormBody key={shown.id} planId={planId} rec={shown} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskFormBody({ planId, rec, onClose }: { planId: string; rec: HistoryTaskRecord; onClose: () => void }) {
  const submit = useSubmitTask(planId);
  const planPackages = usePlanPackages(planId);
  const packages = usePackages();
  const [f, setF] = useState<TaskForm>(() => taskFormOf(rec));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TaskForm>(k: K, v: TaskForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const today = isoDay(new Date());
  const problem = taskFormError(f, rec, today);
  const questions = asksQuestions(rec);

  // Plan packages only: the server refuses any other. The current one is kept
  // selectable even if it has since left the plan, so the field never lies.
  const options = new Map<string, string>();
  for (const p of planPackages.data ?? []) {
    options.set(p.packageId, p.name ?? packages.data?.find((x) => x.id === p.packageId)?.name ?? "Package");
  }
  if (rec.packageId && !options.has(rec.packageId)) options.set(rec.packageId, rec.packageName ?? "Current package");

  async function save() {
    setError(null);
    try {
      await submit.mutateAsync({ taskId: rec.id, ...taskPatch(f, rec) });
      toast.success("Record updated");
      onClose();
    } catch (err) {
      setError(messageOf(err, "Could not save that. The record is unchanged."));
    }
  }

  return (
    <>
      <DialogHeader className="text-left sm:text-left">
        <DialogTitle className="text-[18px] font-semibold">Edit record</DialogTitle>
        <DialogDescription className="text-[13px]">
          Saving rebuilds the coming days from the corrected record.
        </DialogDescription>
      </DialogHeader>
      <form
        id="edit-task-form"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" id="et-date">
            <DatePicker
              id="et-date"
              value={dayToDate(f.date)}
              onChange={(d) => d && set("date", isoDay(d))}
              max={new Date()}
            />
          </Field>
          <Field label="Package" id="et-package">
            <Select value={f.packageId || undefined} onValueChange={(v) => set("packageId", v)} disabled={options.size === 0}>
              <SelectTrigger id="et-package" className="w-full min-w-0">
                <SelectValue placeholder="Not in a package" />
              </SelectTrigger>
              <SelectContent>
                {[...options].map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-[1fr_7rem] items-end gap-3">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Status</legend>
            <RadioGroup
              aria-label="Status"
              value={f.status}
              onValueChange={(v) => set("status", v as TaskForm["status"])}
              className="flex gap-5"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="et-done" value="done" />
                <Label htmlFor="et-done" className="font-normal">
                  Done
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="et-partial" value="partial" />
                <Label htmlFor="et-partial" className="font-normal">
                  Partway
                </Label>
              </div>
            </RadioGroup>
          </fieldset>
          <Field label="Minutes" id="et-minutes">
            <Input
              id="et-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              className="tabular-nums"
              value={f.minutes}
              onChange={(e) => set("minutes", e.target.value)}
            />
          </Field>
        </div>

        {questions ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Questions answered" id="et-answered">
                <Input
                  id="et-answered"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="tabular-nums"
                  value={f.answered}
                  onChange={(e) => set("answered", e.target.value)}
                />
              </Field>
              <Field label="Correct" id="et-correct">
                <Input
                  id="et-correct"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="tabular-nums"
                  value={f.correct}
                  aria-invalid={Number(f.correct || 0) > Number(f.answered || 0)}
                  onChange={(e) => set("correct", e.target.value)}
                />
              </Field>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="et-reviewed"
                className="mt-0.5"
                checked={f.reviewed}
                onCheckedChange={(v) => set("reviewed", v === true)}
              />
              <Label htmlFor="et-reviewed" className="leading-snug font-normal">
                Reviewed the answers
              </Label>
            </div>
            {f.reviewed ? (
              <div className="pl-7">
                <Field label="Minutes on the review" id="et-review-minutes">
                  <Input
                    id="et-review-minutes"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={600}
                    className="w-28 tabular-nums"
                    value={f.reviewMinutes}
                    onChange={(e) => set("reviewMinutes", e.target.value)}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}

        <ConfidenceField value={f.confidence} onChange={(n) => set("confidence", n)} />

        <Field label="Note" id="et-note">
          <Textarea id="et-note" rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} />
        </Field>

        {problem ? <p className="text-muted-foreground text-[13px]" aria-live="polite">{problem}</p> : null}
        <ErrorLine message={error} />
      </form>
      <DialogFooter className="sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="edit-task-form" disabled={!!problem || submit.isPending}>
          {submit.isPending ? "Saving" : "Save changes"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---- Edit a self-stated step ------------------------------------------------

export function EditDeclarationDialog({
  planId,
  readingId,
  moduleName,
  rec,
  onClose,
}: {
  planId: string;
  readingId: string;
  moduleName: string;
  rec: HistoryDeclarationRecord | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<HistoryDeclarationRecord | null>(rec);
  if (rec && rec !== shown) setShown(rec);
  return (
    <Dialog open={!!rec} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={DIALOG}>
        {shown ? (
          <DeclarationBody
            key={shown.step + shown.updatedAt}
            planId={planId}
            readingId={readingId}
            moduleName={moduleName}
            rec={shown}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeclarationBody({
  planId,
  readingId,
  moduleName,
  rec,
  onClose,
}: {
  planId: string;
  readingId: string;
  moduleName: string;
  rec: HistoryDeclarationRecord;
  onClose: () => void;
}) {
  const declare = useDeclare(planId);
  const plan = usePlan();
  const today = todayIn(plan.data?.timeZone);
  const [date, setDate] = useState(rec.date.slice(0, 10));
  const asksCounts = rec.step === 2 || rec.step === 4;
  const [confidence, setConfidence] = useState(rec.confidence ?? 3);
  const [answered, setAnswered] = useState(rec.answered ? String(rec.answered) : "");
  const [correct, setCorrect] = useState(rec.answered ? String(rec.correct ?? 0) : "");
  const [error, setError] = useState<string | null>(null);
  const problem =
    (asksCounts && answered !== "" ? questionsError(answered, correct) : null) ??
    dateError([{ readingId, step: rec.step, date }], [], today);

  async function save() {
    setError(null);
    try {
      await declare.mutateAsync([declarationItem(readingId, rec.step, { confidence, answered, correct, date })]);
      toast.success("Self-stated step updated. The plan was rebuilt from today.");
      onClose();
    } catch (err) {
      setError(messageOf(err, "Could not save that. The step is unchanged."));
    }
  }

  return (
    <>
      <DialogHeader className="text-left sm:text-left">
        <DialogTitle className="text-[18px] font-semibold">Edit self-stated {STEP_TITLES[rec.step].toLowerCase()}</DialogTitle>
        <DialogDescription className="text-[13px]">
          {moduleName}. A self-state is treated as real study on its date. Saving rebuilds the plan from today.
        </DialogDescription>
      </DialogHeader>
      <form
        id="edit-decl-form"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) void save();
        }}
      >
        {asksCounts ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Questions answered" id="ed-answered">
              <Input
                id="ed-answered"
                type="number"
                inputMode="numeric"
                min={0}
                className="tabular-nums"
                value={answered}
                onChange={(e) => setAnswered(e.target.value)}
              />
            </Field>
            <Field label="Correct" id="ed-correct">
              <Input
                id="ed-correct"
                type="number"
                inputMode="numeric"
                min={0}
                className="tabular-nums"
                value={correct}
                onChange={(e) => setCorrect(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <ConfidenceField value={confidence} onChange={setConfidence} />
        )}
        <DeclaredDate id="ed-date" label="Date" hint={null} value={date} max={today} onChange={setDate} />
        {problem ? <p className="text-muted-foreground text-[13px]" aria-live="polite">{problem}</p> : null}
        <ErrorLine message={error} />
      </form>
      <DialogFooter className="sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="edit-decl-form" disabled={!!problem || declare.isPending}>
          {declare.isPending ? "Saving" : "Save changes"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---- Edit a mock ------------------------------------------------------------

export function EditMockDialog({
  planId,
  topicId,
  topicName,
  mock,
  onClose,
}: {
  planId: string;
  topicId: string;
  topicName: string;
  mock: HistoryMock | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<HistoryMock | null>(mock);
  if (mock && mock !== shown) setShown(mock);
  return (
    <Dialog open={!!mock} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={DIALOG}>
        {shown ? (
          <MockBody key={shown.id} planId={planId} topicId={topicId} topicName={topicName} mock={shown} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MockBody({
  planId,
  topicId,
  topicName,
  mock,
  onClose,
}: {
  planId: string;
  topicId: string;
  topicName: string;
  mock: HistoryMock;
  onClose: () => void;
}) {
  const patch = usePatchMock(planId);
  const [f, setF] = useState<MockForm>({
    date: mock.date.slice(0, 10),
    score: String(mock.scorePercent),
    answered: String(mock.answered),
    correct: String(mock.correct),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof MockForm, v: string) => setF((p) => ({ ...p, [k]: v }));
  const problem = mockFormError(f, isoDay(new Date()));

  async function save() {
    setError(null);
    try {
      await patch.mutateAsync({
        id: mock.id,
        date: f.date,
        scorePercent: Number(f.score),
        topicScores: [{ topicId, answered: Number(f.answered || 0), correct: Number(f.correct || 0) }],
      });
      toast.success("Mock updated");
      onClose();
    } catch (err) {
      setError(messageOf(err, "Could not save that. The mock is unchanged."));
    }
  }

  return (
    <>
      <DialogHeader className="text-left sm:text-left">
        <DialogTitle className="text-[18px] font-semibold">Edit mock</DialogTitle>
        <DialogDescription className="text-[13px]">
          The score covers the whole mock. The counts below are for {topicName} only.
        </DialogDescription>
      </DialogHeader>
      <form
        id="edit-mock-form"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" id="em-date">
            <DatePicker id="em-date" value={dayToDate(f.date)} onChange={(d) => d && set("date", isoDay(d))} max={new Date()} />
          </Field>
          <Field label="Score, percent" id="em-score">
            <Input
              id="em-score"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              className="tabular-nums"
              value={f.score}
              onChange={(e) => set("score", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Answered in this topic" id="em-answered">
            <Input
              id="em-answered"
              type="number"
              inputMode="numeric"
              min={0}
              className="tabular-nums"
              value={f.answered}
              onChange={(e) => set("answered", e.target.value)}
            />
          </Field>
          <Field label="Correct" id="em-correct">
            <Input
              id="em-correct"
              type="number"
              inputMode="numeric"
              min={0}
              className="tabular-nums"
              value={f.correct}
              onChange={(e) => set("correct", e.target.value)}
            />
          </Field>
        </div>
        {problem ? <p className="text-muted-foreground text-[13px]" aria-live="polite">{problem}</p> : null}
        <ErrorLine message={error} />
      </form>
      <DialogFooter className="sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="edit-mock-form" disabled={!!problem || patch.isPending}>
          {patch.isPending ? "Saving" : "Save changes"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---- Delete -----------------------------------------------------------------

export type DeleteTarget =
  | { kind: "record"; rec: HistoryRecord; readingId: string; label: string }
  | { kind: "mock"; mock: HistoryMock; label: string };

/** One confirm for tasks, self-stated steps and mocks, with the replan effect spelled out. */
export function DeleteRecordDialog({
  planId,
  target,
  onClose,
}: {
  planId: string;
  target: DeleteTarget | null;
  onClose: () => void;
}) {
  const delTask = useDeleteTask(planId);
  const delDecl = useRemoveDeclaration(planId);
  const delMock = useDeleteMock(planId);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<DeleteTarget | null>(target);
  if (target && target !== shown) setShown(target);
  const pending = delTask.isPending || delDecl.isPending || delMock.isPending;

  async function confirm() {
    if (!target) return;
    setError(null);
    try {
      if (target.kind === "mock") await delMock.mutateAsync(target.mock.id);
      else if (target.rec.type === "task") await delTask.mutateAsync(target.rec.id);
      else await delDecl.mutateAsync({ readingId: target.readingId, step: target.rec.step });
      toast.success("Deleted. The plan was rebuilt.");
      onClose();
    } catch (err) {
      setError(messageOf(err, "Could not delete that. Nothing was changed."));
    }
  }

  const effect =
    shown?.kind === "mock"
      ? "The mock leaves your trend and table, its topic scores are removed, and the coming days are rebuilt."
      : shown
        ? deleteEffect(shown.rec)
        : "";

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader className="text-left sm:text-left">
          <DialogTitle className="text-[18px] font-semibold">Delete this record?</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            {shown ? <span className="text-foreground block pb-1">{shown.label}</span> : null}
            {effect}
          </DialogDescription>
        </DialogHeader>
        <ErrorLine message={error} />
        <DialogFooter className={cn("sm:justify-end")}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={pending}>
            {pending ? "Deleting" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
