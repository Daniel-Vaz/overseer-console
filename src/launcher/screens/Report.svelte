<script lang="ts">
  import { onMount } from 'svelte';
  import { addonRecords, gamesWith } from '../../lib/addons';
  import { planLabel } from '../../lib/autosave';
  import { gameDef } from '../../lib/games';
  import {
    consoleSection,
    forgetFault,
    issueUrl,
    lastFault,
    machineSection,
    megabytes,
    pageErrorLines,
    reportFileName,
    reportText,
    type Report,
    type ReportSection,
  } from '../../lib/report';
  import Glyph from '../components/Glyph.svelte';
  import Menu from '../components/Menu.svelte';
  import { PICTURE_NAMES } from '../picture';
  import { sfx } from '../sfx';
  import { consoleState as sys } from '../state.svelte';
  import type { MenuItem } from '../types';

  let { go }: { go: (path: string) => void } = $props();

  let report = $state.raw<Report | null>(null);
  let message = $state<{ text: string; bad?: boolean } | null>(null);
  /** The fault a game stopped with lately, which the report is about until the player says otherwise. */
  let fault = $state(lastFault());

  onMount(() => {
    sys.hints = [
      ['↑↓', 'SELECT'],
      ['ENTER', 'DO'],
      ['PGUP/PGDN', 'SCROLL'],
      ['ESC', 'BACK'],
    ];
  });

  const date = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '-');

  async function gather(): Promise<Report> {
    const s = sys.settings;
    const games: [string, string][] = sys.games.map((game) => {
      const def = gameDef(game);
      const install = sys.installs[game];
      const parts = [
        install ? `${install.files} files, ${megabytes(install.totalBytes)}, imported ${date(install.importedAt)}` : 'not loaded',
        ...(def.mod ? [`mod of ${gameDef(def.mod.base).short}${def.mod.version ? `, version ${def.mod.version}` : ''}${def.mod.known ? ` (${def.mod.known})` : ''}`] : []),
        `picture ${PICTURE_NAMES[sys.picture(game)].toLowerCase()}`,
        `${sys.saves[game] ?? 0} saves`,
        ...((sys.laid[game] ?? []).length ? [`add-ons ${(sys.laid[game] ?? []).join(', ')}`] : []),
      ];
      return [`${def.title} (${game})`, parts.join('; ')];
    });
    const addons: [string, string][] = addonRecords().map((record) => [
      record.title,
      `${record.id}${record.version ? ` ${record.version}` : ''}, for ${gameDef(record.base).short}; on for ${gamesWith(record.id).join(', ') || 'nothing'}`,
    ]);
    const sections: ReportSection[] = [
      consoleSection([['Screen', location.hash || '#/']]),
      { title: 'Games', rows: games },
      { title: 'Add-ons', rows: addons },
      {
        title: 'Settings',
        rows: [
          [
            'Games',
            [
              `scaling ${s.scaling}`,
              `improvements ${s.improvements ? 'on' : 'off'}`,
              `sound ${s.audio}`,
              `fast forward ${s.fastForward}x`,
              `autosave ${planLabel({ minutes: s.autosave, maps: s.autosaveMaps }).toLowerCase()}`,
              `intro ${s.skipIntro ? 'skipped' : 'played'}`,
              `fullscreen ${s.fullscreen ? 'on' : 'off'}`,
              `touch pointer ${s.touchPointer}`,
              `memory ${s.cacheMb} MB`,
            ].join(', '),
          ],
          ['Console', `tube effects ${s.crt ? 'on' : 'off'}, sounds ${s.sound ? 'on' : 'off'}, vault ${s.vault ? 'on' : 'off'}`],
          // Which cloud only: whose it is stays out of the report.
          ['Cloud', sys.cloud.linked ? `${sys.cloud.name} linked` : 'none linked'],
        ],
      },
      await machineSection(),
    ];
    if (fault) {
      sections.splice(1, 0, {
        title: 'Last fault',
        rows: [
          ['When', new Date(fault.at).toISOString().replace('T', ' ').slice(0, 16)],
          ['Game', `${fault.where}${fault.game ? ` (${fault.game})` : ''}`],
          ['Fault', `${fault.message}${fault.advice ? ` ${fault.advice}` : ''}`],
        ],
      });
    }
    return {
      kind: fault ? 'fault' : 'problem',
      where: fault?.where ?? 'Console',
      summary: fault?.message,
      sections,
      blocks: [
        ...(fault ? [{ title: 'Engine log before the fault', lines: fault.log }] : []),
        { title: 'Page errors', lines: pageErrorLines() },
      ],
    };
  }

  $effect(() => {
    // Gathered again when the fault is left out.
    void fault;
    void gather().then((made) => (report = made));
  });

  async function copy(quiet = false): Promise<boolean> {
    if (!report) return false;
    try {
      await navigator.clipboard.writeText(reportText(report));
      if (!quiet) {
        message = { text: 'Copied. Paste it into an issue, an email or a forum post.' };
        sfx.done();
      }
      return true;
    } catch {
      if (!quiet) {
        message = { text: 'The browser would not let the console copy. Save it as a file instead.', bad: true };
        sfx.deny();
      }
      return false;
    }
  }

  async function open(): Promise<void> {
    if (!report) return;
    const { url, cut } = issueUrl(report);
    const copied = cut ? await copy(true) : false;
    // Asked for without "noopener", which would leave no way to tell a tab opened from one kept from opening.
    const opened = window.open(url, '_blank');
    if (opened) opened.opener = null;
    message = !opened && !cut
      ? { text: 'The browser kept the new tab from opening. Copy the report, or save it.', bad: true }
      : cut
        ? { text: copied ? 'The logs were shortened to fit the link. The whole report is copied: paste it in if you can.' : 'The logs were shortened to fit the link. Save the report and attach it for the rest.' }
        : { text: 'Opened on GitHub in a new tab. Look it over, say what happened, and submit it there.' };
  }

  function save(): void {
    if (!report) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([reportText(report)], { type: 'text/markdown' }));
    link.download = reportFileName(report);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    message = { text: `Saved as ${link.download}.` };
    sfx.done();
  }

  const items = $derived<MenuItem[]>([
    { key: 'o', label: 'Open as a GitHub issue', icon: 'external', note: 'A new issue on the console\'s GitHub page, with this report in it, for you to read over and post.', disabled: !report, action: () => void open() },
    { key: 'c', label: 'Copy the report', icon: 'link', note: 'To paste it wherever you report it.', disabled: !report, action: () => void copy() },
    { key: 's', label: 'Save it as a file', icon: 'export-save', note: 'A Markdown file, to attach or send.', disabled: !report, action: save },
    ...(fault
      ? [
          {
            key: 'f',
            label: 'Leave out the last fault',
            icon: 'fault',
            note: 'The report is about the fault a game stopped with lately. Leave it out to report something else.',
            action: () => {
              forgetFault();
              fault = null;
            },
          } satisfies MenuItem,
        ]
      : []),
    { key: '0', label: 'Back', icon: 'back', action: () => go('manual/faults') },
  ]);
</script>

<h1>Problem report</h1>

<p class="gap">
  What the console knows that helps find a fault, written up the same way every time. Nothing leaves this console unless
  you send it: open it as a new issue on GitHub to read it over and post it, or copy it or save it to send another way. It
  names no accounts, saves or files of yours.
</p>

{#if message}
  <div class="panel signed" class:bad={message.bad} role="status">
    <Glyph name={message.bad ? 'fault' : 'ok'} tone={message.bad ? 'alert' : undefined} />
    <p class:alert={message.bad}>{message.text}</p>
  </div>
{/if}

<Menu {items} label="Report" />

{#if report}
  <div class="report-sheet gap">
    {#each report.sections.filter((section) => section.rows.length) as section (section.title)}
      <h2>{section.title}</h2>
      <dl class="readout">
        {#each section.rows as [name, value], at (at)}
          <dt>{name}</dt>
          <dd>{value}</dd>
        {/each}
      </dl>
    {/each}
    {#each report.blocks.filter((block) => block.lines.length) as block (block.title)}
      <h2>{block.title}</h2>
      <pre class="dim report-log">{block.lines.slice(-20).join('\n')}</pre>
    {/each}
  </div>
{:else}
  <p class="gap">GATHERING READINGS<span class="cursor"></span></p>
{/if}
