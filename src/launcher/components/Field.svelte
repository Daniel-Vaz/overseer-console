<script lang="ts">
  // One line of text the player types: LABEL ........ [value]
  let {
    label,
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    input = $bindable(),
    onenter,
    onchange,
  }: {
    label: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    /** The field itself, for the menu entry that puts the cursor in it. */
    input?: HTMLInputElement;
    /** ENTER was pressed in the field. */
    onenter?: () => void;
    /** The player finished with the field (left it, or pressed ENTER). */
    onchange?: () => void;
  } = $props();

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    // Both hand the keyboard back to the menu; ESC must not also leave the screen.
    event.preventDefault();
    input?.blur();
    if (event.key === 'Enter') onenter?.();
  }
</script>

<label class="field">
  <span>{label}</span>
  <input
    type="text"
    bind:value
    bind:this={input}
    {placeholder}
    {disabled}
    spellcheck="false"
    autocomplete="off"
    autocapitalize="off"
    onkeydown={onKeydown}
    onchange={() => onchange?.()}
  />
</label>
