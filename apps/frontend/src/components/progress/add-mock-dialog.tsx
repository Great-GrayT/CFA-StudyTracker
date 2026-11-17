"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { keys, useCurriculum, useMockSessions, usePackages, usePlan } from "@/lib/hooks";
import { invalidateProjection } from "@/lib/plan-invalidation";
import { mockError, rowsFromMix, toTopicScores, totals, type MockRow } from "@/lib/mock-entry";
import { X } from "lucide-react";
import type { MockExam } from "@/lib/types";
import { useOnline } from "@/hooks/use-online";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NO_PACKAGE = "none"; // Radix Select reserves the empty string.
const NO_SESSION = "none";
// The API speaks the candidate's own calendar days, so local, not UTC.
const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA").format(d);

export function AddMockDialog({
  planId,
  open,
  onOpenChange,
}: {
  planId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const packages = usePackages();
  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const sessions = useMockSessions(planId);
  const topics = [...(curriculum.data?.topics ?? [])].sort((a, b) => a.order - b.order);
  const session = (sessions.data ?? []).find((m) => m.ref === sessionRef);
  const [date, setDate] = useState<Date | undefined>(() => new Date());
  const [sessionRef, setSessionRef] = useState(NO_SESSION);
  const [rows, setRows] = useState<MockRow[]>([]);
  const [packageId, setPackageId] = useState(NO_PACKAGE);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: {
      date: string;
      topicScores: { topicId: string; answered: number; correct: number }[];
      packageId?: string;
      sessionRef?: string;
      note?: string;
    }) =>
      api.post<MockExam>("mock-exams", { planId, ...body }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.mocks(planId) }),
        qc.invalidateQueries({ queryKey: keys.mockSessions(planId) }),
        invalidateProjection(qc, planId),
      ]),
  });

  const sessionSize = session?.questionCount ?? null;
  const problem = mockError(rows, sessionSize);
  const sum = totals(rows);

  function pickSession(ref: string) {
    setSessionRef(ref);
    const m = (sessions.data ?? []).find((x) => x.ref === ref);
    if (m) {
      if (m.packageId) setPackageId(m.packageId);
      setRows(rowsFromMix(m.topicMix));
    } else setRows([]);
  }
  const patchRow = (i: number, p: Partial<MockRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  function reset() {
    setDate(new Date());
    setSessionRef(NO_SESSION);
    setRows([]);
    setPackageId(NO_PACKAGE);
    setNote("");
    setError(null);
  }

  async function submit() {
    if (!date) return setError("Pick the day you sat it.");
    if (problem) return setError(problem);
    setError(null);
    try {
      await create.mutateAsync({
        date: isoDay(date),
        topicScores: toTopicScores(rows),
        ...(sessionRef !== NO_SESSION ? { sessionRef } : {}),
        // Omitted, not null: the API's schema takes an optional string only.
        ...(packageId !== NO_PACKAGE ? { packageId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success("Mock added");
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that. Nothing was added.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-left sm:text-left">
          <DialogTitle className="text-[20px] font-semibold">Add mock</DialogTitle>
          <DialogDescription className="text-[13px]">
            Mock scores are the strongest sign of readiness. Add each one when you sit it.
          </DialogDescription>
        </DialogHeader>
        <form
          id="add-mock-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="mock-date" className="text-[13px]">
              Date
            </Label>
            <DatePicker id="mock-date" value={date} onChange={setDate} max={new Date()} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mock-session" className="text-[13px]">
              Mock
            </Label>
            <Select value={sessionRef} onValueChange={pickSession}>
              <SelectTrigger id="mock-session" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SESSION}>Another mock, not listed</SelectItem>
                {(sessions.data ?? []).map((m) => (
                  <SelectItem key={m.ref} value={m.ref}>
                    {m.packageName ? `${m.packageName}: ` : ""}
                    {m.title}
                    {m.done ? " (done)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Score by topic</legend>
            {session && session.topicMix.length === 0 ? (
              <p className="text-muted-foreground text-[13px]">
                This mock does not list its topics. Add each topic you were tested on and your counts.
              </p>
            ) : null}
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] items-end gap-2 max-md:grid-cols-[1fr_1fr_auto]">
                <div className="grid min-w-0 gap-1 max-md:col-span-3">
                  <Label htmlFor={`mock-topic-${i}`} className="text-[12px]">
                    Topic
                  </Label>
                  <Select value={r.topicId || undefined} onValueChange={(v) => patchRow(i, { topicId: v })}>
                    <SelectTrigger id={`mock-topic-${i}`} className="w-full min-w-0 max-md:h-11">
                      <SelectValue placeholder="Choose a topic" />
                    </SelectTrigger>
                    <SelectContent>
                      {topics.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`mock-answered-${i}`} className="text-[12px]">
                    Answered
                  </Label>
                  <Input
                    id={`mock-answered-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className="tabular-nums max-md:h-11"
                    value={r.answered}
                    onChange={(e) => patchRow(i, { answered: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`mock-correct-${i}`} className="text-[12px]">
                    Correct
                  </Label>
                  <Input
                    id={`mock-correct-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className="tabular-nums max-md:h-11"
                    value={r.correct}
                    aria-invalid={r.correct !== "" && Number(r.correct) > Number(r.answered)}
                    onChange={(e) => patchRow(i, { correct: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 max-md:size-11"
                  aria-label={`Remove topic row ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-md:h-11"
                onClick={() => setRows((rs) => [...rs, { topicId: "", answered: "", correct: "" }])}
              >
                Add a topic
              </Button>
              {sum.percent !== null ? (
                <p className="text-muted-foreground text-[13px] tabular-nums" aria-live="polite">
                  {sum.correct} of {sum.answered} correct, {sum.percent}%
                </p>
              ) : null}
            </div>
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="mock-package" className="text-[13px]">
              Package
            </Label>
            <Select value={packageId} onValueChange={setPackageId}>
              <SelectTrigger id="mock-package" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PACKAGE}>Not from a package</SelectItem>
                {(packages.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mock-note" className="text-[13px]">
              Note <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="mock-note"
              rows={3}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Timed, at home, ran out of time on fixed income"
            />
          </div>
          {!online ? (
            <p className="text-muted-foreground text-[13px]" role="status">
              Offline. Adding a mock needs a connection.
            </p>
          ) : null}
          {error ? (
            <p className="text-alarm-ink text-[13px]" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter className="sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-mock-form" disabled={create.isPending || !online}>
            {create.isPending ? "Adding" : "Add mock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
