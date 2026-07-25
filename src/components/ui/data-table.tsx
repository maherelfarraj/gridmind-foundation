// POL-3 — Shared DataTable: one toolbar/header/cell/pagination standard for every
// list in the app, with right-aligned tabular numerics and a mobile card list.
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

export function DataTableToolbar({
  search,
  filters,
  actions,
  className,
}: {
  search?: React.ReactNode;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  if (!search && !filters && !actions) return null;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        "[&_button]:h-10 [&_input]:h-10 [&_[data-slot=select-trigger]]:h-10",
        className,
      )}
    >
      {search ? <div className="w-full sm:max-w-xs">{search}</div> : <div className="hidden sm:block" />}
      {filters ? (
        <div className="flex flex-wrap items-center gap-2 sm:flex-1 sm:justify-center">{filters}</div>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
    </div>
  );
}

export function DataTableSearch({
  value,
  onChange,
  placeholder = "Search",
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="h-10 pl-9"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cell primitives                                                            */
/* -------------------------------------------------------------------------- */

/** Right-aligned tabular numeric span — use for money, qty and percent values. */
export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{children}</span>;
}

/** Relative timestamp with the absolute value on hover. */
export function RelativeTime({
  value,
  className,
}: {
  value: string | number | Date | null | undefined;
  className?: string;
}) {
  if (!value) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={formatDateTime(value)}
      className={cn("whitespace-nowrap", className)}
    >
      {formatRelative(value)}
    </time>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export function DataTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = PAGE_SIZES,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: readonly number[];
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border pt-4 text-sm sm:flex sm:justify-between",
        className,
      )}
    >
      <p className="min-w-0 truncate text-muted-foreground tabular-nums">
        {from}–{to} of {total}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {onPageSizeChange ? (
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-9 w-[92px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DataTable                                                                  */
/* -------------------------------------------------------------------------- */

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Right-aligns and applies tabular-nums — money, quantity, percent columns. */
  numeric?: boolean;
  align?: "left" | "center" | "right";
  className?: string;
  headerClassName?: string;
  /** Hide the column below this breakpoint. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  width?: string;
}

export interface DataTableMobileCard {
  primary: React.ReactNode;
  badge?: React.ReactNode;
  fields?: { label: string; value: React.ReactNode }[];
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  skeletonRows?: number;
  /** Rendered instead of the table when there are no rows. */
  emptyState?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  toolbar?: { search?: React.ReactNode; filters?: React.ReactNode; actions?: React.ReactNode };
  pagination?: React.ComponentProps<typeof DataTablePagination>;
  /** Renders a card list instead of a table below `md`. */
  mobileCard?: (row: T) => DataTableMobileCard;
  /** Keeps the first column pinned while scrolling horizontally on small screens. */
  stickyFirstColumn?: boolean;
  className?: string;
}

const HIDE_BELOW: Record<NonNullable<DataTableColumn<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

function alignClass<T>(col: DataTableColumn<T>) {
  const align = col.align ?? (col.numeric ? "right" : "left");
  return align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  isLoading,
  skeletonRows = 6,
  emptyState,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyIcon,
  toolbar,
  pagination,
  mobileCard,
  stickyFirstColumn,
  className,
}: DataTableProps<T>) {
  const clickable = !!onRowClick;

  const body = (() => {
    if (isLoading) {
      return (
        <div className="space-y-2 rounded-md border border-border p-4">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        emptyState ?? (
          <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
        )
      );
    }
    return (
      <>
        {mobileCard ? (
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => {
              const card = mobileCard(row);
              return (
                <li key={getRowId(row)}>
                  <MobileRowCard
                    card={card}
                    onClick={clickable ? () => onRowClick!(row) : undefined}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className={cn(mobileCard && "hidden md:block")}>
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                {columns.map((col, i) => (
                  <TableHead
                    key={col.id}
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      alignClass(col),
                      col.hideBelow && HIDE_BELOW[col.hideBelow],
                      stickyFirstColumn && i === 0 && "sticky left-0 z-20 bg-muted/50 md:static",
                      col.headerClassName,
                    )}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? "button" : undefined}
                  onClick={clickable ? () => onRowClick!(row) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick!(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    clickable &&
                      "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                >
                  {columns.map((col, i) => (
                    <TableCell
                      key={col.id}
                      className={cn(
                        alignClass(col),
                        col.numeric && "tabular-nums",
                        col.hideBelow && HIDE_BELOW[col.hideBelow],
                        stickyFirstColumn && i === 0 && "sticky left-0 z-10 bg-card md:static",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  })();

  return (
    <div className={cn("space-y-4", className)}>
      {toolbar ? <DataTableToolbar {...toolbar} /> : null}
      {body}
      {pagination && rows.length > 0 ? <DataTablePagination {...pagination} /> : null}
    </div>
  );
}

function MobileRowCard({ card, onClick }: { card: DataTableMobileCard; onClick?: () => void }) {
  const content = (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0 text-sm font-medium text-foreground">{card.primary}</div>
        {card.badge ? <div className="shrink-0">{card.badge}</div> : null}
      </div>
      {card.fields?.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {card.fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="truncate text-sm text-foreground tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );

  if (!onClick) {
    return <div className="rounded-lg border border-border bg-card p-4 shadow-sm">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </button>
  );
}
