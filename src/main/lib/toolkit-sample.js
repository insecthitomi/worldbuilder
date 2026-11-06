'use strict';
/* The Toolkit's part of the example world: random tables of the Saltmarch (nested and with inline dice), the wyrm
   encounter's combatants, a session log, and the world's coins and old measures. All text is original. */

const rows = (list) => list.map(x => (Array.isArray(x) ? { text: x[1], weight: x[0] } : { text: x, weight: 1 }));
const ranged = (list) => list.map(([r, text]) => { const [a, b] = String(r).split('-').map(Number); return { text, range: [a, b == null || isNaN(b) ? a : b], weight: (b == null || isNaN(b) ? a : b) - a + 1 }; });

function statsOf(core, id) {
  if (!id) return {};
  try {
    const e = core.full(id), t = core.typeById(e.typeId), out = {};
    for (const d of (t && t.fields) || []) if (d.kind === 'stats') for (const s of e.fields[d.key] || []) out[String(s.label).toLowerCase()] = s.value;
    return out;
  } catch { return {}; }
}

function sample(ctx, S) {
  const core = ctx.core, w = S.worldId;
  const add = (key, title, dice, list, summary, body) => {
    const e = core.createEntry({ worldId: w, typeKey: 'table', title, summary, body: body || '', fields: { dice: dice || '' }, data: { rows: list } });
    S.set(key, e.id);
    return e;
  };

  add('tabletaverns', 'Saltmarch tavern names', '', rows([
    [2, 'The Drowned Lantern'], 'The Gull and Kettle', 'The Tide-Bell', [2, 'The Crooked Oar'], 'The Salt Widow', 'The Last Light Before the Flats',
    'The Brinejaw\'s Rest', 'The Three Herrings', 'The Leaning Mast', 'The {Red|Grey|Black} Seal', 'The Wet Saint', 'The Lord\'s Cough', 'The Ledger and Lamp', [3, 'The Anchor (there is always one called the Anchor)'],
  ]), 'Names for drinking holes from Gullhaven to the Crown road. Weighted: the Anchor turns up everywhere.');

  add('tableweather', 'Weather on the flats', '2d6', ranged([
    ['2', 'A salt-storm: white grit on the wind, nothing visible past arm\'s length. Travel stops.'],
    ['3-4', 'Sea-fog rolls in; the crust is slick and sounds carry strangely.'],
    ['5-6', 'Grey and windless. Every footstep can be heard a mile off.'],
    ['7-8', 'Hard sun on the salt. Without veils, eyes burn by noon.'],
    ['9-10', 'Wind off the sea, rain by dusk; the crust softens underfoot.'],
    ['11', 'Thunder over Storm Spire. Something under the salt turns over in its sleep.'],
    ['12', 'Mirage: a drowned town shimmers on the horizon, bells ringing.'],
  ]), 'What the Grey Flats are doing today. Roll 2d6.');

  add('tablerumours', 'Rumours on the docks', '1d8', ranged([
    ['1', 'A Gull runner swears Tamsin Reed bought {2d6} barrels of lamp oil last night. Nobody can say for what.'],
    ['2', 'They say the ale at [[Saltmarch tavern names]] has been watered with seawater since the storm.'],
    ['3', 'Ysolde Vey\'s crew saw lights inside Storm Spire again — {1d4+1} of them, moving.'],
    ['4', 'The harbour guard is paid twice: once by the Lord, once by someone else.'],
    ['5', 'A Crown tax-seal turned up in a fish\'s belly. The fishmonger has vanished.'],
    ['6', 'Old Halloran was seen weeping at the Drowned Church. Halloran does not weep.'],
    ['7', 'The weather-wives say the flats will bring {2d6} days of [[Weather on the flats]].'],
    ['8', 'Someone is buying every bell in Gullhaven and melting them down.'],
  ]), 'Overheard on the quays of Gullhaven. Some of it is even true.');

  add('tableencounters', 'Salt-flat encounters', '1d12', ranged([
    ['1', 'The Salt Wyrm surfaces under the heaviest creature. (Run the encounter “Salt Wyrm on the Flats”.)'],
    ['2', '{1d4+1} Saltwardens cutting blocks, suspicious of anyone without a tally-stick.'],
    ['3', 'A cart sunk to its axles. The driver is gone; the mule is not.'],
    ['4', 'A Gull smuggler with a donkey, a lie and {1d6} casks of something.'],
    ['5', 'A pilgrim to the Drowned Church, walking barefoot, singing to the ground.'],
    ['6', 'The picked bones of a wyrm\'s last meal, still wearing boots.'],
    ['7', 'A Crown tax collector and {1d3} bored guards, lost.'],
    ['8', 'A bell ringing somewhere under the salt.'],
    ['9', 'Hollow crust: everyone tests their footing or someone falls in to the waist.'],
    ['10', 'A ship\'s figurehead lying on the salt, miles from any water.'],
    ['11', 'Weather turns: [[Weather on the flats]]'],
    ['12', 'Nothing at all, and the silence is wrong.'],
  ]), 'What crosses your path on the Grey Flats. Roll 1d12; nested tables roll themselves.');

  // the wyrm encounter's combatants: the wyrm and the party from the sessions
  const enc = S.e('encwyrm');
  if (enc) {
    const cmb = [];
    const mk = (key, side, fallback, init) => {
      const id = S.e(key); if (!id) return;
      const st = statsOf(core, id), hp = parseInt(st.hp, 10) || fallback.hp, ac = parseInt(st.ac, 10) || fallback.ac;
      const attacks = Object.entries(st).filter(([k, v]) => !['hp', 'ac', 'init'].includes(k) && /^\s*\d*d\d+/i.test(String(v))).map(([k, v]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), dice: String(v) }));
      cmb.push({ id: 'c' + (cmb.length + 1), name: core.full(id).title, entryId: id, side, init, mod: parseInt(st.init, 10) || 0, hp, maxHp: hp, temp: 0, ac, conditions: [], notes: '', attacks });
    };
    mk('saltwyrm', 'foe', { hp: 84, ac: 15 }, 14);
    mk('ysolde', 'party', { hp: 24, ac: 14 }, 17);
    mk('mira', 'party', { hp: 16, ac: 11 }, 11);
    mk('fenn', 'party', { hp: 18, ac: 13 }, 9);
    if (cmb.length) {
      const wyrm = cmb.find(c => c.side === 'foe');
      if (wyrm) wyrm.notes = 'Surfaces under the heaviest creature. Flees from bells.';
      core.updateEntry(enc, { dataPatch: { combatants: cmb, round: 0, turn: 0, log: [] } });
    }
  }

  // a log for the first session
  const s1 = S.e('session1');
  if (s1) {
    const at = (h, m) => '2026-10-03T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00';
    core.updateEntry(s1, { dataPatch: { log: [
      { t: at(19, 4), kind: 'start', text: 'Session started' },
      { t: at(19, 18), kind: 'place', text: 'Arrived in Gullhaven in the storm', ref: S.e('gullhaven') },
      { t: at(19, 41), kind: 'npc', text: 'Met Captain Halloran at the harbour gate', ref: S.e('halloran') },
      { t: at(20, 25), kind: 'note', text: 'Ysolde talks the harbourmaster into lending a boat' },
      { t: at(21, 2), kind: 'combat', text: 'Fight on the breakwater: two Gull runners' },
      { t: at(21, 50), kind: 'loot', text: 'A wet map of the Spire' },
      { t: at(22, 15), kind: 'end', text: 'Session ended' },
    ].map(x => (x.ref ? x : Object.assign(x, { ref: null }))) } });
  }

  // the world's coins and old measures for the converters
  try {
    ctx.call('worlds.update', w, { settings: {
      currencies: [{ name: 'crown', abbr: 'cr', value: 240 }, { name: 'tide-mark', abbr: 'tm', value: 12 }, { name: 'salt-penny', abbr: 'sp', value: 1 }],
      units: [
        { name: 'league', abbr: 'lea', kind: 'length', factor: 4828 }, { name: 'fathom', abbr: 'ftm', kind: 'length', factor: 1.83 }, { name: 'wyrm-length', abbr: 'wl', kind: 'length', factor: 21 },
        { name: 'salt-stone', abbr: 'sst', kind: 'weight', factor: 6.35 }, { name: 'cask', abbr: 'cask', kind: 'volume', factor: 180 }, { name: 'tide', abbr: 'tide', kind: 'time', factor: 44700 },
      ],
    } });
  } catch { }
}

module.exports = { sample, statsOf };
