"use client";

import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";

type Paged = { page: number; pages: number; total: number; setPage: (p: number) => void };

/** Newer and Older around a page count; renders nothing for a single page. */
export function Pager({ paged, label }: { paged: Paged; label: string }) {
  if (paged.pages <= 1) return null;
  return (
    <Pagination aria-label={`${label} pages`}>
      <PaginationContent className="w-full justify-between">
        <PaginationItem>
          <Button
            variant="outline"
            size="sm"
            disabled={paged.page === 0}
            onClick={() => paged.setPage(paged.page - 1)}
          >
            Newer
          </Button>
        </PaginationItem>
        <PaginationItem className="text-muted-foreground text-[12px] tabular-nums" aria-live="polite">
          Page {paged.page + 1} of {paged.pages}
        </PaginationItem>
        <PaginationItem>
          <Button
            variant="outline"
            size="sm"
            disabled={paged.page >= paged.pages - 1}
            onClick={() => paged.setPage(paged.page + 1)}
          >
            Older
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
