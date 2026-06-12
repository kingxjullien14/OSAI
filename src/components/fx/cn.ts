/** The `cn()` every vendored fx component expects (Magic UI / Aceternity /
 *  ReactBits all assume it): clsx for conditionals + tailwind-merge so a
 *  caller's `className` can override a component's defaults without
 *  specificity fights. App-owned code may use it too, but plain template
 *  strings remain fine — this exists for the vendoring contract. */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
