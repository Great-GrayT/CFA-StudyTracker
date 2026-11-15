"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { keys, usePackages } from "@/lib/hooks";
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
  const [date, setDate] = useState<Date | undefined>(() => new Date());
  const [score, setScore] = useState("");
  const [packageId, setPackageId] = useState(NO_PACKAGE);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { date: string; scorePercent: number; packageId?: string; note?: string }) =>
      api.post<MockExam>("mock-exams", { planId, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mocks(planId) }),
  });

  const scoreNum = Number(score);
  const scoreValid = score.trim() !== "" && Number.isFinite(scoreNum) && Number.isInteger(scoreNum) && scoreNum >= 0 && scoreNum <= 100;

  function reset() {
    setDate(new Date());
    setScore("");
    setPackageId(NO_PACKAGE);
    setNote("");
    setError(null);
  }

  async function submit() {
    if (!date) return setError("Pick the day you sat it.");
    if (!scoreValid) return setError("Enter a whole-number score from 0 to 100.");
    setError(null);
    try {
      await create.mutateAsync({
        date: isoDay(date),
        scorePercent: scoreNum,
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
      <DialogContent className="gap-5 sm:max-w-md">
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
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="mock-date" className="text-[13px]">
                Date
              </Label>
              <DatePicker id="mock-date" value={date} onChange={setDate} max={new Date()} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mock-score" className="text-[13px]">
                Score, %
              </Label>
              <Input
                id="mock-score"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                className="tabular-nums"
                value={score}
                aria-invalid={score !== "" && !scoreValid}
                onChange={(e) => setScore(e.target.value)}
              />
            </div>
          </div>
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
