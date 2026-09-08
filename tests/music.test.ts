import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patterns,spell,SCALES,TUNING,pitchClass,mod} from '../lib/music.ts';
import {parseChord,parseProgression,matchScales,QUALITIES,voicings,colorChoices,diatonicChords,MAX_PROGRESSION_LENGTH,MAX_CHORD_TOKEN_LENGTH} from '../lib/harmony.ts';
const scaleNotes=(root:string,id:string)=>spell(root,SCALES.find(s=>s.id===id)!.formula);
const completeOnlyQualities=new Set(['major','minor','7','maj7','m7','5','sus2','sus4','dim','aug','6','m6','m7b5','dim7','add9','madd9']);
const requiredVoicedDegrees:Record<string,string[]>={
 '9':['3','b7','9'],maj9:['3','7','9'],m9:['b3','b7','9'],
 '11':['b7','9','11'],maj11:['7','9','11'],m11:['b3','b7','11'],
 '13':['3','b7','13'],maj13:['3','7','13'],m13:['b3','b7','13'],
 '7b9':['3','b7','b9'],'7#9':['3','b7','#9'],'7#11':['3','b7','#11'],'7b13':['3','b7','b13'],
 '9#11':['3','b7','9','#11'],'maj7#11':['3','7','#11'],'maj9#11':['3','7','9','#11'],
};
function assertVoicedPartition(root:string,quality:typeof QUALITIES[number],shape:ReturnType<typeof voicings>[number]){
 const notes=spell(root,quality.formula);
 const orderedPcs=[...new Set(shape.frets.flatMap((fret,string)=>fret===null?[]:[TUNING[string]+fret]).sort((a,b)=>a-b).map(mod))];
 assert.ok(orderedPcs.every(pc=>notes.some(note=>note.pc===pc)),`${root}${quality.id}: foreign note`);
 assert.deepEqual(shape.soundedNotes,orderedPcs.map(pc=>notes.find(note=>note.pc===pc)));
 assert.deepEqual(shape.omittedNotes,notes.filter(note=>!orderedPcs.includes(note.pc)));
 assert.equal(shape.rootless,!orderedPcs.includes(pitchClass(root)));
 if(completeOnlyQualities.has(quality.id))assert.equal(shape.omittedNotes.length,0,`${root}${quality.id}: legacy chord lost a tone`);
 for(const degree of requiredVoicedDegrees[quality.id]??[])assert.ok(shape.soundedNotes.some(note=>note.degree===degree),`${root}${quality.id}: missing required ${degree}`);
 if(quality.id==='11'||quality.id==='maj11')assert.ok(shape.omittedNotes.some(note=>note.degree==='3'),`${root}${quality.id}: natural 11 grip must disclose omitted third`);
 if(shape.omittedNotes.length)assert.equal(shape.inversion,shape.bass.degree==='1'?'Root in bass':`${shape.bass.degree} in bass`);
}
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
void test('every transposed voicing states exactly which chord tones sound and are omitted',()=>{
 for(const root of ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'])for(const quality of QUALITIES){
  const shapes=voicings(root,quality);assert.ok(shapes.length>0,root+quality.id);
  for(const shape of shapes){assertVoicedPartition(root,quality,shape);assert.ok(shape.frets.every(f=>f===null||(f>=0&&f<=24)));}
 }
});
void test('generated theoretical spellings remain usable as notes and chord roots',()=>{
 assert.equal(pitchClass('Ebbb'),1);
 assert.equal(pitchClass('F###'),8);
 assert.throws(()=>pitchClass('Ebb#'));
 const source=matchScales([parseChord('Cbbm')]).flatMap(group=>group.candidates).find(candidate=>candidate.root==='Cbb'&&candidate.scale.id==='minor')!;
 const third=diatonicChords(source.root,source.scale)[2];
 assert.deepEqual(third,{symbol:'Ebbb',root:'Ebbb',qualityId:'major'});
 assert.deepEqual(spell(third.root,['1','3','5']).map(note=>note.name),['Ebbb','Gbb','Bbbb']);
 assert.ok(voicings(third.root,QUALITIES.find(quality=>quality.id===third.qualityId)!).length>0);
 for(const root of ['C','D','E','F','G','A','B'].flatMap(letter=>['bb','b','','#','##'].map(accidental=>letter+accidental)))for(const scale of SCALES){
  for(const note of spell(root,scale.formula))assert.equal(pitchClass(note.name),note.pc);
  for(const chord of diatonicChords(root,scale))assert.ok(voicings(chord.root,QUALITIES.find(quality=>quality.id===chord.qualityId)!).length>0);
 }
});
void test('inferred match centers use readable keys while explicit spelling stays intact',()=>{
 const candidates=(text:string,home='')=>matchScales(parseProgression(text).chords,home).flatMap(group=>group.candidates);
 const cm=candidates('Cm');
 assert.deepEqual(cm.find(candidate=>candidate.root==='Eb'&&candidate.scale.id==='major')!.notes.map(note=>note.name),['Eb','F','G','Ab','Bb','C','D']);
 assert.equal(cm.some(candidate=>candidate.root==='D#'&&candidate.scale.id==='major'),false);
 for(const text of ['Gm7','F7'])assert.ok(candidates(text).some(candidate=>candidate.root==='Bb'&&candidate.scale.id==='major'));
 assert.deepEqual(candidates('D#').find(candidate=>candidate.root==='D#'&&candidate.scale.id==='major')!.notes.map(note=>note.name),['D#','E#','F##','G#','A#','B#','C##']);
 assert.ok(candidates('Cm','D#').some(candidate=>candidate.root==='D#'&&candidate.scale.id==='major'));
 assert.ok(candidates('Gb').some(candidate=>candidate.root==='Gb'&&candidate.scale.id==='major'));
});
void test('progression input is bounded without analyzing a silently truncated prefix',()=>{
 assert.equal(parseProgression('C'+' '.repeat(MAX_PROGRESSION_LENGTH-1)).chords.length,1);
 for(const input of ['C'+' '.repeat(MAX_PROGRESSION_LENGTH), 'C'.repeat(1_000_000)]){
  const result=parseProgression(input);
  assert.equal(result.chords.length,0);assert.equal(result.errors.length,1);assert.ok(result.errors[0].length<120);
 }
 assert.equal(parseProgression(Array(32).fill('Am').join(' ')).chords.length,32);
 assert.equal(parseProgression(Array(33).fill('Am').join(' ')).chords.length,0);
 assert.throws(()=>parseChord('C'+'x'.repeat(MAX_CHORD_TOKEN_LENGTH)),error=>error instanceof Error&&error.message.length<120);
 assert.throws(()=>parseChord('C'.repeat(1_000_000)),error=>error instanceof Error&&error.message.length<120);
});

void test('inferred root caching never shares mutable notes between analyses',()=>{
 const getEb=()=>matchScales([parseChord('Cm')]).flatMap(group=>group.candidates).find(candidate=>candidate.root==='Eb'&&candidate.scale.id==='major')!;
 const first=getEb();
 first.notes[0].name='corrupted';first.notes[0].pc=99;first.notes.push({name:'extra',pc:99,degree:'99'});
 const second=getEb();
 assert.deepEqual(second.notes.map(note=>note.name),['Eb','F','G','Ab','Bb','C','D']);
 assert.deepEqual(second.notes.map(note=>note.pc),[3,5,7,8,10,0,2]);
 assert.notEqual(first.notes,second.notes);assert.notEqual(first.notes[0],second.notes[0]);
});
void test('compact inversions match independently authored guitar grips',()=>{
 const cases:[string,string,(number|null)[],string,string][]=[
  ['C','major',[null,null,null,5,5,3],'C','1'],
  ['C','major',[null,null,null,9,8,8],'E','3'],
  ['C','major',[null,null,null,0,1,0],'G','5'],
  ['A','minor',[null,null,null,2,1,0],'A','1'],
  ['A','minor',[null,null,null,5,5,5],'C','b3'],
  ['A','minor',[null,null,null,9,10,8],'E','5'],
  ['C','7',[null,null,8,9,8,8],'Bb','b7'],
  ['C','maj7',[null,null,9,9,8,8],'B','7'],
  ['C','m7b5',[null,null,1,3,1,2],'Eb','b3'],
  ['C','m7b5',[null,null,4,5,4,6],'Gb','b5'],
  ['C','m7b5',[null,null,8,8,7,8],'Bb','b7'],
  ['C','dim7',[null,null,7,8,7,8],'Bbb','bb7'],
  ['D','major',[null,null,4,2,3,null],'F#','3'],
 ];
 for(const [root,qualityId,frets,bassName,bassDegree] of cases){
  const shape=voicings(root,QUALITIES.find(quality=>quality.id===qualityId)!).find(shape=>JSON.stringify(shape.frets)===JSON.stringify(frets));
  assert.ok(shape,`${root}${qualityId}: ${frets.join(',')}`);
  assert.equal(shape.family,'compact');
  assert.equal(shape.bass.name,bassName);assert.equal(shape.bass.degree,bassDegree);
  const expectedInversion=bassDegree==='1'?'Root position':['3','b3'].includes(bassDegree)?'1st inversion':['5','b5'].includes(bassDegree)?'2nd inversion':'3rd inversion';
  assert.equal(shape.inversion,expectedInversion);
 }
});
void test('expanded voicings retain exact tone partitions, bass metadata, bounds and unique grips',()=>{
 for(const root of ['C','C#','Db','D','D#','Eb','E','F','F#','Gb','G','G#','Ab','A','A#','Bb','B'])for(const quality of QUALITIES){
  const notes=spell(root,quality.formula),shapes=voicings(root,quality);
  assert.ok(shapes.length>0,root+quality.id);
  if(requiredVoicedDegrees[quality.id]){
   assert.ok(shapes.some(shape=>shape.rootless),`${root}${quality.id}: rootless option`);
   assert.ok(shapes.some(shape=>!shape.rootless),`${root}${quality.id}: rooted option`);
  }
  assert.equal(new Set(shapes.map(shape=>JSON.stringify(shape.frets))).size,shapes.length);
  for(const shape of shapes){
   assert.equal(shape.frets.length,6);
   const sounding=shape.frets.flatMap((fret,string)=>fret===null?[]:[{fret,string,midi:TUNING[string]+fret}]);
   assert.ok(sounding.every(note=>Number.isInteger(note.fret)&&note.fret>=0&&note.fret<=24));
   assertVoicedPartition(root,quality,shape);
   const bassPc=mod(Math.min(...sounding.map(note=>note.midi)));
   assert.deepEqual(shape.bass,notes.find(note=>note.pc===bassPc));
   assert.equal(shape.min,Math.min(...sounding.map(note=>note.fret)));
   assert.equal(shape.max,Math.max(...sounding.map(note=>note.fret)));
   if(shape.family==='compact'){
    assert.equal(sounding.length,shape.soundedNotes.length);
    assert.ok(sounding.length<=4);
    assert.ok(shape.max-shape.min<=4);
    assert.equal(sounding.at(-1)!.string-sounding[0].string+1,sounding.length);
    const pressed=sounding.filter(note=>note.fret>0);
    if(pressed.length)assert.ok(Math.max(...pressed.map(note=>note.fret))-Math.min(...pressed.map(note=>note.fret))<=3);
   }
  }
 }
});

void test('curated open D/F sharp names the actual bass and inversion',()=>{
 const shape=voicings('D',QUALITIES.find(quality=>quality.id==='major')!).find(shape=>JSON.stringify(shape.frets)==='[2,0,0,2,3,2]');
 assert.ok(shape);assert.equal(shape.family,'grip');
 assert.deepEqual(shape.bass,{name:'F#',pc:6,degree:'3'});
 assert.equal(shape.inversion,'1st inversion');
 assert.equal(shape.min,0);assert.equal(shape.max,3);
});
void test('bass calculation follows sounding pitch rather than string ordering',()=>{
 // A synthetic crossed-register source isolates bass arithmetic; it is not a
 // catalog grip or a recommendation for physical fingering.
 const quality={...QUALITIES.find(quality=>quality.id==='minor')!,eShape:[12,2,2,0,0,0]};
 const shape=voicings('E',quality).find(shape=>JSON.stringify(shape.frets)==='[12,2,2,0,0,0]');
 assert.ok(shape);
 assert.deepEqual(shape.bass,{name:'B',pc:11,degree:'5'});
 assert.equal(shape.inversion,'2nd inversion');
});
void test('advanced chord formulas preserve complete symbolic spelling and explicit alterations',()=>{
 const fixtures:Record<string,string>={
  C11:'C E G Bb D F',Cmaj11:'C E G B D F',Cm11:'C Eb G Bb D F',
  C13:'C E G Bb D F A',Cmaj13:'C E G B D F A',Cm13:'C Eb G Bb D F A',
  C7b9:'C E G Bb Db','C7#9':'C E G Bb D#','C7#11':'C E G Bb F#',C7b13:'C E G Bb Ab',
  'C9#11':'C E G Bb D F#','Cmaj7#11':'C E G B F#','Cmaj9#11':'C E G B D F#',
  'Fmaj7#11':'F A C E B',
 };
 for(const [symbol,expected] of Object.entries(fixtures))assert.deepEqual(parseChord(symbol).notes.map(note=>note.name),expected.split(' '));
 assert.deepEqual(parseChord('C13').pcs,[0,2,4,5,7,9,10]);
 assert.deepEqual(parseChord('C7#9').pcs,[0,3,4,7,10]);
 for(const [alias,symbol] of [['CΔ11','Cmaj11'],['CΔ13','Cmaj13'],['CM13','Cmaj13'],['Cmin11','Cm11'],['Cmin13','Cm13'],['C7(b9)','C7b9'],['C7(#9)','C7#9'],['C7(♯11)','C7#11'],['C9(#11)','C9#11'],['Cmaj9(#11)','Cmaj9#11']])assert.equal(parseChord(alias).symbol,symbol);
 for(const malformed of ['C13wat','C7b9oops','C7(#9)garbage','C7((b9))','C7(b9#9)','C13(#11)','Calt'])assert.throws(()=>parseChord(malformed));
});
void test('advanced rooted and rootless grips state their exact omissions',()=>{
 const fixtures:[string,(number|null)[],string[],string[],string][]=[
  ['C13',[null,null,2,3,3,5],['E','Bb','D','A'],['C','G','F'],'3 in bass'],
  ['G13',[null,null,3,4,5,5],['F','B','E','A'],['G','D','C'],'b7 in bass'],
  ['C13',[8,null,8,9,10,null],['C','Bb','E','A'],['G','D','F'],'Root in bass'],
  ['G13',[3,null,3,4,5,null],['G','F','B','E'],['D','A','C'],'Root in bass'],
  ['Fmaj7#11',[null,null,3,2,0,0],['F','A','B','E'],['C'],'Root in bass'],
  ['Fmaj7#11',[null,null,2,2,0,null],['E','A','B'],['F','C'],'7 in bass'],
  ['C7#9',[null,3,2,3,4,null],['C','E','Bb','D#'],['G'],'Root in bass'],
  ['C11',[null,3,3,3,3,null],['C','F','Bb','D'],['E','G'],'Root in bass'],
 ];
 for(const [symbol,frets,sounded,omitted,label] of fixtures){
  const chord=parseChord(symbol),shape=voicings(chord.root,chord.quality).find(shape=>JSON.stringify(shape.frets)===JSON.stringify(frets));
  assert.ok(shape,`${symbol}: ${JSON.stringify(frets)}`);
  assert.deepEqual(shape.soundedNotes.map(note=>note.name),sounded);
  assert.deepEqual(shape.omittedNotes.map(note=>note.name),omitted);
  assert.equal(shape.rootless,omitted.includes(chord.root));
  assert.equal(shape.inversion,label);
 }
});
void test('complete altered grips are distinguished from reduced voicings',()=>{
 for(const [symbol,frets] of [
  ['C7#11',[8,9,8,9,8,8]],
  ['Fmaj7#11',[1,2,2,2,1,1]],
  ['C9#11',[8,9,8,9,8,10]],
  ['Cmaj9#11',[8,9,9,9,8,10]],
 ] as const){
  const chord=parseChord(symbol),shape=voicings(chord.root,chord.quality).find(shape=>JSON.stringify(shape.frets)===JSON.stringify(frets));
  assert.ok(shape,`${symbol}: complete grip`);
  assert.equal(shape.omittedNotes.length,0);assert.equal(shape.rootless,false);
  assert.equal(shape.inversion,'Root position');
  assertVoicedPartition(chord.root,chord.quality,shape);
 }
});
void test('advanced voicing omissions never narrow symbolic chord matching',()=>{
 const chord=parseChord('C13'),before=chord.notes.map(note=>note.name);
 assert.ok(voicings(chord.root,chord.quality).some(shape=>shape.rootless));
 assert.deepEqual(chord.notes.map(note=>note.name),before);
 const groups=matchScales([chord]);assert.equal(groups.length,1);
 assert.equal(groups[0].key,'0,2,4,5,7,9,10');
 assert.ok(groups[0].candidates.some(candidate=>candidate.root==='C'&&candidate.scale.id==='mixolydian'));
 const cadence=matchScales(parseProgression('G13 Cmaj7').chords).flatMap(group=>group.candidates).find(candidate=>candidate.root==='C'&&candidate.scale.id==='major')!;
 assert.ok(cadence.reason.includes('suggests C'));
 assert.equal(cadence.score,18);
});
