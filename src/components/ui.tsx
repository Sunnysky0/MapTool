import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';

export function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 hover:text-zinc-200">
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-zinc-300">{label}</div>
        {hint && <div className="text-[10px] text-zinc-500">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  format?: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className="tabular-nums text-zinc-500">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="slider w-full"
      />
    </div>
  );
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-zinc-300">{label}</span>}
      <label className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-white/15 shadow-inner" style={{ background: value }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value);
        }}
        className="w-[76px] rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-amber-400/60"
      />
    </div>
  );
}

export function Toggle({ checked, onChange, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 'h-4 w-7' : 'h-5 w-9';
  const dot = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const tx = size === 'sm' ? 'translate-x-3' : 'translate-x-4';
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn('relative shrink-0 rounded-full transition-colors', w, checked ? 'bg-amber-400' : 'bg-zinc-700')}
    >
      <span className={cn('absolute left-0.5 top-0.5 rounded-full bg-white shadow transition-transform', dot, checked && tx)} />
    </button>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; group?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const groups = Array.from(new Set(options.map((o) => o.group)));
  const isNum = typeof value === 'number';
  const render = (o: { value: T; label: string }) => (
    <option key={String(o.value)} value={String(o.value)}>
      {o.label}
    </option>
  );
  return (
    <select
      value={String(value)}
      onChange={(e) => onChange((isNum ? Number(e.target.value) : e.target.value) as T)}
      className={cn('rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-amber-400/60', className)}
    >
      {groups.length > 1
        ? groups.map((g) => (
            <optgroup key={g ?? 'other'} label={g ?? 'Other'}>
              {options.filter((o) => o.group === g).map(render)}
            </optgroup>
          ))
        : options.map(render)}
    </select>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-md border border-white/10 bg-zinc-900 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('rounded px-2 py-1 text-[11px] transition-colors', value === o.value ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ children, onClick, variant = 'default', className, title, disabled }: { children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'ghost'; className?: string; title?: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-amber-400 text-zinc-900 hover:bg-amber-300',
        variant === 'default' && 'border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10',
        variant === 'ghost' && 'text-zinc-300 hover:bg-white/10',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function NumberField({ value, onChange, step = 1, min, max, className, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; className?: string; suffix?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <div className={cn('flex items-center rounded-md border border-white/10 bg-white/5 focus-within:border-amber-400/60', className)}>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (isFinite(n)) onChange(n);
        }}
        className="w-full bg-transparent px-2 py-1 text-xs tabular-nums text-zinc-200 outline-none"
      />
      {suffix && <span className="pr-2 text-[10px] text-zinc-500">{suffix}</span>}
    </div>
  );
}
