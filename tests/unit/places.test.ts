import { describe, expect, it } from 'vitest';
import { messages, placeName, readPlaces, whereabouts } from '../../src/lib/gamefacts';
import { ascii } from '../archives';

// The three files as the engine of Fallout 2 reads them, a few lines of each. Laid out like the real ones:
// comments after ";", the lines of a DOS text file, sections numbered without a gap.
const MAPS = ascii(
  [
    '; Note: Random encounter maps *do* map back to a city.',
    '',
    '[Map 000]',
    'lookup_name=Desert Encounter 1',
    'map_name=desert1',
    'music=07desert  ; Which song',
    '',
    '[Map 001]',
    'lookup_name=Arroyo Temple of Trials',
    'map_name=artemple',
    '',
    '[Map 002]',
    'lookup_name=Den Business',
    'map_name=denbus1',
    '',
    '[Map 003]',
    'lookup_name=Den Residential',
    'map_name=denres1',
    '',
    '; A gap ends the list: nothing after it is a map.',
    '[Map 005]',
    'lookup_name=Never Reached',
    'map_name=nowhere',
    '',
  ].join('\r\n'),
);

const AREAS = ascii(
  [
    '[Area 00]',
    'area_name=Arroyo',
    'townmap_art_idx=156',
    'entrance_0=On,130,200,ARROYO TEMPLE OF TRIALS,-1,-1,0',
    '',
    '[Area 01]',
    'area_name=The Den',
    'townmap_art_idx=157',
    'entrance_0=On,140,290,Den Business,0,22710,0 ; the west side',
    'entrance_1=Off,290,160,Den Residential,-1,-1,0',
    '',
    '[Area 02]',
    'area_name=Also The Den',
    'townmap_art_idx=158',
    // The first area that names a map has it.
    'entrance_0=On,1,1,Den Business,0,1,0',
    '',
    // No picture of the town: the engine stops reading areas here.
    '[Area 03]',
    'area_name=Not An Area',
    'entrance_0=On,1,1,Desert Encounter 1,0,1,0',
    '',
  ].join('\r\n'),
);

const NAMES = ascii(
  [
    '# Messages for maps',
    '{200}{}{Desert}',
    '{201}{}{}',
    '{203}{}{Temple of Trials}',
    '{206}{}{Business Area (West)}',
    '{207}{}{Basement}',
    '{209}{}{}',
    '{1500}{}{Arroyo}',
    '{1501}{}{The Den}',
    '{1502}{}{Elsewhere}',
    '',
  ].join('\r\n'),
);

describe('the names of places', () => {
  it('reads every message of a file by its number', () => {
    const found = messages(ascii('{100}{}{Desert}\r\n# a comment\r\n{116}{snd}{Shady\r\nSands}\r\n{200}{}{}'));
    expect([...found]).toEqual([
      [100, 'Desert'],
      [116, 'Shady Sands'],
      [200, ''],
    ]);
  });

  it('names a place as the engine of Fallout 2 does: the area a map is entered by, then the level', () => {
    const places = readPlaces('fo2', { names: NAMES, maps: MAPS, areas: AREAS });
    // Four maps: the list ends at the first number that is missing.
    expect(places.areas).toEqual(['', 'Arroyo', 'The Den', 'The Den']);
    expect(placeName(places, 1, 0)).toBe('Arroyo Temple of Trials');
    expect(placeName(places, 2, 0)).toBe('The Den Business Area (West)');
    expect(placeName(places, 2, 1)).toBe('The Den Basement');
    // A level without a name of its own is its area.
    expect(placeName(places, 3, 0)).toBe('The Den');
    // A map no area is entered by is its level.
    expect(placeName(places, 0, 0)).toBe('Desert');
  });

  it('says nothing where it does not know', () => {
    const places = readPlaces('fo2', { names: NAMES, maps: MAPS, areas: AREAS });
    expect(placeName(places, 0, 1)).toBeNull();
    expect(placeName(places, 4, 0)).toBeNull();
    expect(placeName(places, -1, 0)).toBeNull();
    expect(placeName(places, 1, 3)).toBeNull();
    expect(placeName(undefined, 1, 0)).toBeNull();
    // Versions of a save kept before the console read these numbers have none.
    expect(placeName(places, undefined as unknown as number, undefined as unknown as number)).toBeNull();
  });

  it('falls back on the name of the map file', () => {
    const places = readPlaces('fo2', { names: NAMES, maps: MAPS, areas: AREAS });
    expect(whereabouts(places, { map: 'ARTEMPLE', mapIndex: 1, elevation: 0 })).toBe('Arroyo Temple of Trials');
    expect(whereabouts(places, { map: 'NOWHERE', mapIndex: 40, elevation: 0 })).toBe('NOWHERE');
    expect(whereabouts(undefined, { map: 'ARTEMPLE', mapIndex: 1, elevation: 0 })).toBe('ARTEMPLE');
    // Without the lists of maps and areas there is nothing to go by, and without the words nothing to say.
    expect(readPlaces('fo2', { names: NAMES })).toEqual({ areas: [], levels: [] });
    expect(readPlaces('fo2', { maps: MAPS, areas: AREAS })).toEqual({ areas: [], levels: [] });
  });

  it('names a place as the engine of Fallout does, which knows its maps by heart', () => {
    const names = ascii(['{100}{}{Desert}', '{500}{}{Vault 13}', '{506}{}{Hub}', '{218}{}{Entrance}', '{219}{}{Living Quarters}', '{314}{}{Downtown}'].join('\r\n'));
    const places = readPlaces('fo1', { names });
    // Sixty-six maps, three levels each.
    expect(places.areas).toHaveLength(66);
    expect(places.levels).toHaveLength(198);
    // VAULT13 is map 6, HUBDWNTN map 38, DESERT1 map 0.
    expect(placeName(places, 6, 1)).toBe('Vault 13 Living Quarters');
    expect(placeName(places, 38, 0)).toBe('Hub Downtown');
    expect(placeName(places, 0, 0)).toBe('Desert');
    expect(placeName(places, 66, 0)).toBeNull();
  });
});
