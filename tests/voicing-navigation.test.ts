import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUALITIES, voicings, type Voicing } from '../lib/harmony.ts';
import {
  browseVoicings,
  stringSetLabel,
  voicingStringSet,
} from '../lib/voicing-navigation.ts';

const catalog = (quality: string) =>
  voicings(
    'C',
    QUALITIES.find((item) => item.id === quality)!,
  );
const key = (voicing: Voicing) => voicing.frets.join(',');

void test('near-fret ordering brings the lower C13 grip before its octave copy', () => {
  const source = catalog('13');
  const originalOrder = source.map(key);
  const choices = browseVoicings(source, {
    bass: 'all',
    strings: 'all',
    nearFret: 8,
  });
  const low = choices.findIndex(({ voicing }) => key(voicing) === '8,,8,9,10,');
  const high = choices.findIndex(
    ({ voicing }) => key(voicing) === '20,,20,21,22,',
  );
  assert.ok(low >= 0 && high > low);
  assert.deepEqual(
    source.map(key),
    originalOrder,
    'catalog ordering stays untouched',
  );
  for (const choice of choices)
    assert.equal(choice.voicing, source[choice.originalIndex]);
});

void test('every requested fret 0–24 retains every available C13 and Cmaj13 shape', () => {
  for (const quality of ['13', 'maj13']) {
    const source = catalog(quality);
    for (let fret = 0; fret <= 24; fret++) {
      const choices = browseVoicings(source, {
        bass: 'all',
        strings: 'all',
        nearFret: fret,
      });
      assert.equal(choices.length, source.length);
      assert.equal(
        new Set(choices.map(({ originalIndex }) => originalIndex)).size,
        source.length,
      );
    }
    const high = browseVoicings(source, {
      bass: 'all',
      strings: 'all',
      nearFret: 24,
    });
    assert.ok(
      high[0].voicing.frets.includes(24),
      'the upper neck is reachable through the same ordering',
    );
  }
});

void test('top-three-string C13 and Cmaj13 grips preserve their actual bass and omissions', () => {
  for (const fixture of [
    { quality: '13', bass: '10', frets: ',,,3,5,5', notes: ['Bb', 'E', 'A'] },
    { quality: 'maj13', bass: '11', frets: ',,,4,5,5', notes: ['B', 'E', 'A'] },
  ]) {
    const choices = browseVoicings(catalog(fixture.quality), {
      bass: fixture.bass,
      strings: '3,4,5',
      nearFret: 0,
    });
    const authored = choices.find(
      ({ voicing }) => key(voicing) === fixture.frets,
    )?.voicing;
    assert.ok(
      authored,
      `retain the independently specified ${fixture.quality} grip`,
    );
    assert.equal(authored.rootless, true);
    assert.deepEqual(
      authored.soundedNotes.map((note) => note.name),
      fixture.notes,
    );
    assert.deepEqual(
      authored.omittedNotes.map((note) => note.degree),
      ['1', '5', '9', '11'],
    );
    assert.ok(
      choices.every(({ voicing }) => String(voicing.bass.pc) === fixture.bass),
    );
    assert.ok(
      choices.every(({ voicing }) =>
        voicing.frets.slice(0, 3).every((fret) => fret === null),
      ),
    );
    assert.ok(
      choices.every(({ voicing }) =>
        voicing.frets.slice(3).every((fret) => fret !== null),
      ),
    );
  }
});

void test('string filters describe exact sounding strings, including skipped strings and open notes', () => {
  const source = catalog('13');
  const choices = browseVoicings(source, {
    bass: 'all',
    strings: '0,2,3,4',
    nearFret: null,
  });
  assert.ok(choices.some(({ voicing }) => key(voicing) === '8,,8,9,10,'));
  assert.equal(stringSetLabel('0,2,3,4'), 'E D G B');
  assert.equal(
    voicingStringSet({ frets: [null, null, null, 2, 0, 0] }),
    '3,4,5',
  );
  assert.equal(stringSetLabel('3,4,5'), 'G B e');
  assert.ok(
    choices.every(
      ({ voicing }) => voicing.frets[1] === null && voicing.frets[5] === null,
    ),
  );
});

void test('an impossible bass and string intersection stays empty until filters are cleared', () => {
  const source = catalog('maj13');
  assert.deepEqual(
    browseVoicings(source, { bass: '0', strings: '3,4,5', nearFret: 12 }),
    [],
  );
  const reset = browseVoicings(source, {
    bass: 'all',
    strings: 'all',
    nearFret: null,
  });
  assert.deepEqual(
    reset.map(({ voicing }) => voicing),
    source,
  );
});

void test('a ringing open string does not misclassify a high-position grip as near the nut', () => {
  const template = catalog('major')[0];
  const high = { ...template, frets: [0, null, null, 9, 8, 8] };
  const low = { ...template, frets: [null, 3, 2, 0, 1, 0] };
  const choices = browseVoicings([high, low], {
    bass: 'all',
    strings: 'all',
    nearFret: 0,
  });
  assert.equal(choices[0].voicing, low);
});
