<script lang="ts">
  // The settings files of an add-on or mod, and their settings: switched, stepped and typed, as on a desktop the
  // player would edit the file. See lib/mods/settings.ts.
  import { tick } from 'svelte';
  import {
    changeSetting,
    changesOf,
    changedSettings,
    forgetSettings,
    readSettings,
    installOpener,
    readSettingsFile,
    settingId,
    settingsFilesOf,
    type Setting,
    type SettingsFile,
  } from '../../lib/mods/settings';
  import type { AddonRecord } from '../../lib/addons';
  import { basename, pathKey } from '../../lib/storage/manifest';
  import { addonName } from '../mods';
  import { loadInstall, type Install, type Shelf } from '../../lib/storage/opfs';
  import { sfx } from '../sfx';
  import type { MenuItem } from '../types';
  import Field from './Field.svelte';
  import Menu from './Menu.svelte';

  /**
   * `owner`: the add-on or mod whose files these are, kept on `shelf`. `back`: leaves this view. `addons`: those laid
   * over the mod, the one under the others first; a file one of them brings too is read from it instead.
   */
  let {
    owner,
    shelf,
    title,
    back,
    addons = [],
    go,
  }: { owner: string; shelf: Shelf; title: string; back: () => void; addons?: AddonRecord[]; go?: (path: string) => void } = $props();

  let install = $state<Install | null>(null);
  /** Its settings files, once looked for. */
  let files = $state<SettingsFile[] | null>(null);
  /** The file open, its settings, and what the player changed of it. */
  let open = $state<{ file: SettingsFile; settings: Setting[] } | null>(null);
  let changes = $state<Record<string, string>>({});
  /** Which files have changes: read again after each change. */
  let changed = $state<ReturnType<typeof changedSettings>>(new Map());
  /** The setting a value is being typed for. */
  let editing = $state<Setting | null>(null);
  let draft = $state('');
  let input: HTMLInputElement | undefined = $state();
  let fileSelected = $state(0);
  let settingSelected = $state(0);

  $effect(() => {
    void owner;
    void look();
  });

  /** By the file's lower-cased path: the add-on laid over the mod that brings it too (or the archive it is in). */
  let coveredBy = $state(new Map<string, AddonRecord>());

  async function look(): Promise<void> {
    changed = changedSettings(owner);
    install = await loadInstall(owner, shelf).catch(() => null);
    files = install ? await settingsFilesOf(install.manifest.files, installOpener(install)).catch(() => []) : [];
    const covered = new Map<string, AddonRecord>();
    for (const addon of addons) {
      const brought = await loadInstall(addon.id, 'addons').catch(() => null);
      const paths = new Set(brought?.manifest.files.map((file) => pathKey(file.path)));
      for (const file of files) if (paths.has(pathKey(file.archive ?? file.path))) covered.set(pathKey(file.path), addon);
    }
    coveredBy = covered;
    // One file: straight into it.
    if (files.length === 1) await openFile(files[0]!);
  }

  async function openFile(file: SettingsFile): Promise<void> {
    if (!install) return;
    const text = await readSettingsFile(file, installOpener(install)).catch(() => null);
    open = { file, settings: text === null ? [] : readSettings(text) };
    changes = changesOf(owner, file.path);
    settingSelected = 0;
  }

  /** ESC: out of typing, out of a file, then out of this view (false). */
  export function stepBack(): boolean {
    if (editing) {
      editing = null;
      return true;
    }
    if (open && files && files.length > 1) {
      open = null;
      return true;
    }
    return false;
  }

  const SWITCH = /^[01]$/;
  const NUMBER = /^-?\d+$/;
  const valueOf = (setting: Setting): string => changes[settingId(setting.section, setting.key)] ?? setting.value;
  const shown = (value: string): string => (value.length > 18 ? `${value.slice(0, 17)}…` : value || '(EMPTY)');

  function set(setting: Setting, value: string): void {
    if (!open) return;
    changeSetting(owner, open.file.path, setting, value);
    changes = changesOf(owner, open.file.path);
    changed = changedSettings(owner);
  }

  function step(setting: Setting, direction: 1 | -1): void {
    const value = valueOf(setting);
    if (SWITCH.test(setting.value) && SWITCH.test(value)) set(setting, value === '1' ? '0' : '1');
    else if (NUMBER.test(value)) set(setting, String(Number(value) + direction));
  }

  async function type(setting: Setting): Promise<void> {
    editing = setting;
    draft = valueOf(setting);
    await tick();
    input?.focus();
    input?.select();
  }

  function typed(): void {
    if (!editing) return;
    set(editing, draft.trim());
    sfx.select();
    editing = null;
  }

  function reset(): void {
    if (!open) return;
    forgetSettings(owner, open.file.path);
    changes = {};
    changed = changedSettings(owner);
  }

  function coveredNote(addon: AddonRecord, file: SettingsFile): string {
    return `Not read while ${addonName(addon)} is on: the game reads its copy of ${basename(file.path)}, on its page.`;
  }

  const coveringOpen = $derived(open ? coveredBy.get(pathKey(open.file.path)) : undefined);

  const fileItems = $derived<MenuItem[]>([
    ...(files ?? []).map((file, index): MenuItem => {
      const count = Object.keys(changed.get(pathKey(file.path))?.changes ?? {}).length;
      const addon = coveredBy.get(pathKey(file.path));
      return {
        key: String(index + 1),
        label: basename(file.path),
        state: addon ? 'NOT READ' : count ? `${count} CHANGED` : 'AS IT CAME',
        tone: addon ? 'alert' : count ? 'amber' : undefined,
        note: addon
          ? coveredNote(addon, file)
          : `${file.path}${file.archive ? `, in the archive it is packed into` : ''}. Its settings, as its scripts read them.`,
        action: () => void openFile(file),
      };
    }),
    {
      key: 'r',
      label: 'All as they came',
      disabled: !changed.size,
      note: changed.size ? `Puts every settings file of ${title} back as it came.` : `Every settings file of ${title} is as it came.`,
      action: () => {
        forgetSettings(owner);
        changed = changedSettings(owner);
      },
    },
    { key: '0', label: 'Back', action: back },
  ]);

  const settingItems = $derived.by((): MenuItem[] => {
    if (!open) return [];
    return [
      ...open.settings.map((setting, index): MenuItem => {
        const value = valueOf(setting);
        const isSwitch = SWITCH.test(setting.value) && SWITCH.test(value);
        const isChanged = value !== setting.value;
        const came = isSwitch ? (setting.value === '1' ? 'on' : 'off') : `"${setting.value}"`;
        return {
          key: String(index + 1),
          group: setting.section ? setting.section.toUpperCase() : undefined,
          label: setting.key,
          state: isSwitch ? (value === '1' ? 'ON' : 'OFF') : shown(value),
          tone: isChanged ? 'amber' : undefined,
          note: [
            setting.about && !/[.!?:]$/.test(setting.about) ? `${setting.about}.` : setting.about,
            isChanged ? `Changed: it came ${came}.` : '',
            isSwitch ? 'ENTER switches it.' : NUMBER.test(value) ? 'ENTER types a value, the arrows step it.' : 'ENTER types a value.',
          ]
            .filter(Boolean)
            .join(' '),
          action: () => (isSwitch ? step(setting, 1) : void type(setting)),
          adjust: isSwitch || NUMBER.test(value) ? (direction) => step(setting, direction) : undefined,
        };
      }),
      {
        key: 'r',
        label: 'As it came',
        disabled: !Object.keys(changes).length,
        note: Object.keys(changes).length ? `Puts ${basename(open.file.path)} back as it came.` : `${basename(open.file.path)} is as it came.`,
        action: reset,
      },
      ...(coveringOpen && go
        ? [{ key: 'a', label: `${coveringOpen.title}'s settings`, note: `The ${basename(open.file.path)} the game reads, on ${addonName(coveringOpen)}'s page.`, action: () => go(`mods/addons/${coveringOpen.id}`) }]
        : []),
      { key: '0', label: 'Back', action: () => (files && files.length > 1 ? (open = null) : back()) },
    ];
  });
</script>

{#if files === null}
  <p class="gap">READING SETTINGS<span class="cursor"></span></p>
{:else if !files.length}
  <p class="gap prose">{title} brings no settings files.</p>
  <Menu items={[{ key: '0', label: 'Back', action: back }]} label="Settings" />
{:else if open}
  <dl class="readout gap">
    <dt>Settings</dt>
    <dd>{open.file.path.toUpperCase()}</dd>
  </dl>
  {#if coveringOpen}
    <p class="alert prose">{coveredNote(coveringOpen, open.file)}</p>
  {:else}
    <p class="dim prose">
      A change takes hold the next time {shelf === 'addons' ? 'a game starts, for every game and mod it is laid over' : 'it starts'}.
    </p>
  {/if}
  {#if editing}
    <Field label={editing.key} bind:value={draft} bind:input onenter={typed} />
  {/if}
  {#if !open.settings.length}
    <p class="gap prose">There are no settings in {basename(open.file.path)}.</p>
  {/if}
  <Menu items={settingItems} label={`Settings of ${basename(open.file.path)}`} bind:selected={settingSelected} />
{:else}
  <p class="gap">SETTINGS OF {title.toUpperCase()}</p>
  <p class="dim prose">The settings files it brings, as its scripts read them. Pick one to change what is in it.</p>
  <Menu items={fileItems} label="Settings files" bind:selected={fileSelected} />
{/if}
