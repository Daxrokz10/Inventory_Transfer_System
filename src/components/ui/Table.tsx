import { cn } from "@/lib/cn";

/* Data-table primitives. Usage:
     <Table>
       <thead><tr><TH>Code</TH>…</tr></thead>
       <tbody><TRow><TD>…</TD></TRow></tbody>
     </Table>
   Wrap in a <Card className="p-0 overflow-x-auto"> for the standard look. */

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn("w-full border-collapse text-sm", className)} {...props} />
  );
}

export function TH({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-line bg-surface-2 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3",
        className,
      )}
      {...props}
    />
  );
}

export function TRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-line last:border-b-0 hover:bg-surface-2/60", className)}
      {...props}
    />
  );
}

export function TD({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-2.5 text-ink", className)} {...props} />;
}

export function EmptyState({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <p className={cn("px-4 py-8 text-center text-sm text-ink-3", className)}>
      {message}
    </p>
  );
}
