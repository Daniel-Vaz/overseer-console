import type { IconName } from './icons';

export interface MenuItem {
  /** Single character that activates the item directly. */
  key: string;
  label: string;
  /** Short status shown at the right edge. */
  state?: string;
  /** Explanation shown under the item while it is selected. */
  note?: string;
  disabled?: boolean;
  /** Picture shown on the status board while the item is selected. */
  icon?: IconName;
  tone?: 'amber' | 'alert';
  action: () => void;
}

export type Hint = [key: string, label: string];
