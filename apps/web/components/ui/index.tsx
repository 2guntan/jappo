import { cva, type VariantProps } from 'class-variance-authority';
import { CheckCircle2, Circle, Info, Inbox, TriangleAlert, XCircle } from 'lucide-react';
import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ Buttons */

const buttonCva = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand-700 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.10),0_1px_2px_0_rgb(28_26_23/0.08)] hover:bg-brand-800 active:bg-brand-900',
        secondary: 'border border-neutral-300/80 bg-white text-neutral-900 shadow-xs hover:bg-neutral-50 hover:border-neutral-300 active:bg-neutral-100',
        ghost: 'text-neutral-700 hover:bg-neutral-200/60 hover:text-neutral-900 active:bg-neutral-200',
        danger: 'bg-red-700 text-white shadow-xs hover:bg-red-800 active:bg-red-900',
        link: 'h-auto rounded-none px-0 text-brand-700 underline-offset-4 hover:underline',
      },
      size: { sm: 'h-8 px-3 text-[13px]', md: 'h-9 px-3.5', lg: 'h-11 px-5 text-[15px]' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

/** Button classes for links styled as buttons. Conflicting utilities passed in `className` win (tailwind-merge). */
export const buttonVariants = (opts?: Parameters<typeof buttonCva>[0]) => cn(buttonCva(opts));

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonCva> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

/** Square icon-only button; always give it an `aria-label`. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'sm' | 'md' }>(({ className, size = 'md', type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
      size === 'sm' ? 'size-7' : 'size-9',
      className,
    )}
    {...props}
  />
));
IconButton.displayName = 'IconButton';

/* -------------------------------------------------------------------- Inputs */

const control =
  'w-full rounded-md border border-neutral-300/80 bg-white text-sm text-neutral-900 shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-neutral-400 hover:border-neutral-300 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/15 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 disabled:shadow-none';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      control,
      'h-9 px-3',
      '[&[type=file]]:cursor-pointer [&[type=file]]:py-1.5 [&[type=file]]:text-neutral-600 file:mr-3 file:rounded-sm file:border-0 file:bg-neutral-100 file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-neutral-700',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-20 px-3 py-2 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(control, 'select-chevron h-9 pl-3', className)} {...props} />
));
Select.displayName = 'Select';

export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('block text-[13px] font-medium text-neutral-700', className)} {...props} />
);

export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs leading-relaxed text-neutral-500">{hint}</p>}
      {error && (
        <p className="text-xs text-red-600" role="alert" id={`${htmlFor}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Inline checkbox with its label, aligned on the first line of text. */
export function Checkbox({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-sm text-neutral-800', props.disabled && 'cursor-not-allowed opacity-60', className)}>
      <input type="checkbox" className="mt-0.5" {...props} />
      <span>{label}</span>
    </label>
  );
}

/* --------------------------------------------------------------------- Cards */

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-lg border border-neutral-200/80 bg-white shadow-xs', className)} {...props} />
);
export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-neutral-200/70 px-5 py-3', className)} {...props} />
);
export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => <h2 className={cn('text-sm font-semibold text-neutral-900', className)} {...props} />;
export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn('text-sm text-neutral-500', className)} {...props} />;
export const CardBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn('px-5 py-4', className)} {...props} />;
export const CardFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-wrap items-center gap-2 rounded-b-lg border-t border-neutral-200/70 bg-neutral-50/60 px-5 py-3', className)} {...props} />
);

/* -------------------------------------------------------------------- Badges */

const badgeTone = {
  neutral: 'border-neutral-200/80 bg-neutral-100 text-neutral-700',
  green: 'border-brand-200/70 bg-brand-50 text-brand-800',
  amber: 'border-amber-200/70 bg-amber-50 text-amber-800',
  red: 'border-red-200/70 bg-red-50 text-red-700',
  blue: 'border-sky-200/70 bg-sky-50 text-sky-800',
};
export type BadgeTone = keyof typeof badgeTone;
export const Badge = ({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) => (
  <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-xs font-medium leading-5', badgeTone[tone], className)} {...props} />
);

/* -------------------------------------------------------------------- Alerts */

export function Alert({ tone = 'info', children, className }: { tone?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode; className?: string }) {
  const tones = {
    info: { box: 'border-sky-200/70 bg-sky-50 text-sky-950', icon: Info, iconColor: 'text-sky-600' },
    error: { box: 'border-red-200/70 bg-red-50 text-red-950', icon: XCircle, iconColor: 'text-red-600' },
    success: { box: 'border-brand-200/70 bg-brand-50 text-brand-950', icon: CheckCircle2, iconColor: 'text-brand-600' },
    warning: { box: 'border-amber-200/70 bg-amber-50 text-amber-950', icon: TriangleAlert, iconColor: 'text-amber-600' },
  } as const;
  const Icon = tones[tone].icon;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed', tones[tone].box, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', tones[tone].iconColor)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------- Tables */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className={cn('w-full text-left text-sm', className)}>{children}</table>
    </div>
  );
}
export const Th = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn('whitespace-nowrap border-b border-neutral-200/80 bg-neutral-50/70 px-4 py-2.5 text-xs font-medium text-neutral-500 first:pl-5 last:pr-5', className)} {...props} />
);
export const Td = ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('border-b border-neutral-200/60 px-4 py-3 align-top text-neutral-800 first:pl-5 last:pr-5', className)} {...props} />
);

/* ---------------------------------------------------------------- Page chrome */

export function PageHeader({ title, subtitle, eyebrow, actions, className }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-neutral-900 sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1.5 text-sm text-neutral-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Section heading used between groups of cards. */
export function SectionTitle({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-4', className)}>
      <h2 className="text-sm font-semibold text-neutral-900">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ title, description, action, icon, className }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-neutral-200/80 bg-white px-6 py-16 text-center shadow-xs', className)}>
      <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 [&_svg]:size-5">{icon ?? <Inbox aria-hidden />}</div>
      <p className="mt-4 text-sm font-semibold text-neutral-900">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-neutral-500">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <div className={cn('flex justify-center py-16', className)}>
    <div className="size-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" role="status" aria-label="loading" />
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-neutral-200/70', className)} aria-hidden />;

/* ---------------------------------------------------------------------- Tabs */

export interface TabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  count?: number;
}

/** Underline tabs. Keeps `role="tablist"` / `role="tab"` semantics for tests and assistive tech. */
export function Tabs<K extends string>({ items, value, onChange, className, label }: { items: readonly TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string; label?: string }) {
  return (
    <nav className={cn('scrollbar-thin -mx-1 mb-6 flex gap-6 overflow-x-auto border-b border-neutral-200/80 px-1', className)} role="tablist" aria-label={label}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-sm transition-colors',
              active ? 'border-neutral-900 font-medium text-neutral-900' : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800',
            )}
          >
            {it.label}
            {it.count !== undefined && <span className={cn('rounded-full px-1.5 text-[11px] font-medium leading-4 tabular-nums', active ? 'bg-neutral-900 text-white' : 'bg-neutral-200/70 text-neutral-600')}>{it.count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

/** Small exclusive toggle (list / map, fr / en). */
export function SegmentedControl<K extends string>({ options, value, onChange, label, className, size = 'md' }: { options: readonly { value: K; label: ReactNode }[]; value: K; onChange: (v: K) => void; label?: string; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('inline-flex shrink-0 items-center rounded-md border border-neutral-200/80 bg-neutral-100 p-0.5', className)} role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[5px] font-medium transition-colors',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-3 text-[13px]',
              active ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-500 hover:text-neutral-800',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- Data */

/** One figure with its label: KPI tiles, totals, summaries. */
export function Stat({ label, value, hint, tone, className, ...props }: HTMLAttributes<HTMLDivElement> & { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'danger' | 'muted' }) {
  return (
    <div className={cn('rounded-lg border border-neutral-200/80 bg-white px-4 py-3.5 shadow-xs', className)} {...props}>
      <p className="text-xs font-medium leading-snug text-neutral-500">{label}</p>
      <p className={cn('mt-1.5 text-lg font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-xl', tone === 'danger' ? 'text-red-700' : tone === 'muted' ? 'text-neutral-500' : 'text-neutral-900')}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

/** Label / value pair for description lists. Wrap several in `<KvGrid>`. */
export function Kv({ label, value, className, ...props }: HTMLAttributes<HTMLDivElement> & { label: ReactNode; value: ReactNode }) {
  return (
    <div className={cn('min-w-0', className)} {...props}>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-900 tabular-nums">{value}</dd>
    </div>
  );
}
export const KvGrid = ({ className, ...props }: HTMLAttributes<HTMLDListElement>) => <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-3', className)} {...props} />;

export interface ChecklistItem {
  key: string;
  label: ReactNode;
  done: boolean;
  href?: string;
  hint?: ReactNode;
}

/** Progress checklist (onboarding steps, next actions, conditions precedent). */
export function Checklist({ items, className }: { items: ChecklistItem[]; className?: string }) {
  return (
    <ul className={cn('-mx-2 space-y-0.5', className)}>
      {items.map((it) => {
        const inner = (
          <>
            {it.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-neutral-300" aria-hidden />}
            <span className="min-w-0">
              <span className={cn('block text-sm', it.done ? 'text-neutral-500 line-through decoration-neutral-300' : 'text-neutral-800')}>{it.label}</span>
              {it.hint && <span className="block text-xs text-neutral-500">{it.hint}</span>}
            </span>
          </>
        );
        const cls = 'flex items-start gap-2.5 rounded-md px-2 py-1.5';
        return (
          <li key={it.key}>
            {it.href ? (
              <Link href={it.href} className={cn(cls, 'transition-colors hover:bg-neutral-100')}>
                {inner}
              </Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Horizontal progress bar (readiness components, pack progress). */
export function Meter({ value, max = 100, className, tone = 'brand' }: { value: number; max?: number; className?: string; tone?: 'brand' | 'neutral' | 'amber' | 'red' }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const color = { brand: 'bg-brand-600', neutral: 'bg-neutral-500', amber: 'bg-amber-500', red: 'bg-red-600' }[tone];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/80', className)} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export const Divider = ({ className }: { className?: string }) => <hr className={cn('border-neutral-200/80', className)} />;
