<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { questState, type Quest } from '../../lib/modify/world';
  import { cardArt } from './art';
  import Card from './Card.svelte';
  import { FUEL_MAX, TICKS_PER_DAY, TICKS_PER_HOUR, shorten } from './editor.svelte';
  import Ledger from './Ledger.svelte';
  import { type LedgerRow, type SectionProps, stepper, thousands } from './section';

  // What the Pip-Boy keeps: the date, the quests of every place, the
  // holodisks, the world map; and, for whoever wants them, every one of the
  // game's global variables, which is what all of those are made of.
  let { editor, say }: SectionProps = $props();
  let selected = $state(untrack(() => editor.cursor.pipboy ?? 0));
  $effect(() => {
    editor.cursor.pipboy = selected;
  });

  const variables = $derived(editor.variables);
  let listed = $state(0);
  let query = $state('');
  let search: HTMLInputElement | undefined = $state();
  type Filter = 'all' | 'start' | 'here';
  let filter = $state<Filter>('all');
  const FILTERS: Filter[] = ['all', 'start', 'here'];
  const FILTER_NAMES: Record<Filter, string> = { all: 'ALL', start: 'NOT AS A NEW GAME', here: 'CHANGED HERE' };
  /** Rows listed at once in the list of every variable: more is found by searching. */
  const SHOWN = 150;

  /** Cards of the character screen both games have: Pathfinder, Experience, Science, Scout, Explorer, Intelligence. */
  const CARD = { time: 115, quest: 8, holodisk: 40, map: 117, water: 113, car: 115, variable: 4 } as const;

  const world = $derived(editor.world);
  const record = $derived(editor.record);
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  interface Line extends LedgerRow {
    card: number;
    title: string;
    text: string;
    facts?: string[];
    /** The variable it stands for, when it stands for one. */
    variable?: number;
    quest?: Quest;
  }

  const changed = (index: number) => editor.global(index) !== (editor.original.record.globals[index] ?? 0);
  const named = (name: string) => world.variables.find((variable) => variable.name.toUpperCase() === name)?.index;
  const carVariable = $derived(editor.session.game === 'fo2' ? named('GVAR_PLAYER_GOT_CAR') : undefined);

  /** A date typed as the Pip-Boy writes one: "25 JUL 2241" (or with the month's number). */
  function readDate(text: string): number | null {
    const match = /^\s*(\d{1,2})[\s/.-]+([a-z]{3}|\d{1,2})[\s/.-]+(\d{3,5})\s*$/i.exec(text);
    if (!match) return null;
    const month = /^\d+$/.test(match[2]!) ? Number(match[2]) : MONTHS.indexOf(match[2]!.toUpperCase()) + 1;
    const day = Number(match[1]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Days from the date shown now to the one typed, in the games' calendar of 365 days.
    const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const count = (m: number, d: number, y: number) => y * 365 + LENGTHS.slice(0, m - 1).reduce((sum, days) => sum + days, 0) + Math.min(d, LENGTHS[m - 1]!) - 1;
    const [nowMonth, nowDay, nowYear] = shownDate();
    return (count(month, day, year) - count(nowMonth, nowDay, nowYear)) * TICKS_PER_DAY;
  }

  function shownDate(): [number, number, number] {
    const text = editor.when(record.time).split(' ');
    return [MONTHS.indexOf(text[1]!) + 1, Number(text[0]), Number(text[2])];
  }

  const pipboyRows = $derived.by((): Line[] => {
    const lines: Line[] = [];
    const when = editor.when(record.time);
    const [date, clock] = [when.slice(0, when.lastIndexOf(' ')), when.slice(when.lastIndexOf(' ') + 1)];
    const timeChanged = record.time !== editor.original.record.time;
    const back = record.time < editor.original.record.time;
    const timeNote = back
      ? 'Earlier than the save was made: timers the game set wait the longer, and maps visited since think a long time has passed.'
      : 'Later than the save was made: whatever the game had timed for the hours between happens as soon as it loads.';
    lines.push({
      key: 'date',
      group: 'STATUS',
      label: 'Date',
      value: date,
      tone: timeChanged ? 'hot' : undefined,
      note: `←→ a day (SHIFT: 30), ENTER to type "25 JUL 2241".${timeChanged ? ` ${timeNote}` : ''}`,
      card: CARD.time,
      title: 'Date',
      text: 'The day the game has reached. It counts on from here when the save loads.',
      facts: timeChanged ? [timeNote] : undefined,
      less: record.time >= TICKS_PER_DAY,
      more: true,
      adjust: (direction, big) => editor.setTime(record.time + direction * (big ? 30 : 1) * TICKS_PER_DAY),
      input: {
        value: date,
        maxLength: 12,
        apply: (text) => {
          const shift = readDate(text);
          if (shift === null) say('A date as the Pip-Boy writes one, like 25 JUL 2241.', true);
          else editor.setTime(record.time + shift);
        },
      },
    });
    lines.push({
      key: 'clock',
      group: 'STATUS',
      label: 'Time of day',
      value: clock,
      tone: timeChanged ? 'hot' : undefined,
      note: '←→ an hour (SHIFT: six), ENTER to type "08:30".',
      card: CARD.time,
      title: 'Time of day',
      text: 'The hour the game has reached. Some people are only about at night, some shops only open by day.',
      less: record.time >= TICKS_PER_HOUR,
      more: true,
      adjust: (direction, big) => editor.setTime(record.time + direction * (big ? 6 : 1) * TICKS_PER_HOUR),
      input: {
        value: clock,
        maxLength: 5,
        apply: (text) => {
          const match = /^\s*(\d{1,2})[:.h ]?(\d{2})\s*$/.exec(text);
          if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
            say('A time of day like 08:30.', true);
            return;
          }
          const day = Math.floor(record.time / TICKS_PER_DAY) * TICKS_PER_DAY;
          editor.setTime(day + Number(match[1]) * TICKS_PER_HOUR + Number(match[2]) * 600);
        },
      },
    });
    if (world.water) {
      const { days, chip } = world.water;
      const saved = editor.global(chip) >= 2;
      const left = editor.global(days);
      lines.push({
        key: 'water',
        group: 'STATUS',
        label: "Vault 13's water",
        value: saved ? 'NO LONGER COUNTED' : `${left} DAYS`,
        tone: changed(days) ? 'hot' : saved ? 'dim' : left <= 30 ? 'amber' : undefined,
        locked: saved,
        variable: days,
        note: saved ? 'The water chip is home: the vault no longer counts its days.' : '←→ a day (SHIFT: 10), ENTER to type. The days the vault has left before its water runs out.',
        card: CARD.water,
        title: "Vault 13's water",
        text: 'The days Vault 13 has left before its water runs out, counted down once a day until the water chip is brought home.',
        ...(saved ? {} : stepper({ current: left, set: (value) => editor.setGlobal(days, value), min: 0, max: 9999, digits: 4 })),
      });
    }
    if (carVariable !== undefined && editor.global(carVariable) !== 0 && record.areas.length) {
      lines.push({
        key: 'fuel',
        group: 'STATUS',
        label: "Car's fuel",
        value: `${thousands(record.fuel)} / ${thousands(FUEL_MAX)}`,
        tone: record.fuel !== editor.original.record.fuel ? 'hot' : record.fuel < FUEL_MAX / 5 ? 'amber' : undefined,
        note: '←→ by 1,000 (SHIFT: by 10,000), ENTER to type.',
        card: CARD.car,
        title: "Car's fuel",
        text: 'What is left in the tank of the car. It burns as the car crosses the world map.',
        ...stepper({ current: record.fuel, set: (value) => editor.setFuel(value), min: 0, max: FUEL_MAX, step: 1000, bigStep: 10_000, digits: 6 }),
      });
    }

    for (const quest of world.quests) {
      const value = editor.global(quest.variable);
      const state = questState(quest, value);
      lines.push({
        key: `q${quest.variable}:${lines.length}`,
        group: quest.place.toUpperCase() || 'QUESTS',
        label: quest.text,
        mark: state === 'done' ? '*' : '',
        value: state === 'done' ? 'DONE' : state === 'open' ? 'OPEN' : 'NOT SHOWN',
        tone: changed(quest.variable) ? 'hot' : state === 'hidden' ? 'dim' : undefined,
        variable: quest.variable,
        quest,
        note: `C to complete, O to open, R for a new game's state. ←→ steps its variable (${value}), ENTER to type.`,
        card: CARD.quest,
        title: quest.place || 'Quest',
        text: quest.text,
        ...stepper({ current: value, set: (next) => editor.setGlobal(quest.variable, next), min: -99_999, max: 99_999, digits: 6 }),
      });
    }

    for (const disk of world.holodisks) {
      const value = editor.global(disk.variable);
      lines.push({
        key: `h${disk.variable}`,
        group: 'HOLODISKS',
        label: disk.name,
        mark: value ? '*' : '',
        value: value ? 'HELD' : '',
        tone: changed(disk.variable) ? 'hot' : value ? undefined : 'dim',
        variable: disk.variable,
        note: value ? 'ENTER to take it out of the Pip-Boy.' : 'ENTER to put it in the Pip-Boy, to be read there.',
        card: CARD.holodisk,
        title: disk.name,
        text: 'A holodisk the Pip-Boy has read: its text is in the Pip-Boy, under DATA.',
        action: () => toggleDisk(disk.variable, disk.name),
      });
    }

    const saved = editor.original.map.rest?.world;
    world.areas.forEach((area, index) => {
      const known = editor.areaKnown(index);
      const visited = area.variable === undefined && (record.areas[area.index] ?? 0) >= 2;
      // Fallout 2's engine keeps some places off the map until a script shows them.
      const hidden = area.variable === undefined && saved?.kind === 'fo2' && (saved.areas[area.index]?.state ?? 1) === 0;
      const was = area.variable !== undefined ? (editor.original.record.globals[area.variable] ?? 0) !== 0 : (editor.original.record.areas[area.index] ?? 0) > 0;
      lines.push({
        key: `m${area.index}`,
        group: 'WORLD MAP',
        label: area.name,
        mark: known ? '*' : '',
        value: visited ? 'VISITED' : known ? 'KNOWN' : '',
        tone: known !== was ? 'hot' : known ? undefined : 'dim',
        variable: area.variable,
        note: known ? 'ENTER to make it unknown again.' : 'ENTER to mark it on the world map, to travel to.',
        card: CARD.map,
        title: area.name,
        text: known ? 'On the world map: the character can travel there.' : 'Not yet on the world map.',
        facts: hidden ? ['The game keeps this place hidden until a quest reveals it: marking it shows it now.'] : undefined,
        action: () => toggleArea(index),
      });
    });
    return lines;
  });

  function toggleDisk(variable: number, name: string): void {
    const held = editor.global(variable) !== 0;
    editor.setGlobal(variable, held ? 0 : (editor.original.record.globals[variable] || 1));
    say(held ? `Took ${name} out of the Pip-Boy.` : `${name} is in the Pip-Boy.`);
  }

  function toggleArea(index: number): void {
    const known = editor.areaKnown(index);
    editor.setAreaKnown(index, !known);
    const name = world.areas[index]?.name ?? '';
    say(known ? `${name} is no longer on the world map.` : `${name} is on the world map.`);
  }

  // ---------------------------------------------------------------------
  // Every variable
  // ---------------------------------------------------------------------

  const found = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return world.variables.filter((variable) => {
      const value = editor.global(variable.index);
      if (filter === 'start' && value === variable.start) return false;
      if (filter === 'here' && !changed(variable.index)) return false;
      if (!words.length) return true;
      const meaning = editor.meaning(variable.index)?.name ?? '';
      const text = `${variable.index} ${variable.name} ${variable.note} ${meaning}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  });

  const variableRows = $derived(
    found.slice(0, SHOWN).map((variable): Line => {
      const value = editor.global(variable.index);
      const meaning = editor.meaning(variable.index);
      const said = meaning ? shorten(meaning.name, 60) : variable.note;
      return {
        key: `v${variable.index}`,
        label: `${variable.index} ${variable.name}`,
        value: thousands(value),
        tone: changed(variable.index) ? 'hot' : value === variable.start ? 'dim' : undefined,
        variable: variable.index,
        note: `${said ? `${said}. ` : ''}←→ to change (SHIFT: by 10), ENTER to type, R for a new game's ${variable.start}.`,
        card: CARD.variable,
        title: variable.name,
        text: variable.note,
        ...stepper({ current: value, set: (next) => editor.setGlobal(variable.index, next), min: -2_147_483_648, max: 2_147_483_647, digits: 11 }),
      };
    }),
  );

  function openVariables(): void {
    editor.variables = !editor.variables;
    say(editor.variables ? 'Every global variable of the game. Type to search.' : 'Back to what the Pip-Boy shows.');
    if (editor.variables) void tick().then(() => search?.focus());
  }

  function cycle(): void {
    filter = FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length]!;
    listed = 0;
    say(`Showing ${filter === 'all' ? 'every variable' : filter === 'start' ? 'the variables not as a new game has them' : 'the variables changed here'}.`);
  }

  function onkey(event: KeyboardEvent, row: LedgerRow | undefined): boolean {
    const key = event.key.toLowerCase();
    if (key === 'v' && !variables) {
      openVariables();
      return true;
    }
    const line = (variables ? variableRows : pipboyRows).find((entry) => entry.key === row?.key);
    if (key === 'r' && line?.variable !== undefined) {
      reset(line.variable);
      return true;
    }
    if (variables) {
      if (key === 'f') {
        cycle();
        return true;
      }
      // Anything else typed is a search.
      if (event.key.length === 1 && event.key !== ' ' && search) {
        search.focus();
        query += event.key;
        listed = 0;
        return true;
      }
      if (event.key === 'Backspace' && search) {
        search.focus();
        query = query.slice(0, -1);
        return true;
      }
      return false;
    }
    if (line?.quest && key === 'c') {
      complete(line.quest);
      return true;
    }
    if (line?.quest && key === 'o') {
      open(line.quest);
      return true;
    }
    return false;
  }

  /** Crossed out in the Pip-Boy: the variable at the value it is done from, or above. */
  function complete(quest: Quest): void {
    editor.setGlobal(quest.variable, Math.max(editor.global(quest.variable), quest.done));
    say(`Crossed out in the Pip-Boy: ${shorten(quest.text, 50)}`);
  }

  /** Shown in the Pip-Boy, not done: the value it is shown from (never 0, which a new game has). */
  function open(quest: Quest): void {
    const value = editor.global(quest.variable);
    editor.setGlobal(quest.variable, value >= quest.done || value < quest.shown ? Math.max(quest.shown, 1) : value);
    say(`Open in the Pip-Boy: ${shorten(quest.text, 50)}`);
  }

  function reset(variable: number): void {
    editor.resetGlobal(variable);
    say(`As a new game has it: ${editor.global(variable)}.`);
  }

  function onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      search?.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (query) query = '';
      else editor.variables = false;
    }
  }

  const rows = $derived(variables ? variableRows : pipboyRows);
  const current = $derived((variables ? variableRows[listed] : pipboyRows[selected]) ?? null);
  const start = $derived(current?.variable !== undefined ? world.variables[current.variable]?.start : undefined);
  const counts = $derived.by(() => {
    let open = 0;
    let done = 0;
    for (const quest of world.quests) {
      const state = questState(quest, editor.global(quest.variable));
      if (state === 'open') open++;
      if (state === 'done') done++;
    }
    return { open, done };
  });

</script>

<div class="modify-main">
  <div class="modify-list">
    {#if variables}
      <label class="field picker-search">
        <span>Find</span>
        <input type="text" bind:this={search} bind:value={query} placeholder="a name, a number, a word" spellcheck="false" autocomplete="off" autocapitalize="off" onkeydown={onSearchKey} oninput={() => (listed = 0)} />
      </label>
      <p class="modify-status">
        <span class="pair"><b>Variables</b> {found.length > SHOWN ? `${SHOWN} of ${thousands(found.length)}` : thousands(found.length)}</span>
        <button type="button" class="chip" onclick={cycle}>[F] {FILTER_NAMES[filter]}</button>
        <button type="button" class="chip" onclick={openVariables}>[ESC] PIP-BOY</button>
      </p>
      <Ledger rows={variableRows} bind:selected={listed} label="Every global variable" {onkey} valueWidth={11} empty="NO VARIABLE BY THAT. F FOR OTHERS." />
    {:else}
      <p class="modify-status">
        <span class="pair"><b>Quests open</b> {counts.open}</span>
        <span class="pair"><b>Done</b> {counts.done}</span>
        <button type="button" class="chip" onclick={openVariables}>[V] EVERY VARIABLE</button>
      </p>
      <Ledger {rows} bind:selected label="Pip-Boy" {onkey} valueWidth={17} />
    {/if}
  </div>
  {#if current}
    <Card picture={cardArt(editor.session.pictures, current.card)} title={current.title} description={current.quest ? '' : current.text}>
      {#if current.quest}
        {@const quest = current.quest}
        {@const value = editor.global(quest.variable)}
        <p>{quest.text}</p>
        <p><span class="pair"><b>Now</b> {value}</span><span class="pair"><b>Shown from</b> {quest.shown}</span><span class="pair"><b>Done from</b> {quest.done}</span></p>
        <p class="card-text">The Pip-Boy's record only: what the quest brings is for the game's scripts to give.</p>
        <p class="card-buttons">
          <button type="button" class="card-button" onclick={() => complete(quest)}>[C] Complete</button>
          <button type="button" class="card-button" onclick={() => reset(quest.variable)}>[R] New game</button>
        </p>
      {:else if variables && current.variable !== undefined}
        {@const meaning = editor.meaning(current.variable)}
        <p>
          <span class="pair"><b>Number</b> {current.variable}</span>
          <span class="pair"><b>Now</b> {thousands(editor.global(current.variable))}</span>
          {#if start !== undefined}<span class="pair"><b>New game</b> {thousands(start)}</span>{/if}
        </p>
        {#if meaning}<p>{meaning.kind === 'quest' ? 'Quest' : meaning.kind === 'water' ? 'Water' : meaning.kind[0]!.toUpperCase() + meaning.kind.slice(1)}: {meaning.name}</p>{/if}
      {/if}
      {#if current.facts}
        {#each current.facts as fact (fact)}<p class="amber">{fact}</p>{/each}
      {/if}
    </Card>
  {:else}
    <Card picture={cardArt(editor.session.pictures, CARD.variable)} title="Nothing found" description="No variable answers to that." />
  {/if}
</div>
