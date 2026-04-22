import { HTMLAttributes } from "react";
import clsx from "clsx";

export function Table({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return <table className={clsx("w-full text-sm", className)} {...p} />;
}
export function THead({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={clsx("text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200", className)} {...p} />;
}
export function TH({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) {
  return <th className={clsx("py-2 px-3 text-left font-semibold", className)} {...p} />;
}
export function TBody({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={clsx("divide-y divide-slate-100", className)} {...p} />;
}
export function TR({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={clsx("hover:bg-slate-50", className)} {...p} />;
}
export function TD({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={clsx("py-2 px-3 text-slate-800", className)} {...p} />;
}
