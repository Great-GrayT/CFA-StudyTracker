"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { api, ApiError, messageForStatus } from "@/lib/api";
import { keys, useHolidays } from "@/lib/hooks";
import { invalidateAfterSetup } from "@/lib/plan-invalidation";
import { useOnline } from "@/hooks/use-online";
import type { Holiday } from "@/lib/types";

// Holidays are whole days, shown in UTC so a stored date never slips a day.
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const showDay = (iso: string) => dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const rangeLabel = (h: Holiday) =>
  h.startDate.slice(0, 10) === h.endDate.slice(0, 10)
    ? showDay(h.startDate)
    : `${showDay(h.startDate)} to ${showDay(h.endDate)}`;

export function HolidaysEditor({ planId }: { planId: string }) {
  const qc = useQueryClient();
  const online = useOnline();
  const holidays = useHolidays(planId);
  const state = regionState(holidays);

  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function add() {
    if (!range?.from) return;
    const end = range.to ?? range.from;
    setAdding(true);
    try {
      await api.post(`plans/${planId}/holidays`, {
        startDate: format(range.from, "yyyy-MM-dd"),
        endDate: format(end, "yyyy-MM-dd"),
        note: note.trim() || null,
      });
      toast.success("Holiday added. Those days no longer count against your pace.");
      setRange(undefined);
      setNote("");
      setPickerOpen(false);
      await qc.invalidateQueries({ queryKey: keys.holidays(planId) });
      await invalidateAfterSetup(qc, planId);
    } catch (err) {
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Failed to add holiday.");
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`plans/${planId}/holidays/${toDelete.id}`);
      toast.success("Holiday deleted.");
      setToDelete(null);
      await qc.invalidateQueries({ queryKey: keys.holidays(planId) });
      await invalidateAfterSetup(qc, planId);
    } catch (err) {
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Failed to delete holiday.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-[13px]">Days off that stop counting against your pace.</p>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="max-md:h-11">
              Add holiday
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-auto flex-col gap-3 p-3">
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
            />
            <Input
              aria-label="Note"
              placeholder="Note, optional"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(false)} disabled={adding}>
                Cancel
              </Button>
              <Button size="sm" onClick={add} disabled={adding || !range?.from}>
                {adding ? "Saving" : "Save holiday"}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {!online ? <OfflineLine /> : null}

      {state.loading ? (
        <Skeleton className="h-16 w-full rounded-none" aria-label="Loading holidays" />
      ) : state.error && !holidays.data ? (
        <RegionError error={state.error} online={online} onRetry={() => void holidays.refetch()} />
      ) : holidays.data && holidays.data.length > 0 ? (
        <ul className="flex flex-col">
          {holidays.data.map((h) => (
            <li key={h.id} className="border-border flex min-h-11 items-center justify-between gap-3 border-b py-2 md:min-h-9">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] tabular-nums" title={rangeLabel(h)}>
                  {rangeLabel(h)}
                </span>
                {h.note ? (
                  <span className="text-muted-foreground truncate text-[13px]" title={h.note}>
                    {h.note}
                  </span>
                ) : null}
              </div>
              <Button variant="ghost" size="sm" className="max-md:h-11" aria-label={`Delete holiday ${rangeLabel(h)}`} onClick={() => setToDelete(h)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[14px]">
          No holidays set. Add a range and those days stop counting against your pace.
        </p>
      )}

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this holiday?</DialogTitle>
            <DialogDescription>
              {toDelete ? `${rangeLabel(toDelete)} counts against your pace again.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting" : "Delete holiday"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
