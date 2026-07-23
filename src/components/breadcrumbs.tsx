import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface BreadcrumbItemSpec {
  label: string;
  /** When omitted, the item renders as the current page. */
  to?: string;
}

export function AppBreadcrumbs({ items }: { items: BreadcrumbItemSpec[] }) {
  if (items.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <Fragment key={`${item.label}-${idx}`}>
              <BreadcrumbItem>
                {isLast || !item.to ? (
                  <BreadcrumbPage className="text-foreground">{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={item.to} className="text-muted-foreground">
                    {item.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
