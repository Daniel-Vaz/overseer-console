import type { IconName } from './icons';

export interface MenuItem {
  /** Single character that activates the item directly. */
  key: string;
  label: string;
  /** Short status shown at the right edge. */
  state?: string;
  /** Explanation shown on the line under the screen while the item is selected. */
  note?: string;
  disabled?: boolean;
  /** Picture shown on the status board while the item is selected. */
  icon?: IconName;
  tone?: 'amber' | 'alert';
  /** It destroys something: the item is drawn in the colour of a fault. */
  danger?: boolean;
  /** The heading the item stands under, together with its neighbours that name the same one. */
  group?: string;
  action: () => void;
  /**
   * For an item that holds a choice: steps it forwards (1) or backwards (-1),
   * which the arrow keys left and right ask for. ENTER is `action`.
   */
  adjust?: (direction: 1 | -1) => void;
}

export type Hint = [key: string, label: string];
