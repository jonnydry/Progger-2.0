import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SCALES,ROOTS,spell,patterns,pitchClass,mod,TUNING} from '../lib/music.ts';
import {QUALITIES,parseChord,parseProgression,matchScales,perChordChoices,diatonicChords,voicings,colorChoices} from '../lib/harmony.ts';

const fixtures:Record<string,{names:string;pcs:number[]}>= {
 'dorian-b2':{names:'C Db Eb F G A Bb',pcs:[0,1,3,5,7,9,10]},
 'lydian-augmented':{names:'C D E F# G# A B',pcs:[0,2,4,6,8,9,11]},
 'lydian-dominant':{names:'C D E F# G A Bb',pcs:[0,2,4,6,7,9,10]},
 'mixolydian-b6':{names:'C D E F G Ab Bb',pcs:[0,2,4,5,7,8,10]},
 'locrian-natural2':{names:'C D Eb F Gb Ab Bb',pcs:[0,2,3,5,6,8,10]},
 'altered':{names:'C Db D# E F# Ab Bb',pcs:[0,1,3,4,6,8,10]},
 'locrian-natural6':{names:'C Db Eb F Gb A Bb',pcs:[0,1,3,5,6,9,10]},
 'ionian-augmented':{names:'C D E F G# A B',pcs:[0,2,4,5,8,9,11]},
 'dorian-sharp4':{names:'C D Eb F# G A Bb',pcs:[0,2,3,6,7,9,10]},
 'phrygian-dominant':{names:'C Db E F G Ab Bb',pcs:[0,1,4,5,7,8,10]},
 'lydian-sharp2':{names:'C D# E F# G A B',pcs:[0,3,4,6,7,9,11]},
 'ultralocrian':{names:'C Db Eb Fb Gb Ab Bbb',pcs:[0,1,3,4,6,8,9]},
 'whole-tone':{names:'C D E F# G# Bb',pcs:[0,2,4,6,8,10]},
 'half-whole-diminished':{names:'C Db D# E F# G A Bb',pcs:[0,1,3,4,6,7,9,10]},
 'whole-half-diminished':{names:'C D Eb F Gb Ab A B',pcs:[0,2,3,5,6,8,9,11]},
};
const scale=(id:string)=>{const result=SCALES.find(item=>item.id===id);assert.ok(result,`Missing ${id}`);return result;};
const roots=ROOTS;
const sorted=(pcs:number[])=>[...pcs].sort((a,b)=>a-b);
const matches=(symbol:string)=>matchScales([parseChord(symbol)]).flatMap(group=>group.candidates);

void test('authored extended-scale spellings and semitone sets agree in every key',()=>{
 assert.equal(new Set(SCALES.map(item=>item.id)).size,SCALES.length);
 for(const [id,fixture] of Object.entries(fixtures)){
  const definition=scale(id);
  assert.deepEqual(spell('C',definition.formula).map(note=>note.name),fixture.names.split(' '),id);
  for(const root of roots){
   const notes=spell(root,definition.formula);
   assert.equal(new Set(notes.map(note=>note.pc)).size,fixture.pcs.length,`${root} ${id}: duplicate pitch`);
   assert.deepEqual(notes.map(note=>mod(note.pc-pitchClass(root))),fixture.pcs,`${root} ${id}`);
   for(const note of notes)assert.equal(pitchClass(note.name),note.pc);
  }
 }
 assert.deepEqual(spell('C',scale('altered').formula).map(note=>note.degree),['1','b9','#9','3','#11','b13','b7']);
});

void test('each minor-family mode preserves its independently authored parent collection',()=>{
 const families=[
  {roots:['C','D','Eb','F','G','A','B'],ids:['melodic-minor','dorian-b2','lydian-augmented','lydian-dominant','mixolydian-b6','locrian-natural2','altered'],pcs:[0,2,3,5,7,9,11]},
  {roots:['C','D','Eb','F','G','Ab','B'],ids:['harmonic-minor','locrian-natural6','ionian-augmented','dorian-sharp4','phrygian-dominant','lydian-sharp2','ultralocrian'],pcs:[0,2,3,5,7,8,11]},
 ];
 for(const family of families)for(const [index,id] of family.ids.entries())
  assert.deepEqual(sorted(spell(family.roots[index],scale(id).formula).map(note=>note.pc)),family.pcs,id);
});

void test('symmetric collections keep their interval cycles without invented practice patterns',()=>{
 for(const [id,steps,count] of [
  ['whole-tone',[2,2,2,2,2,2],2],
  ['half-whole-diminished',[1,2,1,2,1,2,1,2],3],
  ['whole-half-diminished',[2,1,2,1,2,1,2,1],3],
 ] as const){
  const collectionKeys=new Set<string>();
  for(const root of roots){
   const notes=spell(root,scale(id).formula),relative=notes.map(note=>mod(note.pc-pitchClass(root)));
   assert.deepEqual(relative.map((pc,index)=>mod(relative[(index+1)%relative.length]-pc)),steps);
   assert.deepEqual(patterns(notes),[],`${id}: no reviewed 3NPS or box pattern`);
   assert.deepEqual(diatonicChords(root,scale(id)),[],`${id}: no seven-degree triad inference`);
   collectionKeys.add(sorted(notes.map(note=>note.pc)).join(','));
  }
  assert.equal(collectionKeys.size,count,id);
 }
 assert.deepEqual(diatonicChords('C',scale('altered')),[],'Functional tension labels do not define diatonic thirds');
});

void test('new seven-note practice patterns remain complete, scalar and inside frets 0–24',()=>{
 for(const id of Object.keys(fixtures).filter(id=>fixtures[id].pcs.length===7))for(const root of roots){
  const notes=spell(root,scale(id).formula),pcs=new Set(notes.map(note=>note.pc)),shapes=patterns(notes);
  assert.ok(shapes.length>0,`${root} ${id}: at least one complete position`);
  for(const shape of shapes){
   assert.equal(shape.positions.length,18);
   assert.ok(shape.max-shape.min<=6);
   for(let string=0;string<6;string++){
    const positions=shape.positions.filter(position=>position.string===string);
    assert.equal(positions.length,3);assert.ok(positions[2].fret-positions[0].fret<=5);
   }
   for(const [index,position] of shape.positions.entries()){
    assert.ok(Number.isInteger(position.fret)&&position.fret>=0&&position.fret<=24);
    assert.equal(position.midi,TUNING[position.string]+position.fret);assert.ok(pcs.has(mod(position.midi)));
    if(index){
     const previous=shape.positions[index-1].midi;assert.ok(position.midi>previous);
     for(let skipped=previous+1;skipped<position.midi;skipped++)assert.ok(!pcs.has(mod(skipped)));
    }
   }
  }
 }
});

void test('advanced chords expose useful same-root exact choices before parent-key aliases',()=>{
 for(const [symbol,id] of [
  ['C7#9','half-whole-diminished'],['C7b9','phrygian-dominant'],
  ['C7#11','lydian-dominant'],['C9#11','lydian-dominant'],['C7b13','mixolydian-b6'],
  ['Cdim7','whole-half-diminished'],['Cm7b5','locrian-natural2'],
 ] as const){
  assert.ok(matches(symbol).some(candidate=>candidate.root==='C'&&candidate.scale.id===id),`${symbol} → C ${id}`);
  const first=perChordChoices(parseChord(symbol))[0];assert.ok(first,symbol);
  assert.equal(first.root,'C');assert.equal(first.scale.id,id,symbol);
  const primary=matchScales([parseChord(symbol)])[0].candidates[0];
  assert.equal(primary.root,'C');assert.equal(primary.scale.id,id,`${symbol}: primary match`);
 }
});

void test('every supported chord quality has an exact same-root scale option in every selectable key',()=>{
 for(const root of roots)for(const quality of QUALITIES){
  const chord=parseChord(root+quality.symbol),choices=perChordChoices(chord);
  assert.ok(choices.length>0,`${chord.symbol}: missing exact same-root option`);
  for(const candidate of choices){
   assert.equal(candidate.root,root);
   assert.ok(chord.pcs.every(pc=>candidate.notes.some(note=>note.pc===pc)),chord.symbol);
  }
 }
});

void test('exact coverage never disguises altered-scale omissions or slash bass conflicts',()=>{
 for(const symbol of ['C7','C7b9','C7#9','C7#11','C7b13']){
  const chord=parseChord(symbol);assert.ok(chord.pcs.includes(7));
  assert.ok(!matches(symbol).some(candidate=>candidate.root==='C'&&['altered','whole-tone'].includes(candidate.scale.id)),`${symbol}: natural fifth is absent from these colors`);
 }
 const chord=parseChord('C7#9'),before=[...chord.pcs];
 assert.ok(voicings(chord.root,chord.quality).some(shape=>shape.omittedNotes.some(note=>note.degree==='5')));
 assert.deepEqual(chord.pcs,before);
 assert.ok(!matchScales([chord]).flatMap(group=>group.candidates).some(candidate=>candidate.root==='C'&&candidate.scale.id==='altered'));
 assert.ok(!matches('C7#11/Db').some(candidate=>candidate.root==='C'&&candidate.scale.id==='lydian-dominant'));
 for(const input of ['C7#9','C7b9','C7#11','C9#11','C7b13','Cdim7','C7#11/Db','Am G F E7','A7 D7 E7']){
  const chords=parseProgression(input).chords,required=new Set(chords.flatMap(item=>item.pcs));
  const groups=matchScales(chords);assert.equal(new Set(groups.map(group=>group.key)).size,groups.length);
  for(const group of groups)for(const candidate of group.candidates){
   assert.ok([...required].every(pc=>candidate.notes.some(note=>note.pc===pc)),input);
   assert.equal(sorted(candidate.notes.map(note=>note.pc)).join(','),group.key);
  }
 }
});

void test('repeating unchanged harmony retains its reviewed scale ordering and exact coverage',()=>{
 for(const [symbol,expected] of [
  ['Cdim7','whole-half-diminished'],['Eb7b13','mixolydian-b6'],
  ['F#m7b5','locrian-natural2'],['Baug','whole-tone'],['G7#9','half-whole-diminished'],
 ]){
  const single=matchScales([parseChord(symbol)]);
  assert.equal(single[0].candidates[0].scale.id,expected);
  for(const count of [2,4]){
   const repeated=parseProgression(Array(count).fill(symbol).join(' ')).chords;
   assert.deepEqual(matchScales(repeated),single,`${symbol}: ${count} unchanged bars`);
  }
 }
 assert.deepEqual(matchScales(parseProgression('C°7 Cdim7').chords),matchScales([parseChord('Cdim7')]));
 const changedBass=parseProgression('Cdim7 Cdim7/Db').chords;
 assert.ok(!matchScales(changedBass).flatMap(group=>group.candidates).some(candidate=>candidate.root==='C'&&candidate.scale.id==='whole-half-diminished'));
 const cadence=matchScales(parseProgression('G13 Cmaj7').chords).flatMap(group=>group.candidates).find(candidate=>candidate.root==='C'&&candidate.scale.id==='major')!;
 assert.equal(cadence.score,18);assert.ok(cadence.reason.includes('suggests C'));
});

void test('plain dominant thirteenths retain the established blues color without claiming exact coverage',()=>{
 for(const input of ['A13 D13 E13','A7 D13 E7','A9 D7 E13']){
  const chords=parseProgression(input).chords,original=chords.map(chord=>[...chord.pcs]);
  const color=colorChoices(chords,'A').find(choice=>choice.candidate.scale.id==='minor-blues');
  assert.ok(color,input);assert.equal(color.candidate.root,'A');assert.equal(color.candidate.reason,'Blues color');
  assert.deepEqual(color.candidate.notes.map(note=>note.name),['A','C','D','Eb','E','G']);
  assert.deepEqual(chords.map(chord=>chord.pcs),original,'Stylistic color must not change chord membership');
  assert.ok(chords[0].notes.some(note=>note.name==='C#'&&!color.candidate.notes.some(scaleNote=>scaleNote.pc===note.pc)),'The major third remains outside the blues palette');
  for(const group of matchScales(chords))for(const candidate of group.candidates)
   assert.ok(chords.every(chord=>chord.pcs.every(pc=>candidate.notes.some(note=>note.pc===pc))));
 }
 for(const input of ['Amaj13 D13 E13','Am13 D13 E13','A7#9 D7 E7','A13 Db13 E13'])
  assert.ok(!colorChoices(parseProgression(input).chords,'A').some(choice=>choice.candidate.scale.id==='minor-blues'),input);
});
