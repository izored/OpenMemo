import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A byte count as a person would say it: "6 MB", "509 MB", "1.4 GB".
 *
 *  Used on the New Memo panel's keep-a-copy switch, where the number is a
 *  prediction rather than a measurement. Whole megabytes below a gigabyte,
 *  because "6.3 MB" implies a precision the estimate does not have.
 */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return 'under 1 MB';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
