/**
 * Reader and writer for the games' .cfg / .ini files.
 *
 * Section and key names are matched without regard to case, as the engines
 * do, and keep the spelling they were first seen with. Comments are dropped:
 * the engines rewrite these files themselves and drop them too.
 */

export class Ini {
  private sections = new Map<string, { name: string; keys: Map<string, { name: string; value: string }> }>();

  static parse(text: string): Ini {
    const ini = new Ini();
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;
      if (line.startsWith('[')) {
        const end = line.indexOf(']');
        if (end > 0) {
          section = line.slice(1, end).trim();
          ini.ensureSection(section);
        }
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      // A trailing comment is part of the line in the original files only for
      // the high resolution patch's ini; strip it there, keep values intact.
      let value = line.slice(eq + 1);
      const comment = value.search(/\s;/);
      if (comment >= 0) value = value.slice(0, comment);
      ini.set(section, key, value.trim());
    }
    return ini;
  }

  private ensureSection(name: string) {
    const id = name.toLowerCase();
    let section = this.sections.get(id);
    if (!section) {
      section = { name, keys: new Map() };
      this.sections.set(id, section);
    }
    return section;
  }

  get(section: string, key: string): string | undefined {
    return this.sections.get(section.toLowerCase())?.keys.get(key.toLowerCase())?.value;
  }

  set(section: string, key: string, value: string | number): this {
    const keys = this.ensureSection(section).keys;
    const id = key.toLowerCase();
    const existing = keys.get(id);
    if (existing) {
      existing.value = String(value);
    } else {
      keys.set(id, { name: key, value: String(value) });
    }
    return this;
  }

  /** Sets a value only when the file does not have one yet. */
  setDefault(section: string, key: string, value: string | number): this {
    if (this.get(section, key) === undefined) this.set(section, key, value);
    return this;
  }

  delete(section: string, key: string): this {
    this.sections.get(section.toLowerCase())?.keys.delete(key.toLowerCase());
    return this;
  }

  toString(): string {
    const out: string[] = [];
    for (const section of this.sections.values()) {
      if (section.name) out.push(`[${section.name}]`);
      for (const { name, value } of section.keys.values()) out.push(`${name}=${value}`);
      out.push('');
    }
    return out.join('\r\n');
  }
}
