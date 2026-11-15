"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RegionError, regionState } from "@/components/states/region-states";
import { usePackages } from "@/lib/hooks";
import type { PackageRole } from "@/lib/types";
import { useOnline } from "@/hooks/use-online";

export type PackageDraft = { packageId: string; roles: PackageRole[] };

const ROLES: { value: PackageRole; label: string }[] = [
  { value: "content", label: "Content" },
  { value: "questions", label: "Questions" },
  { value: "mocks", label: "Mocks" },
];

/**
 * The study packages in a plan and what each one is used for.
 *
 * Controlled, like HoursEditor: adding, removing and role changes go to the
 * caller, which saves them whenever it chooses.
 */
export function PackagesEditor({
  selected,
  onChange,
  disabled = false,
}: {
  selected: PackageDraft[];
  onChange: (next: PackageDraft[]) => void;
  disabled?: boolean;
}) {
  const catalogue = usePackages();
  const online = useOnline();
  const state = regionState(catalogue);
  const names = new Map((catalogue.data ?? []).map((p) => [p.id, p.name]));
  const available = (catalogue.data ?? []).filter((p) => !selected.some((s) => s.packageId === p.id));

  if (state.loading) return <Skeleton className="h-24 w-full rounded-none" aria-label="Loading packages" />;
  if (state.error && !catalogue.data) {
    return <RegionError error={state.error} online={online} onRetry={() => void catalogue.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {selected.length === 0 ? (
        <p className="text-muted-foreground text-[14px]">No packages yet. Add the books, banks and mock sets you use.</p>
      ) : (
        <ul className="flex flex-col">
          {selected.map((pkg) => {
            const name = names.get(pkg.packageId) ?? "Package";
            return (
              <li key={pkg.packageId} className="border-border flex flex-col gap-2 border-b py-3 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-[14px] font-medium" title={name}>
                    {name}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-md:h-11"
                    disabled={disabled}
                    aria-label={`Remove ${name}`}
                    onClick={() => onChange(selected.filter((s) => s.packageId !== pkg.packageId))}
                  >
                    Remove
                  </Button>
                </div>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  value={pkg.roles}
                  aria-label={`Used for, ${name}`}
                  onValueChange={(roles: string[]) =>
                    onChange(
                      selected.map((s) =>
                        s.packageId === pkg.packageId ? { ...s, roles: roles as PackageRole[] } : s,
                      ),
                    )
                  }
                >
                  {ROLES.map((role) => (
                    <ToggleGroupItem key={role.value} value={role.value} className="h-9 px-3 text-[13px] max-md:h-11">
                      {role.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </li>
            );
          })}
        </ul>
      )}

      <Select
        value=""
        disabled={disabled || available.length === 0}
        onValueChange={(packageId) => onChange([...selected, { packageId, roles: [] }])}
      >
        <SelectTrigger aria-label="Add a package" className="w-full">
          <SelectValue placeholder={available.length === 0 ? "Every package is added" : "Add a package"} />
        </SelectTrigger>
        <SelectContent>
          {available.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
