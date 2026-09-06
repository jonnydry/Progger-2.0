import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patterns,spell,SCALES,TUNING,pitchClass,mod} from '../lib/music.ts';
import {parseChord,parseProgression,matchScales,QUALITIES,voicings,colorChoices} from '../lib/harmony.ts';
const scaleNotes=(root:string,id:string)=>spell(root,SCALES.find(s=>s.id===id)!.formula);
void test('authored spelling fixtures preserve theoretical interval names',()=>{
 for(const [root,id,names] of [
  ['F#','major','F# G# A# B C# D# E#'],['Gb','major','Gb Ab Bb Cb Db Eb F'],
  ['A','dorian','A B C D E F# G'],['A','harmonic-minor','A B C D E F G#'],
  ['A','melodic-minor','A B C D E F# G#'],['C','major-blues','C D Eb E G A'],
  ['C','minor-blues','C Eb F Gb G Bb'],
 ])assert.deepEqual(scaleNotes(root,id).map(n=>n.name),names.split(' '));
 assert.deepEqual(parseChord('Cdim7').notes.map(n=>n.name),['C','Eb','Gb','Bbb']);
 assert.throws(()=>spell('C',['0']));assert.throws(()=>pitchClass('C#b'));
});
void test('independent complete 3NPS and pentatonic box grids',()=>{
 for(const [root,id,start,grid] of [
  ['C','major',8,[[8,10,12],[8,10,12],[9,10,12],[9,10,12],[10,12,13],[10,12,13]]],
  ['A','dorian',5,[[5,7,8],[5,7,9],[5,7,9],[5,7,9],[7,8,10],[7,8,10]]],
  ['C','major',19,[[19,20,22],[19,20,22],[19,21,22],[19,21,22],[20,22,24],[20,22,24]]],
  ['A','minor-pentatonic',5,[[5,8],[5,7],[5,7],[5,7],[5,8],[5,8]]],
 ] as const){const p=patterns(scaleNotes(root,id)).find(p=>p.start===start)!;assert.ok(p);assert.deepEqual(TUNING.map((_,s)=>p.positions.filter(p=>p.string===s).map(p=>p.fret)),grid);}
 assert.equal(patterns(scaleNotes('C','major')).some(p=>p.start===20),false);
 assert.deepEqual(patterns(scaleNotes('C','major')).map(p=>p.start),[0,1,3,5,7,8,10,12,13,15,17,19]);
});
void test('every root and pattern respects tuning, pitch membership, scalar continuity and bounds',()=>{
 for(const root of ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'])for(const scale of SCALES){
 const notes=spell(root,scale.formula),pcs=new Set(notes.map(n=>n.pc));
 for(const p of patterns(notes)){
  assert.equal(p.positions.length,notes.length===5?12:18);
  assert.ok(p.max-p.min<=6);
  for(const [i,pos] of p.positions.entries()){
   assert.ok(pos.fret>=0&&pos.fret<=24);assert.equal(pos.midi,TUNING[pos.string]+pos.fret);assert.ok(pcs.has(mod(pos.midi)));
   if(i){const prev=p.positions[i-1].midi;assert.ok(pos.midi>prev);for(let gap=prev+1;gap<pos.midi;gap++)assert.equal(pcs.has(mod(gap)),false);}
  }
 }
 for(const open of TUNING)assert.equal(mod(open+24),mod(open));
 }
});
void test('chord parsing distinguishes qualities, extensions, slash basses, and invalid tokens',()=>{
 assert.deepEqual(parseChord('C7').pcs,[0,4,7,10]);assert.deepEqual(parseChord('Cmaj7').pcs,[0,4,7,11]);
 assert.deepEqual(parseChord('C9').pcs,[0,2,4,7,10]);assert.deepEqual(parseChord('Cadd9').pcs,[0,2,4,7]);
 assert.deepEqual(parseChord('D/F♯').pcs,[2,6,9]);assert.deepEqual(parseChord('C/F').pcs,[0,4,5,7]);
 assert.equal(parseChord('B♭m7').symbol,'Bbm7');
 assert.deepEqual(parseChord('CΔ').pcs,[0,4,7,11]);assert.deepEqual(parseChord('CΔ9').pcs,[0,2,4,7,11]);
 assert.equal(parseChord('F##m').root,'F##');
 for(const invalid of ['Cfoo','Cmmajbanana','C/G7','H','C//E','C#b'])assert.throws(()=>parseChord(invalid));
 assert.equal(parseProgression('Am | F, C – G').chords.length,4);
 assert.ok(parseProgression('Cwat').errors.length);assert.ok(parseProgression('').errors.length);
});
void test('matching validates independent unions and retains musical ambiguity',()=>{
 const cases:[string,number[]][]=[['C F G',[0,2,4,5,7,9,11]],['Am D',[0,2,4,6,9]],['Am F E7',[0,2,4,5,8,9,11]],['Am G F E7',[0,2,4,5,7,8,9,11]],['A7 D7 E7',[0,1,2,4,6,7,8,9,11]]];
 for(const [input,pcs] of cases){const {chords,errors}=parseProgression(input);assert.equal(errors.length,0);assert.deepEqual([...new Set(chords.flatMap(c=>c.pcs))].sort((a,b)=>a-b),pcs);for(const group of matchScales(chords))for(const candidate of group.candidates)assert.ok(pcs.every(pc=>candidate.notes.some(n=>n.pc===pc)));}
 const cf=matchScales(parseProgression('C F G').chords);assert.equal(cf.length,1);assert.equal(cf[0].candidates.length,7);
 const ad=matchScales(parseProgression('Am D').chords,'A').flatMap(g=>g.candidates);
 assert.ok(ad.some(c=>c.root==='A'&&c.scale.id==='dorian'));assert.ok(ad.some(c=>c.root==='A'&&c.scale.id==='melodic-minor'));
 assert.ok(matchScales(parseProgression('Am F E7').chords).some(g=>g.candidates.some(c=>c.root==='A'&&c.scale.id==='harmonic-minor')));
 assert.equal(matchScales(parseProgression('Am G F E7').chords).length,0);
 assert.equal(matchScales(parseProgression('A7 D7 E7').chords).length,0);
 assert.ok(colorChoices(parseProgression('A7 D7 E7').chords,'A').some(c=>c.candidate.scale.id==='minor-blues'));
});
void test('every transposed voicing includes exactly its stated chord tones',()=>{
 for(const root of ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'])for(const quality of QUALITIES){
  const shapes=voicings(root,quality);assert.ok(shapes.length>0,root+quality.id);
  const expected=[...new Set(spell(root,quality.formula).map(n=>n.pc))].sort((a,b)=>a-b);
  for(const shape of shapes){const pcs=[...new Set(shape.frets.flatMap((f,i)=>f===null?[]:[mod(TUNING[i]+f)]))].sort((a,b)=>a-b);assert.deepEqual(pcs,expected);assert.ok(shape.frets.every(f=>f===null||(f>=0&&f<=24)));}
 }
});
