import { cn } from "@/lib/cn";

const controlBase =
  "rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft " +
  "disabled:bg-surface-2 disabled:text-ink-3";

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1 text-sm", className)}>
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, className)} {...props} />;
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlBase, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlBase, className)} {...props} />;
}
