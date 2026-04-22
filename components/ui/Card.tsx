import { HTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={clsx("rounded-2xl bg-white border border-slate-200 p-6", className)}
        {...props}
      />
    );
  }
);
