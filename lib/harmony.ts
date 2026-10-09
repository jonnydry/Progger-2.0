import { mod, pitchClass, SCALES, spell, type Note, type Scale, TUNING } from './music.ts';
export type Quality = { id: string; name: string; symbol: string; formula: string[]; eShape?: (number|null)[]; aShape?: (number|null)[] };
export const QUALITIES: Quality[] = [
 {id:'major',name:'Major',symbol:'',formula:['1','3','5'],eShape:[0,2,2,1,0,0],aShape:[null,0,2,2,2,0]},
 {id:'minor',name:'Minor',symbol:'m',formula:['1','b3','5'],eShape:[0,2,2,0,0,0],aShape:[null,0,2,2,1,0]},
 {id:'7',name:'Dominant 7',symbol:'7',formula:['1','3','5','b7'],eShape:[0,2,0,1,0,0],aShape:[null,0,2,0,2,0]},
 {id:'maj7',name:'Major 7',symbol:'maj7',formula:['1','3','5','7'],eShape:[0,2,1,1,0,0],aShape:[null,0,2,1,2,0]},
 {id:'m7',name:'Minor 7',symbol:'m7',formula:['1','b3','5','b7'],eShape:[0,2,0,0,0,0],aShape:[null,0,2,0,1,0]},
 {id:'5',name:'Power chord',symbol:'5',formula:['1','5'],eShape:[0,2,2,null,null,null],aShape:[null,0,2,2,null,null]},
 {id:'sus2',name:'Suspended 2',symbol:'sus2',formula:['1','2','5'],eShape:[0,2,4,4,0,0],aShape:[null,0,2,2,0,0]},
 {id:'sus4',name:'Suspended 4',symbol:'sus4',formula:['1','4','5'],eShape:[0,2,2,2,0,0],aShape:[null,0,2,2,3,0]},
 {id:'dim',name:'Diminished',symbol:'dim',formula:['1','b3','b5'],eShape:[0,1,2,0,null,null]},
 {id:'aug',name:'Augmented',symbol:'aug',formula:['1','3','#5'],eShape:[0,3,2,1,1,0]},
 {id:'6',name:'Major 6',symbol:'6',formula:['1','3','5','6'],eShape:[0,2,2,1,2,0]},
 {id:'m6',name:'Minor 6',symbol:'m6',formula:['1','b3','5','6'],eShape:[0,2,2,0,2,0]},
 {id:'m7b5',name:'Half-diminished',symbol:'m7b5',formula:['1','b3','b5','b7'],eShape:[0,1,0,0,null,null]},
 {id:'dim7',name:'Diminished 7',symbol:'dim7',formula:['1','b3','b5','bb7'],eShape:[0,1,2,0,2,0]},
 {id:'add9',name:'Added 9',symbol:'add9',formula:['1','3','5','9'],eShape:[0,2,4,1,0,0]},
 {id:'madd9',name:'Minor added 9',symbol:'madd9',formula:['1','b3','5','9'],eShape:[0,2,4,0,0,0]},
 {id:'9',name:'Dominant 9',symbol:'9',formula:['1','3','5','b7','9'],eShape:[0,2,0,1,0,2]},
 {id:'maj9',name:'Major 9',symbol:'maj9',formula:['1','3','5','7','9'],eShape:[0,2,1,1,0,2]},
 {id:'m9',name:'Minor 9',symbol:'m9',formula:['1','b3','5','b7','9'],eShape:[0,2,0,0,0,2]},
 {id:'11',name:'Dominant 11',symbol:'11',formula:['1','3','5','b7','9','11']},
 {id:'maj11',name:'Major 11',symbol:'maj11',formula:['1','3','5','7','9','11']},
 {id:'m11',name:'Minor 11',symbol:'m11',formula:['1','b3','5','b7','9','11'],eShape:[0,0,0,0,0,2]},
 {id:'13',name:'Dominant 13',symbol:'13',formula:['1','3','5','b7','9','11','13']},
 {id:'maj13',name:'Major 13',symbol:'maj13',formula:['1','3','5','7','9','11','13']},
 {id:'m13',name:'Minor 13',symbol:'m13',formula:['1','b3','5','b7','9','11','13']},
 {id:'7b9',name:'Dominant 7 ♭9',symbol:'7b9',formula:['1','3','5','b7','b9'],eShape:[0,2,0,1,0,1]},
 {id:'7#9',name:'Dominant 7 ♯9',symbol:'7#9',formula:['1','3','5','b7','#9'],eShape:[0,2,0,1,0,3]},
 {id:'7#11',name:'Dominant 7 ♯11',symbol:'7#11',formula:['1','3','5','b7','#11'],eShape:[0,1,0,1,0,0]},
 {id:'7b13',name:'Dominant 7 ♭13',symbol:'7b13',formula:['1','3','5','b7','b13'],eShape:[0,2,0,1,1,0]},
 {id:'9#11',name:'Dominant 9 ♯11',symbol:'9#11',formula:['1','3','5','b7','9','#11'],eShape:[0,1,0,1,0,2]},
 {id:'maj7#11',name:'Major 7 ♯11',symbol:'maj7#11',formula:['1','3','5','7','#11'],eShape:[0,1,1,1,0,0]},
 {id:'maj9#11',name:'Major 9 ♯11',symbol:'maj9#11',formula:['1','3','5','7','9','#11'],eShape:[0,1,1,1,0,2]},
];
export const MAX_PROGRESSION_LENGTH = 2048;
export const MAX_CHORD_TOKEN_LENGTH = 32;
export type Chord = { original: string; root: string; quality: Quality; bass?: string; notes: Note[]; pcs: number[]; symbol: string };
// Spellings below name a quality that already exists. A leading hyphen, "mi",
// or "min" is minor; it is not a flat sign. Flat accidentals stay on the root.
// A later hyphen is flat only for alterations the catalog already has.
// Bare "sus" is suspended 4. "maj6" is major 6. Parenthetical b5 is half-diminished only.
function canonicalQualitySuffix(suffix: string): string {
 let text = suffix
  .replace(/^major(?=\d|\(|$)/i, 'maj')
  .replace(/^MAJ/i, 'maj')
  .replace(/^Ma(?=\d|\(|$)/, 'maj')
  .replace(/^MA(?=\d|\(|$)/, 'maj')
  .replace(/^ma(?=\d|\(|$)/, 'maj')
  .replace(/^(?:minor|min|mi|−|-)/i, 'm')
  .replace(/−/g, '-')
  .replace(/\(-((?:9|11|13))\)/g, '(b$1)');
 if (text === 'm7(b5)' || text === 'm7(-5)' || text === 'm7-5') return 'm7b5';
 if (text === '7-9') return '7b9';
 if (text === '7-13') return '7b13';
 if (text === 'm(add9)' || text === 'madd(9)') return 'madd9';
 if (text === 'maj(add9)' || text === 'M(add9)') return 'add9';
 if (text === '(add9)' || text === 'add(9)') return 'add9';
 if (text === 'sus') return 'sus4';
 if (text === 'o') return 'dim';
 if (text === 'o7') return 'dim7';
 if (text === '(#5)') return 'aug';
 text = text.replace(/^M(?=\d)/, 'maj');
 if (text === 'maj6') return '6';
 const parenthetical=/^((?:maj|min|M|m)?(?:7|9|11|13))\(([b#](?:9|11|13))\)$/.exec(text);
 if (parenthetical) text=parenthetical[1]+parenthetical[2];
 return text.replace(/^M(?=\d)/, 'maj').replace(/^min(?=\d)/, 'm');
}
export function parseChord(token: string): Chord {
 if (token.length > MAX_CHORD_TOKEN_LENGTH) throw new Error(`A chord symbol can contain up to ${MAX_CHORD_TOKEN_LENGTH} characters.`);
 const original = token;
 const normalized = token.trim().replace(/♯/g,'#').replace(/♭/g,'b').replace(/[Δ∆](13|11|9|7)?/g,(_,extension)=>'maj'+(extension||'7')).replace(/ø7?/g,'m7b5').replace(/°/g,'dim');
 const match = /^([A-Ga-g])((?:#{1,2}|b{1,2})?)([^/]*)(?:\/([A-Ga-g])((?:#{1,2}|b{1,2})?))?$/.exec(normalized);
 if (!match) throw new Error(`“${original}” is not a recognized chord. Try Am, G7, or D/F#.`);
 const root = match[1].toUpperCase()+match[2];
 const suffix = canonicalQualitySuffix(match[3]);
 const aliases: Record<string,string> = {maj:'major',M:'major',min:'minor',m:'minor','+':'aug',M7:'maj7',M9:'maj9',min7:'m7',min9:'m9'};
 const quality = QUALITIES.find(q=>q.id===(aliases[suffix]??suffix) || q.symbol===suffix);
 if (!quality) throw new Error(`“${original}” has an unsupported chord quality. Use the chord builder to see supported choices.`);
 const notes = spell(root,quality.formula), bass = match[4] ? match[4].toUpperCase()+match[5] : undefined;
 const pcs = [...new Set([...notes.map(n=>n.pc),...(bass?[pitchClass(bass)]:[])])].sort((a,b)=>a-b);
 return {original,root,quality,bass,notes,pcs,symbol:root+quality.symbol+(bass?'/'+bass:'')};
}
export function parseProgression(text: string): {chords:Chord[];errors:string[]} {
 if (text.length > MAX_PROGRESSION_LENGTH) return {chords:[],errors:[`Try a shorter progression of up to ${MAX_PROGRESSION_LENGTH} characters.`]};
 const tokens = text.trim().split(/[\s,|;–—]+/).filter(Boolean);
 if (!tokens.length) return {chords:[],errors:['Add at least one chord to find its scales.']};
 if (tokens.length > 32) return {chords:[],errors:['Try a shorter section of up to 32 chords.']};
 const chords:Chord[]=[], errors:string[]=[];
 for (const token of tokens) {try {chords.push(parseChord(token));} catch (error) {errors.push((error as Error).message);}}
 return {chords,errors};
}
export type Candidate = {root:string;scale:Scale;notes:Note[];score:number;reason:string};
export type MatchGroup = {key:string;candidates:Candidate[]};
const inferredRoots = Array.from({length:12},(_,pc)=>
 ['C','D','E','F','G','A','B'].flatMap(letter => [letter, letter + '#', letter + 'b']).filter(root=>pitchClass(root)===pc));
// Only canonical catalog scales enter this cache: at most 12 × 2 roots per scale.
// Cache strings, never mutable note arrays returned to consumers.
const inferredRootCache = new Map<Scale,Map<number,string>>();
function inferSpelling(pc:number, scale:Scale, preferFlats:boolean): {root:string;notes:Note[]} {
 const cacheKey = pc * 2 + Number(preferFlats);
 let cache = inferredRootCache.get(scale);
 const cachedRoot = cache?.get(cacheKey);
 if (cachedRoot) return {root:cachedRoot,notes:spell(cachedRoot,scale.formula)};
 const choices = inferredRoots[pc].map(root => {
  const notes = spell(root, scale.formula);
  const accidentalCounts = notes.map(note => note.name.length - 1);
  // Avoid multiple accidentals first, then minimize the written key complexity.
  // Natural root names win ties; the entered chord spelling breaks remaining ties.
  const cost = Math.max(...accidentalCounts) * 1000 + accidentalCounts.reduce((a,b)=>a+b,0) * 10 + (root.length - 1) * 2 + (root.includes(preferFlats ? '#' : 'b') ? 1 : 0);
  return {root,notes,cost};
 });
 const chosen = choices.sort((a,b)=>a.cost-b.cost)[0];
 if (!cache) {cache = new Map();inferredRootCache.set(scale,cache);}
 cache.set(cacheKey,chosen.root);
 return {root:chosen.root,notes:chosen.notes};
}
const targetedScales:Record<string,string[]>={
  '7#9':['half-whole-diminished'],
  '7b9':['phrygian-dominant','half-whole-diminished'],
  '7#11':['lydian-dominant','half-whole-diminished'],
  '9#11':['lydian-dominant'],
  '7b13':['mixolydian-b6','phrygian-dominant'],
  dim7:['whole-half-diminished','ultralocrian'],
  m7b5:['locrian-natural2','locrian','locrian-natural6'],
  aug:['whole-tone','lydian-augmented','ionian-augmented'],
 };
export function matchScales(chords:Chord[], home=''): MatchGroup[] {
 if (!chords.length) return [];
 const first=chords[0],last=chords.at(-1)!;
 const firstRoot=pitchClass(first.root),firstPcs=new Set(first.pcs);
 // Inverting a chord or spelling its root explicitly as a slash bass does not
 // introduce a new scale choice. A non-chord bass can change the pitch set.
 const oneHarmony=chords.every(chord=>pitchClass(chord.root)===firstRoot && chord.quality.id===first.quality.id && chord.pcs.length===firstPcs.size && chord.pcs.every(pc=>firstPcs.has(pc)));
 const union=new Set(chords.flatMap(chord=>chord.pcs));
 const preferFlats=chords.some(c=>c.notes.some(note=>note.name.includes('b'))) || home.includes('b');
 const explicitRoots=new Map<number,string>();
 for (const chord of chords) explicitRoots.set(pitchClass(chord.root),chord.root);
 if(home) explicitRoots.set(pitchClass(home),home);
 const groups=new Map<string,Candidate[]>();
 for (let pc = 0; pc < 12; pc++) for (const scale of SCALES) {
   const explicitRoot = explicitRoots.get(pc);
   const {root,notes} = explicitRoot ? {root:explicitRoot,notes:spell(explicitRoot,scale.formula)} : inferSpelling(pc,scale,preferFlats);
   const pcs=new Set(notes.map(n=>n.pc));
   if (![...union].every(pc=>pcs.has(pc))) continue;
   let score=0,reason='Contains all entered chord tones. The home note is still open to interpretation.';
   const rootPc=pitchClass(root);
   if (rootPc===pitchClass(first.root)) {score+=10;reason=`${first.root} is your first chord root, so this is one possible center.`;}
   if (rootPc===pitchClass(last.root)) score+=3;
   if (scale.family==='Major modes') score+=2;
   if (scale.id==='major' || scale.id==='minor') score+=1;
   if (oneHarmony && rootPc===firstRoot) {
     const preference=targetedScales[first.quality.id]?.indexOf(scale.id) ?? -1;
     // Keep the explicit chord-scale ordering ahead of the generic +2
     // major-family preference, consistently with the per-chord list.
     if(preference>=0) score+=12-preference*3;
     reason=`Contains all chord tones, with ${root} as the reference root. Melody and phrasing still shape the sound.`;
   }
   if (chords.length>1) {
     const prev=chords.at(-2)!;
     if(prev.quality.formula.includes('3') && prev.quality.formula.includes('b7') && mod(pitchClass(prev.root)-pitchClass(last.root))===7 && rootPc===pitchClass(last.root)) {
       score+=12; reason=`${prev.symbol} → ${last.symbol} suggests ${last.root} as a home note; the melody can refine that reading.`;
     }
   }
   if(home) {
     if(rootPc===pitchClass(home)){score+=100;reason=`You chose ${home} as your home note. This collection contains all chord tones.`;}
     else reason=`This collection contains all chord tones, with ${root} as an alternative center to your chosen ${home}.`;
   }
   const key=[...pcs].sort((a,b)=>a-b).join(',');
   const candidate={root,scale,notes,score,reason};
   groups.set(key,[...(groups.get(key)??[]),candidate]);
 }
 return [...groups].map(([key,candidates])=>({key,candidates:candidates.sort((a,b)=>b.score-a.score)})).sort((a,b)=>b.candidates[0].score-a.candidates[0].score);
}
export function perChordChoices(chord:Chord):Candidate[] {

 const priority=targetedScales[chord.quality.id] ?? (chord.quality.formula.includes('b5') ? ['locrian','locrian-natural2'] : chord.quality.formula.includes('b3') ? ['dorian','minor','melodic-minor','harmonic-minor'] : chord.quality.formula.includes('b7') ? ['mixolydian','lydian-dominant'] : ['major','lydian']);
 const all=matchScales([chord]).flatMap(group=>group.candidates).filter(c=>pitchClass(c.root)===pitchClass(chord.root));
 return all.sort((a,b)=>(priority.indexOf(a.scale.id)<0?99:priority.indexOf(a.scale.id))-(priority.indexOf(b.scale.id)<0?99:priority.indexOf(b.scale.id))).slice(0,3);
}
export function colorChoices(chords:Chord[], home=''): {candidate:Candidate;explanation:string}[] {
 const groups=matchScales(chords,home), results:{candidate:Candidate;explanation:string}[]=[];
 const center=home||chords[0]?.root;
 if(!center) return [];
 for(const scaleId of ['major','minor']) {
  const source=groups.flatMap(g=>g.candidates).find(c=>c.scale.id===scaleId&&pitchClass(c.root)===pitchClass(center));
  if(source){const scale=SCALES.find(s=>s.id===`${scaleId}-pentatonic`)!;results.push({candidate:{...source,scale,notes:spell(source.root,scale.formula)},explanation:'A simpler five-note palette within this shared collection. It omits some chord tones; use the chord-tone view to find landing notes.'});}
 }
 if(chords.length>1 && chords.every(c=>['7','9','13'].includes(c.quality.id)&&[0,5,7].includes(mod(pitchClass(c.root)-pitchClass(center))))) {
  const scale=SCALES.find(s=>s.id==='minor-blues')!;
  results.push({candidate:{root:center,scale,notes:spell(center,scale.formula),score:0,reason:'Blues color'},explanation:'A traditional blues color over these dominant chords. The minor 3rd deliberately rubs against their major 3rds; phrase through it rather than treating every note as settled.'});
 }
 return results;
}
export type Voicing = {
 name:string;
 frets:(number|null)[];
 bass:Note;
 inversion:string;
 family:'grip'|'compact';
 soundedNotes:Note[];
 omittedNotes:Note[];
 rootless:boolean;
 min:number;
 max:number;
};
// These complete common shapes remain playable when every sounding fret is
// transposed together. The open D/F# grip is deliberately kept at its home key.
const additionalGrips:{qualityId:string;name:string;base:number;frets:(number|null)[];movable?:boolean}[] = [
 {qualityId:'major',name:'C-shape',base:0,frets:[null,3,2,0,1,0],movable:true},
 {qualityId:'major',name:'D-shape',base:2,frets:[null,null,0,2,3,2],movable:true},
 {qualityId:'major',name:'G-shape',base:7,frets:[3,2,0,0,0,3],movable:true},
 {qualityId:'major',name:'Open D/F♯',base:2,frets:[2,0,0,2,3,2]},
 {qualityId:'minor',name:'D-shape',base:2,frets:[null,null,0,2,3,1],movable:true},
 {qualityId:'maj7',name:'C-shape',base:0,frets:[null,3,2,0,0,0],movable:true},
 {qualityId:'7',name:'G-shape',base:7,frets:[3,2,0,0,0,1],movable:true},
 {qualityId:'7',name:'D-shape',base:2,frets:[null,null,0,2,1,2],movable:true},
 {qualityId:'m7',name:'D-shape',base:2,frets:[null,null,0,2,1,1],movable:true},
 {qualityId:'add9',name:'C-shape',base:0,frets:[null,3,2,0,3,0],movable:true},
 {qualityId:'add9',name:'G-shape',base:7,frets:[3,0,0,0,0,3],movable:true},
];
function inversionLabel(bass:Note, formula:string[]):string {
 if (bass.degree==='1') return 'Root position';
 const third=formula.find(degree=>/^[b#]*3$/.test(degree));
 const fifth=formula.find(degree=>/^[b#]*5$/.test(degree));
 const seventh=formula.find(degree=>/^[b#]*7$/.test(degree));
 const triad=formula.length===3 && third && fifth;
 const seventhChord=formula.length===4 && third && fifth && seventh;
 if (triad || seventhChord) {
  if (bass.degree===third) return '1st inversion';
  if (bass.degree===fifth) return '2nd inversion';
  if (seventhChord && bass.degree===seventh) return '3rd inversion';
 }
 return `${bass.degree} in bass`;
}
/** Deliberate jazz subsets; all omitted notes remain in the symbolic chord. */
function reducedVoicingRecipes(quality:Quality):string[][] {
 const third=quality.formula.find(degree=>/^[b#]*3$/.test(degree));
 const seventh=quality.formula.find(degree=>/^[b#]*7$/.test(degree));
 const extensions=quality.formula.filter(degree=>Number(degree.replace(/^[b#]+/,''))>=9);
 if (!third || !seventh || !extensions.length) return [];
 // Both explicitly named colors survive in 9#11. Complete six-string E-shapes
 // supply the rooted option; this four-note recipe is deliberately rootless.
 if (quality.id==='9#11' || quality.id==='maj9#11') return [[third,seventh,'9','#11']];
 // Natural 11 against a major third is commonly voiced without that third.
 // Preserve 9 and 11, and report the third among the explicit omissions.
 if (quality.id==='11' || quality.id==='maj11')
  return [['1',seventh,'9','11'],[seventh,'9','11'],[seventh,'5','9','11']];
 const highest=Math.max(...extensions.map(degree=>Number(degree.replace(/^[b#]+/,''))));
 const tensions=extensions.filter(degree=>Number(degree.replace(/^[b#]+/,''))===highest);
 const base=[third,seventh,...tensions];
 const recipes=[['1',...base],base];
 const extra=['9','5'].find(degree=>quality.formula.includes(degree)&&!base.includes(degree));
 if (extra && base.length===3) recipes.push([...base,extra]);
 return recipes;
}
export function voicings(root:string,quality:Quality):Voicing[] {
 const notes=spell(root,quality.formula),pcs=new Set(notes.map(note=>note.pc));
 const rootPc=pitchClass(root),results:Voicing[]=[],seen=new Set<string>();
 const add=(name:string,frets:(number|null)[],family:Voicing['family'],requiredPcs:ReadonlySet<number>=pcs)=>{
  if (frets.length!==6 || frets.some(fret=>fret!==null&&(!Number.isInteger(fret)||fret<0||fret>24))) return;
  const sounding=frets.flatMap((fret,string)=>fret===null?[]:[{fret,midi:TUNING[string]+fret}]);
  if (!sounding.length) return;
  const soundingPcs=new Set(sounding.map(note=>mod(note.midi)));
  if (soundingPcs.size!==requiredPcs.size || ![...requiredPcs].every(pc=>soundingPcs.has(pc)) || [...soundingPcs].some(pc=>!pcs.has(pc))) return;
  const key=frets.map(fret=>fret===null?'x':fret).join(',');
  if (seen.has(key)) return;
  const bassPc=mod(Math.min(...sounding.map(note=>note.midi)));
  const bass={...notes.find(note=>note.pc===bassPc)!};
  seen.add(key);
  const soundedNotes=[...new Set([...sounding].sort((a,b)=>a.midi-b.midi).map(note=>mod(note.midi)))].map(pc=>({...notes.find(note=>note.pc===pc)!}));
  const omittedNotes=notes.filter(note=>!soundingPcs.has(note.pc)).map(note=>({...note}));
  const rootless=!soundingPcs.has(rootPc);
  const inversion=omittedNotes.length ? (bass.degree==='1'?'Root in bass':`${bass.degree} in bass`) : inversionLabel(bass,quality.formula);
  results.push({name,frets:[...frets],bass,inversion,family,soundedNotes,omittedNotes,rootless,
   min:Math.min(...sounding.map(note=>note.fret)),max:Math.max(...sounding.map(note=>note.fret))});
 };
 const sources=[
  ...(quality.eShape?[{name:'E-shape',base:4,frets:quality.eShape,movable:true}]:[]),
  ...(quality.aShape?[{name:'A-shape',base:9,frets:quality.aShape,movable:true}]:[]),
  ...additionalGrips.filter(grip=>grip.qualityId===quality.id),
 ];
 for (const source of sources) {
  if (!source.movable) {
   if (rootPc===source.base) add(source.name,source.frets,'grip');
   continue;
  }
  for (let shift=mod(rootPc-source.base);shift<=24;shift+=12)
   add(source.name,source.frets.map(fret=>fret===null?null:fret+shift),'grip');
 }
 // Rooted thirteenth grips retain the guide tones and named extension while
 // intentionally omitting the fifth, ninth and eleventh from the full symbol.
 const thirteenthGrips:Record<string,{frets:(number|null)[];degrees:string[]}>= {
  '13':{frets:[0,null,0,1,2,null],degrees:['1','3','b7','13']},
  'maj13':{frets:[0,null,1,1,2,null],degrees:['1','3','7','13']},
  'm13':{frets:[0,null,0,0,2,null],degrees:['1','b3','b7','13']},
 };
 const thirteenth=thirteenthGrips[quality.id];
 if (thirteenth) {
  const requiredPcs=new Set(notes.filter(note=>thirteenth.degrees.includes(note.degree)).map(note=>note.pc));
  for(let shift=mod(rootPc-4);shift<=24;shift+=12)
   add(`E-shape · ${quality.symbol}`,thirteenth.frets.map(fret=>fret===null?null:fret+shift),'grip',requiredPcs);
 }
 const toneSets:Set<number>[]=[];
 if (pcs.size>=2 && pcs.size<=4) toneSets.push(pcs);
 for (const degrees of reducedVoicingRecipes(quality))
  toneSets.push(new Set(notes.filter(note=>degrees.includes(note.degree)).map(note=>note.pc)));
 const visitedSets=new Set<string>();
 // Every compact shape contains its recipe exactly once on contiguous strings.
 // A recipe never changes the chord's full symbolic formula or matching input.
 // At most five fret choices per string keep the 2–4-string search bounded.
 for (const requiredPcs of toneSets) {
  const signature=[...requiredPcs].sort((a,b)=>a-b).join(',');
  if (visitedSets.has(signature)) continue;
  visitedSets.add(signature);
  const count=requiredPcs.size,stringNames=['E','A','D','G','B','e'];
  if (count<2 || count>4) continue;
  const incomplete=count<pcs.size;
  for (let firstString=0;firstString<=6-count;firstString++) for (let start=0;start<=24;start++) {
   const end=Math.min(24,start===0?4:start+3);
   const choices=Array.from({length:count},(_,offset)=>
    Array.from({length:end-start+1},(_,i)=>start+i).filter(fret=>requiredPcs.has(mod(TUNING[firstString+offset]+fret))));
   if (choices.some(choice=>!choice.length)) continue;
   const frets:(number|null)[]=Array(6).fill(null),used=new Set<number>();
   const visit=(offset:number)=>{
    if (offset===count) {
     const sounding=frets.filter((fret):fret is number=>fret!==null),pressed=sounding.filter(fret=>fret>0);
     if (Math.max(...sounding)-Math.min(...sounding)>4 || (pressed.length&&Math.max(...pressed)-Math.min(...pressed)>3)) return;
     const label=incomplete ? `${count}-note` : count===2?'Dyad':count===3?'Triad':'Four-note';
     add(`${label} · ${stringNames.slice(firstString,firstString+count).join('–')} strings`,frets,'compact',requiredPcs);
     return;
    }
    const string=firstString+offset;
    for (const fret of choices[offset]) {
     const pc=mod(TUNING[string]+fret);
     if (used.has(pc)) continue;
     used.add(pc);frets[string]=fret;
     visit(offset+1);
     used.delete(pc);frets[string]=null;
    }
   };
   visit(0);
  }
 }
 return results.sort((a,b)=>
  Number(a.rootless)-Number(b.rootless) ||
  (a.family==='grip'?0:1)-(b.family==='grip'?0:1) ||
  Number(a.bass.degree!=='1')-Number(b.bass.degree!=='1') ||
  a.min-b.min || a.max-b.max || a.frets.map(f=>f??-1).join(',').localeCompare(b.frets.map(f=>f??-1).join(',')));
}
export function diatonicChords(root:string,scale:Scale):{symbol:string;root:string;qualityId:string}[] {
 const notes=spell(root,scale.formula);
 // Third-stacking requires seven successive letter degrees. Functional
 // dominant spellings (Altered) and symmetric collections do not have them.
 if(notes.length!==7 || scale.harmonize===false)return [];
 return notes.map((note,index)=>{
  const offsets=[0,2,4].map(step=>mod(notes[(index+step)%7].pc-note.pc)).sort((a,b)=>a-b);
  const quality=QUALITIES.find(q=>q.formula.length===3&&spell('C',q.formula).map(n=>n.pc).sort((a,b)=>a-b).join(',')===offsets.join(','));
  return quality?{symbol:note.name+quality.symbol,root:note.name,qualityId:quality.id}:null;
 }).filter(item=>item!==null);
}
