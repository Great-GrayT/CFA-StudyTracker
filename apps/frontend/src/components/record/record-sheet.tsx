"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useCreateSession,
  useSubmitTask,
  useCurriculum,
  usePackages,
  usePlan,
  usePlanPackages,
  usePrescription,
  type SessionKind,
  type TaskSubmission,
} from "@/lib/hooks";
import { ApiError, messageForStatus } from "@/lib/api";
import type { PackageRole } from "@/lib/types";
import { useIsMobile } from "@/hooks/ui/use-mobile";
import { cn } from "@/lib/utils";
import { minutesLabel } from "@/components/day-plan";
import { questionsError, resolvePreset, taskQuestionCount } from "@/lib/record";
import { useOnline } from "@/hooks/use-online";
import { useUndoRecord } from "./use-undo-record";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combo-box";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import type { RecordPreset } from "./record-provider";

// The plan-shaped record from components/composer.tsx, rebuilt on the kit.
// Same fields, order, endpoint and planned-cell match; only the controls changed.

const KINDS: { value: SessionKind; label: string; verb: string }[] = [
  { value: "content-notes", label: "Read notes", verb: "Read" },
  { value: "content-video", label: "Watch video", verb: "Watch" },
  { value: "eocq", label: "End of chapter questions", verb: "Questions" },
  { value: "questions", label: "Question bank", verb: "Questions" },
  { value: "review", label: "Review", verb: "Review" },
];
const QUESTION_KINDS = new Set<SessionKind>(["eocq", "questions"]);
const NO_PACKAGE = "none"; // Radix Select reserves the empty string.

// Confidence is 1 to 5 and the ramp has four steps, so 1 stays unfilled and
// 2 to 5 take conf-1 to conf-4: darker always means surer.
const CONF_FILL = ["", "bg-conf-1", "bg-conf-2", "bg-conf-3", "bg-conf-4"];
const CONF_WORD = ["Shaky", "Unsure", "Fair", "Solid", "Sure"];

function roleFor(kind: SessionKind): PackageRole {
  return QUESTION_KINDS.has(kind) ? "questions" : "content";
}
const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA").format(d);
const localToday = () => isoDay(new Date());
// Local midnight, not UTC: the API speaks the candidate's own calendar days.
const dayToDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};


export function RecordSheet({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: RecordPreset;
}) {
  const isMobile = useIsMobile();
  const online = useOnline();
  const plan = usePlan();
  const planId = plan.data?.id;
  const curriculum = useCurriculum(plan.data?.levelId);
  const packages = usePackages();
  const planPackages = usePlanPackages(planId);
  const createSession = useCreateSession(planId);
  const submitTask = useSubmitTask(planId);
  const undoRecord = useUndoRecord(planId);

  const [topicId, setTopicId] = useState("");
  const [readingId, setReadingId] = useState("");
  const [kind, setKind] = useState<SessionKind>("content-notes");
  const [packageId, setPackageId] = useState("");
  const [packageTouched, setPackageTouched] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [confidence, setConfidence] = useState(3);
  const [answered, setAnswered] = useState("");
  const [correct, setCorrect] = useState("");
  const [date, setDate] = useState(localToday);
  const [note, setNote] = useState("");
  const [attach, setAttach] = useState(true);
  const [finished, setFinished] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [reviewMinutes, setReviewMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const topics = useMemo(
    () => [...(curriculum.data?.topics ?? [])].sort((a, b) => a.order - b.order),
    [curriculum.data],
  );
  const topic = topics.find((t) => t.id === topicId);
  const readings = useMemo(() => [...(topic?.readings ?? [])].sort((a, b) => a.order - b.order), [topic]);
  const reading = readings.find((r) => r.id === readingId);
  const kindMeta = KINDS.find((k) => k.value === kind)!;
  const asksQuestions = QUESTION_KINDS.has(kind);

  const packageOptions = useMemo(() => {
    const all = packages.data ?? [];
    const nameOf = (id: string) => all.find((p) => p.id === id)?.name;
    const onPlan = (planPackages.data ?? [])
      .map((pp) => ({ id: pp.packageId, name: pp.name ?? nameOf(pp.packageId) ?? "Package", roles: pp.roles }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const rest = all
      .filter((p) => !onPlan.some((o) => o.id === p.id))
      .map((p) => ({ id: p.id, name: p.name, roles: [] as PackageRole[] }));
    return { onPlan, rest };
  }, [planPackages.data, packages.data]);

  // Follow the kind to the plan's package for it until the candidate picks one.
  useEffect(() => {
    if (packageTouched) return;
    const wanted = packageOptions.onPlan.find((p) => p.roles.includes(roleFor(kind)));
    setPackageId(wanted?.id ?? "");
  }, [kind, packageOptions, packageTouched]);

  const dayPlan = usePrescription(planId, date, date);
  const dayTasks = dayPlan.data?.days[0]?.tasks;

  // Every open clears the error and returns the date to the preset's or today.
  // Section, module and kind change only when the preset names them; a plain
  // open keeps the last sitting's.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDate(preset.date ?? localToday());
  }, [open, preset]);

  // Applied once per preset object (each open makes a new one). Records and
  // Undo refetch the day, and reapplying then would overwrite the candidate's
  // edits, such as the module "Record and next" just cleared.
  const appliedPreset = useRef<RecordPreset | null>(null);
  useEffect(() => {
    if (!open || appliedPreset.current === preset) return;
    const day = dayPlan.data?.days[0];
    const fields = resolvePreset(preset, topics, day, localToday());
    if (!fields) return; // waits for the syllabus or the day's cells
    appliedPreset.current = preset;
    if (fields.topicId) setTopicId(fields.topicId);
    if (fields.readingId) setReadingId(fields.readingId);
    if (fields.kind) setKind(fields.kind);
  }, [open, preset, topics, dayPlan.data]);

  const matchedTask = useMemo(() => {
    if (!readingId) return undefined;
    return (dayTasks ?? []).find(
      (t) => !t.offPlan && t.status === "pending" && t.kind === kind && t.readingIds.includes(readingId),
    );
  }, [dayTasks, readingId, kind]);
  useEffect(() => {
    setAttach(true);
    setFinished(true);
    setReviewed(false);
    setReviewMinutes("");
    if (matchedTask) {
      setMinutes((m) => m || String(matchedTask.estimatedMinutes));
      // A known question count is prefilled and stays editable.
      const n = taskQuestionCount(matchedTask);
      if (n) setAnswered((a) => a || String(n));
    }
  }, [matchedTask]);
  const recordsTask = matchedTask !== undefined && attach;
  const knownCount = recordsTask ? taskQuestionCount(matchedTask!) : null;

  const minutesNum = Number(minutes);
  const minutesValid = Number.isInteger(minutesNum) && minutesNum >= 1 && minutesNum <= 600;
  const answeredNum = Number(answered) || 0;
  const correctNum = Number(correct) || 0;
  const accuracy = asksQuestions && answeredNum > 0 ? (correctNum / answeredNum) * 100 : null;
  const correctTooHigh = asksQuestions && correctNum > answeredNum;
  // A planned question task needs its counts; an off-plan one may skip them.
  const questionsMsg =
    asksQuestions && (knownCount !== null || answered !== "" || correct !== "") ? questionsError(answered, correct) : null;
  const reviewMinutesNum = Number(reviewMinutes);
  const reviewMinutesValid = !reviewed || reviewMinutes === "" || (Number.isInteger(reviewMinutesNum) && reviewMinutesNum >= 1 && reviewMinutesNum <= 600);
  const packageName = [...packageOptions.onPlan, ...packageOptions.rest].find((p) => p.id === packageId)?.name;
  const busy = createSession.isPending || submitTask.isPending;
  const ready = !!readingId && minutesValid && !questionsMsg && reviewMinutesValid;

  function undo(taskId: string) {
    void undoRecord.undo(taskId);
  }

  async function submit(andNext: boolean) {
    if (!readingId) return setError("Choose a section and module first.");
    if (!minutesValid) return setError("Enter whole minutes between 1 and 600.");
    if (questionsMsg) return setError(questionsMsg);
    if (!reviewMinutesValid) return setError("Enter whole minutes for the answer review.");
    setError(null);
    const taskId = recordsTask ? matchedTask!.id : undefined;
    try {
      if (taskId) {
        // Planned work goes through the task, which carries the answer review.
        await submitTask.mutateAsync({
          taskId,
          status: finished ? "done" : "partial",
          actualMinutes: minutesNum,
          confidence,
          ...(asksQuestions ? { questionsAnswered: answeredNum, questionsCorrect: correctNum } : {}),
          ...(asksQuestions ? { answerReviewDone: reviewed } : {}),
          ...(asksQuestions && reviewed && reviewMinutes !== "" ? { answerReviewMinutes: reviewMinutesNum } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        } as TaskSubmission & { taskId: string });
      } else await createSession.mutateAsync({
        readingId,
        kind,
        minutes: minutesNum,
        confidence,
        date,
        ...(packageId ? { packageId } : {}),
        ...(asksQuestions ? { questionsAnswered: answeredNum, questionsCorrect: correctNum } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      // Off-plan records have no Undo: they are deleted from the journal instead.
      toast.success("Recorded", {
        description: taskId ? "Settled against your plan." : "Added off plan. Your plan is updated around it.",
        // Longer than the default so Undo can be reached before it goes.
        ...(taskId ? { action: { label: "Undo", onClick: () => undo(taskId) }, duration: 10_000 } : {}),
      });
      setMinutes("");
      setAnswered("");
      setCorrect("");
      setReviewed(false);
      setReviewMinutes("");
      setNote("");
      if (andNext) {
        // Same section, package and day: the next session is usually the next module.
        setReadingId("");
        queueMicrotask(() => document.getElementById("record-module")?.focus());
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that. Nothing was recorded.");
    }
  }

  const loadFailed = curriculum.isError || plan.isError;
  const body = (
    <form
      id="record-form"
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4 md:px-5">
        {!online ? (
          <p className="text-muted-foreground text-[13px]" role="status">
            Offline, showing saved data. Recording needs a connection.
          </p>
        ) : null}
        {loadFailed ? (
          <div className="flex items-center justify-between gap-3 text-[13px]" role="alert">
            <span>
              {messageForStatus(
                (curriculum.error ?? plan.error) instanceof ApiError
                  ? ((curriculum.error ?? plan.error) as ApiError).status
                  : 0,
                "The syllabus did not load.",
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (plan.isError ? plan.refetch() : curriculum.refetch())}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {/* Stacked, not paired: module names run to 80 characters. */}
        <div className="grid gap-3">
          <Field label="Section" id="record-section" labelId="record-section-label">
            <Combobox
              id="record-section"
              aria-labelledby="record-section-label"
              className="w-full"
              data={topics.map((t) => ({ value: t.id, label: t.name }))}
              isLoading={plan.isLoading || curriculum.isLoading}
              placeholder="Choose a section"
              searchPlaceholder="Search sections"
              noResultsText="No section matches."
              value={topicId}
              onChange={(v) => {
                setTopicId(v as string);
                setReadingId("");
              }}
            />
          </Field>
          <Field label="Module" id="record-module" labelId="record-module-label">
            <Combobox
              id="record-module"
              aria-labelledby="record-module-label"
              className="w-full"
              data={readings.map((r) => ({ value: r.id, label: r.name }))}
              disabled={!topic}
              placeholder={topic ? "Choose a module" : "Choose a section first"}
              searchPlaceholder="Search modules"
              noResultsText="No module matches."
              value={readingId}
              onChange={(v) => setReadingId(v as string)}
            />
          </Field>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-[13px] font-medium">Type</legend>
          <ToggleGroup
            type="single"
            variant="outline"
            value={kind}
            // Radix clears the value when the active item is pressed again; a
            // record always has a type, so that press is ignored.
            onValueChange={(v) => v && setKind(v as SessionKind)}
            className="flex w-full flex-wrap gap-1.5"
          >
            {KINDS.map((k) => (
              <ToggleGroupItem
                key={k.value}
                value={k.value}
                className="h-9 flex-none rounded-md border-l px-3 first:rounded-md last:rounded-md data-[state=on]:border-primary data-[state=on]:bg-accent max-md:h-11"
              >
                {k.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </fieldset>

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Package" id="record-package">
            <Select
              value={packageId || NO_PACKAGE}
              onValueChange={(v) => {
                setPackageTouched(true);
                setPackageId(v === NO_PACKAGE ? "" : v);
              }}
            >
              <SelectTrigger id="record-package" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PACKAGE}>Not in a package</SelectItem>
                {packageOptions.onPlan.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel className="text-muted-foreground text-xs">On your plan</SelectLabel>
                    {packageOptions.onPlan.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {packageOptions.rest.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel className="text-muted-foreground text-xs">Other packages</SelectLabel>
                    {packageOptions.rest.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Minutes" id="record-minutes">
            <Input
              id="record-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              className="tabular-nums"
              value={minutes}
              aria-invalid={minutes !== "" && !minutesValid}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </Field>
        </div>

        {matchedTask ? (
          <fieldset className="border-border space-y-3 border-t pt-4">
            <legend className="sr-only">On your plan</legend>
            <div className="flex items-start gap-3">
              <Checkbox
                id="record-attach"
                className="mt-0.5"
                checked={attach}
                onCheckedChange={(v) => setAttach(v === true)}
              />
              <Label htmlFor="record-attach" className="leading-snug font-normal">
                This is the planned {kindMeta.label.toLowerCase()} for this module ({minutesLabel(matchedTask.estimatedMinutes)})
              </Label>
            </div>
            {attach ? (
              <RadioGroup
                aria-label="How much of it"
                value={finished ? "finished" : "partway"}
                onValueChange={(v) => setFinished(v === "finished")}
                className="flex gap-5 pl-7"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="record-finished" value="finished" />
                  <Label htmlFor="record-finished" className="font-normal">
                    Finished
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="record-partway" value="partway" />
                  <Label htmlFor="record-partway" className="font-normal">
                    Got partway
                  </Label>
                </div>
              </RadioGroup>
            ) : null}
          </fieldset>
        ) : null}

        {asksQuestions ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <Field label={knownCount ? "Questions answered (set by your package)" : "Questions answered"} id="record-answered">
                <Input
                  id="record-answered"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="tabular-nums"
                  value={answered}
                  onChange={(e) => setAnswered(e.target.value)}
                />
              </Field>
              <Field label="Correct" id="record-correct">
                <Input
                  id="record-correct"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="tabular-nums"
                  value={correct}
                  aria-invalid={correctTooHigh}
                  onChange={(e) => setCorrect(e.target.value)}
                />
              </Field>
            </div>
            {questionsMsg && (answered !== "" || correct !== "") ? (
              <p className="text-alarm-ink text-[13px]" role="alert">
                {questionsMsg}
              </p>
            ) : null}
            {recordsTask ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="record-reviewed"
                    className="mt-0.5"
                    checked={reviewed}
                    onCheckedChange={(v) => setReviewed(v === true)}
                  />
                  <Label htmlFor="record-reviewed" className="leading-snug font-normal">
                    Reviewed the answers
                  </Label>
                </div>
                {reviewed ? (
                  <div className="pl-7">
                    <Field label="Minutes on the review" id="record-review-minutes">
                      <Input
                        id="record-review-minutes"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={600}
                        className="w-28 tabular-nums"
                        value={reviewMinutes}
                        aria-invalid={!reviewMinutesValid}
                        onChange={(e) => setReviewMinutes(e.target.value)}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* Live, so the review flag is never a surprise after saving. */}
            {accuracy !== null ? (
              <p
                className={cn("text-[13px] tabular-nums", accuracy < 60 ? "text-alarm-ink" : "text-muted-foreground")}
                aria-live="polite"
              >
                {Math.round(accuracy)}% accuracy{accuracy < 60 ? ". Below 60% flags this for review." : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Confidence</legend>
          <ToggleGroup
            type="single"
            value={String(confidence)}
            onValueChange={(v) => v && setConfidence(Number(v))}
            className="grid w-full grid-cols-5 gap-1"
            aria-label="Confidence, 1 to 5"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <ToggleGroupItem
                key={n}
                value={String(n)}
                aria-label={`${n} of 5, ${CONF_WORD[n - 1].toLowerCase()}`}
                className="text-muted-foreground data-[state=on]:text-foreground relative h-11 flex-col gap-0.5 rounded-none px-0 first:rounded-none last:rounded-none data-[state=on]:bg-transparent data-[state=on]:font-semibold md:h-10"
              >
                <span className="tabular-nums">{n}</span>
                <span className="text-[12px] font-normal">{CONF_WORD[n - 1]}</span>
                {/* The bar fills up to the chosen value, so the scale reads as a level. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-[3px]",
                    n <= confidence ? CONF_FILL[n - 1] || "bg-input" : "bg-border",
                  )}
                />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" id="record-date">
            <DatePicker
              id="record-date"
              value={dayToDate(date)}
              onChange={(d) => d && setDate(isoDay(d))}
              max={new Date()}
            />
          </Field>
          <Field label="Note" id="record-note">
            <Textarea
              id="record-note"
              rows={1}
              className="min-h-9 max-md:min-h-11"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>

        {/* The cell this record becomes, so the result is never a guess. */}
        {reading ? (
          <div
            className="border-border flex items-stretch gap-3 border-y py-2.5"
            aria-live="polite"
            aria-label="Preview of the cell"
          >
            <span
              aria-hidden="true"
              className={cn("w-[3px] shrink-0", recordsTask ? "bg-primary" : "bg-input")}
            />
            <div className="min-w-0 flex-1">
              <p className="font-prose truncate text-[16px] leading-snug" title={reading.name}>
                {reading.name}
              </p>
              <p className="text-muted-foreground truncate text-[13px]">
                {kindMeta.verb} in {packageName ?? "no package"}, {recordsTask ? "on plan" : "off plan"}
              </p>
            </div>
            <span className="self-center text-[13px] tabular-nums">
              {minutesValid ? minutesLabel(minutesNum) : "Minutes?"}
            </span>
          </div>
        ) : null}

        {error ? (
          <p className="text-alarm-ink text-[13px]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );

  const actions = (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy || !ready}
        onClick={() => void submit(true)}
      >
        Record and next
      </Button>
      <Button type="submit" form="record-form" disabled={busy || !ready}>
        {busy ? "Recording" : "Record"}
      </Button>
    </>
  );

  const description = "Section, module and minutes are required. A matching planned cell can be settled.";

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-card data-[vaul-drawer-direction=bottom]:max-h-[92dvh] data-[vaul-drawer-direction=bottom]:rounded-t-xl">
          <DrawerHeader className="px-4 pt-2 pb-3 text-left">
            <DrawerTitle className="text-[16px]">Record study</DrawerTitle>
            <DrawerDescription className="sr-only">{description}</DrawerDescription>
          </DrawerHeader>
          {body}
          <DrawerFooter className="border-border grid grid-cols-2 border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
            {actions}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="bg-card w-full gap-0 sm:max-w-[440px]">
        <SheetHeader className="px-5 pt-5 pb-4">
          <SheetTitle className="text-[16px]">Record study</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>
        {body}
        <SheetFooter className="border-border flex-row justify-end border-t px-5 py-3">{actions}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  id,
  labelId,
  children,
}: {
  label: string;
  id: string;
  labelId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label id={labelId} htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
    </div>
  );
}
