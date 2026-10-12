/**
 * Whether a key press is going into a text field. The console's menus take
 * single keys as commands; while the player types, keys are text.
 */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  return (target instanceof HTMLInputElement && target.type !== 'file') || target instanceof HTMLTextAreaElement;
}
