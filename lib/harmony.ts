import { mod, pitchClass, SCALES, spell, type Note, type Scale, TUNING } from './music.ts';
export type Quality = { id: string; name: string; symbol: string; formula: string[]; eShape: (number|null)[]; aShape?: (number|null)[] };
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
];
export type Chord = { original: string; root: string; quality: Quality; bass?: string; notes: Note[]; pcs: number[]; symbol: string };
export function parseChord(token: string): Chord {
 const original = token;
 const normalized = token.trim().replace(/♯/g,'#').replace(/♭/g,'b').replace(/Δ(7|9)?/g,(_,extension)=>'maj'+(extension||'7')).replace(/ø7?/g,'m7b5').replace(/°/g,'dim');
 const match = /^([A-Ga-g])((?:#{1,2}|b{1,2})?)([^/]*)(?:\/([A-Ga-g])((?:#{1,2}|b{1,2})?))?$/.exec(normalized);
 if (!match) throw new Error(`“${original}” is not a recognized chord. Try Am, G7, or D/F#.`);
 const root = match[1].toUpperCase()+match[2], suffix = match[3];
 const aliases: Record<string,string> = {maj:'major',M:'major',min:'minor',m:'minor','-':'minor','+':'aug',M7:'maj7',M9:'maj9',min7:'m7',min9:'m9','m(add9)':'madd9'};
 const quality = QUALITIES.find(q=>q.id===(aliases[suffix]??suffix) || q.symbol===suffix);
 if (!quality) throw new Error(`“${original}” has an unsupported chord quality. Use the chord builder to see supported choices.`);
 const notes = spell(root,quality.formula), bass = match[4] ? match[4].toUpperCase()+match[5] : undefined;
 const pcs = [...new Set([...notes.map(n=>n.pc),...(bass?[pitchClass(bass)]:[])])].sort((a,b)=>a-b);
 return {original,root,quality,bass,notes,pcs,symbol:root+quality.symbol+(bass?'/'+bass:'')};
}
export function parseProgression(text: string): {chords:Chord[];errors:string[]} {
 const tokens = text.trim().split(/[\s,|;–—]+/).filter(Boolean);
 if (!tokens.length) return {chords:[],errors:['Add at least one chord to find its scales.']};
 if (tokens.length > 32) return {chords:[],errors:['Try a shorter section of up to 32 chords.']};
 const chords:Chord[]=[], errors:string[]=[];
 for (const token of tokens) {try {chords.push(parseChord(token));} catch (error) {errors.push((error as Error).message);}}
 return {chords,errors};
}
export type Candidate = {root:string;scale:Scale;notes:Note[];score:number;reason:string};
export type MatchGroup = {key:string;candidates:Candidate[]};
const sharpRoots=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const flatRoots=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export function matchScales(chords:Chord[], home=''): MatchGroup[] {
 if (!chords.length) return [];
 const union=new Set(chords.flatMap(chord=>chord.pcs));
 const preferFlats=chords.some(c=>c.root.includes('b')) || home.includes('b');
 const roots=[...(preferFlats?flatRoots:sharpRoots)];
 for (const chord of chords) roots[pitchClass(chord.root)]=chord.root;
 if(home) roots[pitchClass(home)]=home;
 const groups=new Map<string,Candidate[]>();
 for (const root of roots) for (const scale of SCALES) {
   const notes=spell(root,scale.formula), pcs=new Set(notes.map(n=>n.pc));
   if (![...union].every(pc=>pcs.has(pc))) continue;
   let score=0,reason='Contains all entered chord tones. The home note is still open to interpretation.';
   const rootPc=pitchClass(root),first=chords[0],last=chords.at(-1)!;
   if (rootPc===pitchClass(first.root)) {score+=10;reason=`${first.root} is your first chord root, so this is one possible center.`;}
   if (rootPc===pitchClass(last.root)) score+=3;
   if (scale.family==='Major modes') score+=2;
   if (scale.id==='major' || scale.id==='minor') score+=1;
   if (chords.length>1) {
     const prev=chords.at(-2)!;
     if(['7','9'].includes(prev.quality.id) && mod(pitchClass(prev.root)-pitchClass(last.root))===7 && rootPc===pitchClass(last.root)) {
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
 const priority=chord.quality.formula.includes('b5') ? ['locrian','harmonic-minor'] : chord.quality.formula.includes('b3') ? ['dorian','minor','melodic-minor','harmonic-minor'] : chord.quality.formula.includes('b7') ? ['mixolydian'] : ['major','lydian'];
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
 if(chords.length>1 && chords.every(c=>['7','9'].includes(c.quality.id)&&[0,5,7].includes(mod(pitchClass(c.root)-pitchClass(center))))) {
  const scale=SCALES.find(s=>s.id==='minor-blues')!;
  results.push({candidate:{root:center,scale,notes:spell(center,scale.formula),score:0,reason:'Blues color'},explanation:'A traditional blues color over these dominant chords. The minor 3rd deliberately rubs against their major 3rds; phrase through it rather than treating every note as settled.'});
 }
 return results;
}
export function voicings(root:string,quality:Quality):{name:string;frets:(number|null)[]}[] {
 const sources=[{name:'E-shape',base:4,shape:quality.eShape},...(quality.aShape?[{name:'A-shape',base:9,shape:quality.aShape}]:[])];
 const results:{name:string;frets:(number|null)[]}[]=[];
 const pcs=new Set(spell(root,quality.formula).map(n=>n.pc));
 for(const source of sources) for(const octave of [0,12]) {
  const shift=mod(pitchClass(root)-source.base)+octave;
  const frets=source.shape.map(f=>f===null?null:f+shift);
  if(frets.some(f=>f!==null&&f>24))continue;
  const sounding=frets.flatMap((f,i)=>f===null?[]:[mod(TUNING[i]+f)]);
  if(!sounding.every(pc=>pcs.has(pc))||![...pcs].every(pc=>sounding.includes(pc)))continue;
  results.push({name:source.name,frets});
 }
 return results.sort((a,b)=>Math.max(...a.frets.map(f=>f??0))-Math.max(...b.frets.map(f=>f??0))).slice(0,3);
}
export function diatonicChords(root:string,scale:Scale):{symbol:string;root:string;qualityId:string}[] {
 const notes=spell(root,scale.formula);
 if(notes.length!==7)return [];
 return notes.map((note,index)=>{
  const offsets=[0,2,4].map(step=>mod(notes[(index+step)%7].pc-note.pc)).sort((a,b)=>a-b);
  const quality=QUALITIES.find(q=>q.formula.length===3&&spell('C',q.formula).map(n=>n.pc).sort((a,b)=>a-b).join(',')===offsets.join(','));
  return quality?{symbol:note.name+quality.symbol,root:note.name,qualityId:quality.id}:null;
 }).filter(item=>item!==null);
}
