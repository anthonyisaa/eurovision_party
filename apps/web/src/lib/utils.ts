import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn helper. Combines clsx for conditional classes with
// tailwind-merge so later-occurring utilities override earlier ones cleanly.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
