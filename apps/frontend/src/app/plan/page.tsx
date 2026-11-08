"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { usePlan, useLogs, useHolidays, usePlanPackages, usePackages } from "@/lib/hooks";
import { api } from "@/lib/api";
import { hoursBetween, startOfUTCDay } from "@/lib/pace";
import { WEEKDAYS, WEEKDAY_LABELS, type WeeklyAvailability, type PackageRole } from "@/lib/types";
import { toast } from "sonner";
import styles from "./plan.module.css";

const hours = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const dayCount = new Intl.PluralRules("en");

export default function PlanPage() {
  const plan = usePlan();
  const planId = plan.data?.id;
  const logs = useLogs(planId);
  const holidays = useHolidays(planId);
  const planPackages = usePlanPackages(planId);
  const allPackages = usePackages();

  const [editingAvailability, setEditingAvailability] = useState<WeeklyAvailability | null>(null);
  const [examDateInput, setExamDateInput] = useState("");
  const [editingExamDate, setEditingExamDate] = useState(false);
  const [savingExamDate, setSavingExamDate] = useState(false);
  const [holidayFormOpen, setHolidayFormOpen] = useState(false);
  const [newHolidayStart, setNewHolidayStart] = useState("");
  const [newHolidayEnd, setNewHolidayEnd] = useState("");
  const [newHolidayNote, setNewHolidayNote] = useState("");
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [holidayError, setHolidayError] = useState<string | null>(null);
  const [deletingHolidayId, setDeletingHolidayId] = useState<string | null>(null);
  const [addPackageFormOpen, setAddPackageFormOpen] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [savingPackage, setSavingPackage] = useState(false);
  const [togglingRoles, setTogglingRoles] = useState<string | null>(null);

  const planHealth = useMemo(() => {
    if (!plan.data || !editingAvailability) return null;
    const today = startOfUTCDay(new Date());
    const exam = startOfUTCDay(new Date(plan.data.examDate));
    const holidayRanges = (holidays.data ?? []).map((h) => ({
      start: startOfUTCDay(new Date(h.startDate)),
      end: startOfUTCDay(new Date(h.endDate)),
    }));
    const total = hoursBetween(editingAvailability, today, exam, holidayRanges);
    return total;
  }, [editingAvailability, plan.data, holidays.data]);

  if (plan.isLoading) {
    return (
      <AppShell>
        <div className={styles.skeleton} aria-busy="true">
          <div className={styles.skelLine} />
          <div className={styles.skelBlock} />
        </div>
      </AppShell>
    );
  }

  if (!plan.data) {
    return (
      <AppShell>
        <section className={styles.container}>
          <h1 className={styles.title}>Plan</h1>
          <p className={styles.empty}>No active plan. Set one up to start tracking.</p>
        </section>
      </AppShell>
    );
  }

  const currentAvailability = editingAvailability || plan.data.weeklyAvailability;
  const weeklyTotal = WEEKDAYS.reduce((sum, day) => sum + (currentAvailability[day] ?? 0), 0);

  async function handleSaveAvailability() {
    if (!editingAvailability || !planId) return;
    try {
      await api.patch(`plans/${planId}`, {
        weeklyAvailability: editingAvailability,
      });
      toast.success("Hours saved. Pace updated.");
      setEditingAvailability(null);
    } catch (err) {
      console.error("Failed to save availability:", err);
      toast.error("Failed to save hours.");
    }
  }

  function handleAvailabilityChange(day: keyof WeeklyAvailability, value: number) {
    const clamped = Math.max(0, Math.min(12, Math.floor(value)));
    setEditingAvailability((prev) => ({
      ...(prev || plan.data!.weeklyAvailability),
      [day]: clamped,
    }));
  }

  async function handleExamDateChange() {
    if (!examDateInput || !planId) return;
    setSavingExamDate(true);
    try {
      await api.patch(`plans/${planId}`, { examDate: examDateInput });
      toast.success("Exam date saved.");
      setEditingExamDate(false);
      plan.refetch?.();
    } catch (err) {
      console.error("Failed to save exam date:", err);
      toast.error("Failed to save exam date.");
    } finally {
      setSavingExamDate(false);
    }
  }

  async function handleAddHoliday() {
    if (!newHolidayStart || !newHolidayEnd || !planId) return;

    const startDate = new Date(newHolidayStart);
    const endDate = new Date(newHolidayEnd);

    if (endDate < startDate) {
      setHolidayError("The end date needs to be on or after the start date.");
      return;
    }

    setSavingHoliday(true);
    setHolidayError(null);
    try {
      await api.post(`plans/${planId}/holidays`, {
        startDate: newHolidayStart,
        endDate: newHolidayEnd,
        note: newHolidayNote || null,
      });
      toast.success("Holiday added. Those days no longer count against your pace.");
      setNewHolidayStart("");
      setNewHolidayEnd("");
      setNewHolidayNote("");
      setHolidayFormOpen(false);
      holidays.refetch?.();
    } catch (err) {
      console.error("Failed to add holiday:", err);
      toast.error("Failed to add holiday.");
    } finally {
      setSavingHoliday(false);
    }
  }

  async function handleDeleteHoliday(holidayId: string) {
    if (!planId) return;
    setDeletingHolidayId(holidayId);
    try {
      await api.del(`plans/${planId}/holidays/${holidayId}`);
      toast.success("Holiday deleted.");
      holidays.refetch?.();
    } catch (err) {
      console.error("Failed to delete holiday:", err);
      toast.error("Failed to delete holiday.");
    } finally {
      setDeletingHolidayId(null);
    }
  }

  async function handleToggleRole(packageId: string, role: PackageRole) {
    if (!planId) return;
    setTogglingRoles(packageId);
    try {
      const pkg = planPackages.data?.find((p) => p.packageId === packageId);
      if (!pkg) return;

      const newRoles = pkg.roles.includes(role)
        ? pkg.roles.filter((r) => r !== role)
        : [...pkg.roles, role];

      await api.post(`plans/${planId}/packages`, {
        packageId,
        roles: newRoles,
      });

      toast.success("Package updated.");
      planPackages.refetch?.();
    } catch (err) {
      console.error("Failed to update package:", err);
      toast.error("Failed to update package.");
    } finally {
      setTogglingRoles(null);
    }
  }

  async function handleAddPackage() {
    if (!selectedPackageId || !planId) return;
    setSavingPackage(true);
    try {
      await api.post(`plans/${planId}/packages`, {
        packageId: selectedPackageId,
        roles: [],
      });
      toast.success("Package added.");
      setSelectedPackageId("");
      setAddPackageFormOpen(false);
      planPackages.refetch?.();
    } catch (err) {
      console.error("Failed to add package:", err);
      toast.error("Failed to add package.");
    } finally {
      setSavingPackage(false);
    }
  }

  async function handleExportPlan() {
    if (!planId) return;
    try {
      const data = await api.get<object>(`export/all`);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plan-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("File saved.");
    } catch (err) {
      console.error("Failed to export:", err);
      toast.error("Failed to export.");
    }
  }

  return (
    <AppShell>
      <section className={styles.container} aria-labelledby="plan-heading">
        <h1 id="plan-heading" className={styles.title}>
          Plan
        </h1>

        <div className={styles.section}>
          <div className={styles.infoRow}>
            <div>
              <label className={styles.infoLabel}>Level</label>
              <p className={styles.infoValue}>{plan.data.levelId}</p>
            </div>
          </div>

          <div className={styles.infoRow}>
            <div>
              <label className={styles.infoLabel}>Exam</label>
              {editingExamDate ? (
                <div className={styles.editExamDate}>
                  <input
                    type="date"
                    value={examDateInput}
                    onChange={(e) => setExamDateInput(e.target.value)}
                    className={styles.dateInput}
                  />
                  <button
                    type="button"
                    onClick={handleExamDateChange}
                    disabled={savingExamDate}
                    className={styles.saveButton}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingExamDate(false)}
                    className={styles.cancelButton}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className={styles.examDateDisplay}>
                  <p className={styles.infoValue}>
                    {new Date(plan.data.examDate).toLocaleDateString()}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setExamDateInput(plan.data!.examDate.split("T")[0]);
                      setEditingExamDate(true);
                    }}
                    className={styles.editButton}
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className={styles.infoRow}>
            <div>
              <label className={styles.infoLabel}>Started</label>
              <p className={styles.infoValue}>
                {new Date(plan.data.startDate).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Weekly hours {weeklyTotal}h</h2>

          <div className={styles.availabilityGrid}>
            {WEEKDAYS.map((day) => (
              <div key={day} className={styles.daySlider}>
                <label htmlFor={`slider-${day}`} className={styles.dayLabel}>
                  {WEEKDAY_LABELS[day].slice(0, 3)}
                </label>
                <input
                  id={`slider-${day}`}
                  type="range"
                  min="0"
                  max="12"
                  value={currentAvailability[day] ?? 0}
                  onChange={(e) =>
                    handleAvailabilityChange(day, parseFloat(e.target.value))
                  }
                  role="slider"
                  aria-valuemin={0}
                  aria-valuemax={12}
                  aria-valuenow={currentAvailability[day] ?? 0}
                  aria-valuetext={`${currentAvailability[day] ?? 0} hours on ${WEEKDAY_LABELS[day]}`}
                  className={styles.slider}
                />
                <input
                  type="number"
                  min="0"
                  max="12"
                  value={currentAvailability[day] ?? 0}
                  onChange={(e) =>
                    handleAvailabilityChange(day, parseFloat(e.target.value))
                  }
                  className={styles.numberInput}
                  aria-label={`Hours on ${WEEKDAY_LABELS[day]}`}
                />
              </div>
            ))}
          </div>

          {editingAvailability && (
            <div className={styles.planHealth}>
              <p className={styles.planHealthText}>
                {weeklyTotal} hours a week leaves about{" "}
                {hours.format(planHealth ?? 0)} hours before the exam.
              </p>
              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  onClick={handleSaveAvailability}
                  className={styles.primaryButton}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingAvailability(null)}
                  className={styles.secondaryButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Holidays</h2>
            <button
              type="button"
              onClick={() => setHolidayFormOpen(!holidayFormOpen)}
              className={styles.addButton}
            >
              + Add
            </button>
          </div>

          {holidayFormOpen && (
            <div className={styles.form}>
              <div className={styles.formGroup}>
                <label htmlFor="holiday-start" className={styles.formLabel}>
                  Start date
                </label>
                <input
                  id="holiday-start"
                  type="date"
                  value={newHolidayStart}
                  onChange={(e) => setNewHolidayStart(e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="holiday-end" className={styles.formLabel}>
                  End date
                </label>
                <input
                  id="holiday-end"
                  type="date"
                  value={newHolidayEnd}
                  onChange={(e) => setNewHolidayEnd(e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="holiday-note" className={styles.formLabel}>
                  Note
                </label>
                <input
                  id="holiday-note"
                  type="text"
                  value={newHolidayNote}
                  onChange={(e) => setNewHolidayNote(e.target.value)}
                  placeholder="Optional"
                  className={styles.formInput}
                />
              </div>

              {holidayError && (
                <p className={styles.error} role="alert">
                  {holidayError}
                </p>
              )}

              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  onClick={handleAddHoliday}
                  disabled={savingHoliday || !newHolidayStart || !newHolidayEnd}
                  className={styles.primaryButton}
                >
                  {savingHoliday ? "Adding..." : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHolidayFormOpen(false);
                    setHolidayError(null);
                  }}
                  className={styles.secondaryButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {holidays.data && holidays.data.length > 0 ? (
            <div className={styles.list}>
              {holidays.data.map((holiday) => (
                <div key={holiday.id} className={styles.listItem}>
                  <div className={styles.listItemContent}>
                    <span className={styles.listItemTitle}>
                      {new Date(holiday.startDate).toLocaleDateString()} -{" "}
                      {new Date(holiday.endDate).toLocaleDateString()}
                    </span>
                    {holiday.note && (
                      <span className={styles.listItemNote}>{holiday.note}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteHoliday(holiday.id)}
                    disabled={deletingHolidayId === holiday.id}
                    className={styles.deleteButton}
                    aria-label="Delete holiday"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>
              No holidays set. Add a range and those days stop counting against your pace.
            </p>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Packages</h2>
            <button
              type="button"
              onClick={() => setAddPackageFormOpen(!addPackageFormOpen)}
              className={styles.addButton}
            >
              + Add
            </button>
          </div>

          {addPackageFormOpen && (
            <div className={styles.form}>
              <div className={styles.formGroup}>
                <label htmlFor="package-select" className={styles.formLabel}>
                  Package
                </label>
                <select
                  id="package-select"
                  value={selectedPackageId}
                  onChange={(e) => setSelectedPackageId(e.target.value)}
                  className={styles.formInput}
                >
                  <option value="">Choose a package</option>
                  {allPackages.data?.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  onClick={handleAddPackage}
                  disabled={savingPackage || !selectedPackageId}
                  className={styles.primaryButton}
                >
                  {savingPackage ? "Adding..." : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => setAddPackageFormOpen(false)}
                  className={styles.secondaryButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {planPackages.data && planPackages.data.length > 0 ? (
            <div className={styles.list}>
              {planPackages.data.map((pkg) => (
                <div key={pkg.packageId} className={styles.packageItem}>
                  <h3 className={styles.packageName}>{pkg.name}</h3>
                  <div className={styles.roles}>
                    {(["content", "questions", "mocks"] as const).map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => handleToggleRole(pkg.packageId, role)}
                        disabled={togglingRoles === pkg.packageId}
                        className={`${styles.roleSlot} ${
                          pkg.roles.includes(role) ? styles.roleSlotFilled : ""
                        }`}
                        aria-pressed={pkg.roles.includes(role)}
                        title={role}
                      >
                        {role === "content" ? "Content" : role === "questions" ? "Q" : "Mocks"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No packages added yet.</p>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.buttonGroup}>
            <button
              type="button"
              onClick={handleExportPlan}
              className={styles.secondaryButton}
            >
              Export
            </button>
            <button
              type="button"
              disabled
              className={styles.secondaryButton}
              title="Import coming soon"
            >
              Import plan
            </button>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
