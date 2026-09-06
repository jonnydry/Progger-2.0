'use client';
import { useMemo, useState } from 'react';
import { ArrowRight, Plus, X, Layers3 } from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { ROOTS, pretty } from '@/lib/music';
import { colorChoices, matchScales, parseProgression, perChordChoices, QUALITIES, type Candidate, type Chord, type MatchGroup } from '@/lib/harmony';

export function MatchChords({onExplore}:{onExplore:(candidate:Candidate,chords:Chord[])=>void}) {
 const [text,setText]=useState('Am F C G'),[home,setHome]=useState('');
 const [builderRoot,setBuilderRoot]=useState('D'),[builderQuality,setBuilderQuality]=useState('minor');
 const [showAll,setShowAll]=useState(false);
 const parsed=useMemo(()=>parseProgression(text),[text]);
 const groups=useMemo(()=>parsed.errors.length?[]:matchScales(parsed.chords,home),[parsed,home]);
 const colors=useMemo(()=>parsed.errors.length?[]:colorChoices(parsed.chords,home),[parsed,home]);
 const valid=parsed.errors.length===0;
 const setProgression=(value:string)=>{setText(value);setShowAll(false);};
 function renderGroup(group:MatchGroup) {
  const best=group.candidates[0];
  return <article key={group.key} className="match-card">
   <div className="match-card-top"><span className="match-badge">Contains all chord tones</span><span className="muted">{best.notes.length} notes</span></div>
   <h3>{pretty(best.root)} {best.scale.name}</h3><p>{best.reason}</p>
   <div className="match-notes">{best.notes.map(n=><span key={n.degree}>{pretty(n.name)}</span>)}</div>
   <button className="show-neck" onClick={()=>onExplore(best,parsed.chords)}>Show on neck <ArrowRight size={16}/></button>
   {group.candidates.length>1&&<details className="alternate-modes"><summary>{group.candidates.length-1} other {group.candidates.length===2?'name':'names'} for this note collection</summary><p>Same notes, different home note. Choose a name to see its roots and degrees.</p>{group.candidates.slice(1).map(c=><button key={c.root+c.scale.id} onClick={()=>onExplore(c,parsed.chords)}>{pretty(c.root)} {c.scale.name}<ArrowRight size={14}/></button>)}</details>}
  </article>;
 }
 return <div className="match-workspace">
  <section className="chord-entry" aria-labelledby="chord-entry-title"><div><span className="eyebrow">START WITH WHAT YOU KNOW</span><h2 id="chord-entry-title">What are you playing?</h2><p>Add your chords. We’ll connect the notes.</p></div>
   <label className="input-label" htmlFor="chord-progression">YOUR CHORDS</label><textarea id="chord-progression" value={text} onChange={e=>setProgression(e.target.value)} spellCheck={false} aria-invalid={!valid} aria-describedby="chord-input-help chord-errors" placeholder="Am F C G" rows={2}/><p className="input-help" id="chord-input-help">Separate chords with spaces, commas, or bars. Slash chords work too: D/F♯.</p>
   <div className="chord-tokens" aria-label="Recognized chords">{parsed.chords.map((chord,i)=><span key={i} className="chord-token">{pretty(chord.symbol)}</span>)}</div>
   <div id="chord-errors" role="status" aria-live="polite">{parsed.errors.map(error=><p className="input-error" key={error}>{error}</p>)}</div>
   <details className="chord-builder"><summary><Plus size={16}/> Build a chord by name</summary><div className="builder-row"><label>Root<NativeSelect value={builderRoot} onChange={e=>setBuilderRoot(e.target.value)}>{ROOTS.map(r=><option key={r} value={r}>{pretty(r)}</option>)}</NativeSelect></label><label>Quality<NativeSelect value={builderQuality} onChange={e=>setBuilderQuality(e.target.value)}>{QUALITIES.map(q=><option key={q.id} value={q.id}>{q.name}</option>)}</NativeSelect></label><Button onClick={()=>setProgression(`${text.trim()} ${builderRoot}${QUALITIES.find(q=>q.id===builderQuality)!.symbol}`.trim())}>Add chord <Plus size={15}/></Button></div></details>
   <div className="home-note-control"><label>HOME NOTE <span className="muted">(OPTIONAL)</span><NativeSelect value={home} onChange={e=>setHome(e.target.value)}><option value="">Not sure yet</option>{ROOTS.map(r=><option key={r} value={r}>{pretty(r)}</option>)}</NativeSelect></label><p>The note that feels like home. Leave it open if you’re exploring.</p></div>
   <div className="examples"><span>TRY A PROGRESSION</span>{[{name:'A Dorian color',value:'Am D',home:'A'},{name:'A minor with a twist',value:'Am G F E7',home:'A'},{name:'A blues changes',value:'A7 D7 E7',home:'A'}].map(example=><button key={example.name} onClick={()=>{setProgression(example.value);setHome(example.home);}}>{example.name}<ArrowRight size={14}/></button>)}<button className="clear-chords" onClick={()=>setProgression('')}>Clear chords<X size={13}/></button></div>
  </section>
  <section className="match-results" aria-labelledby="results-title"><div className="results-heading"><span className="eyebrow">FOLLOW THE NOTES</span><h2 id="results-title">Your possible palettes<span className="green-dot">.</span></h2><p>Start with a shared collection, then follow the chord tones. No single note choice is a rule.</p></div>
   {!valid?<div className="result-empty"><Layers3 size={28}/><h3>Let’s get your chords in place.</h3><p>Fix the highlighted input to see fresh results.</p></div>:<>
    <div className="result-count" role="status">{groups.length} shared note {groups.length===1?'collection':'collections'} <span>· across the 13-scale catalog</span></div>
    {groups.length>0?<div className="match-grid">{(showAll?groups:groups.slice(0,3)).map(renderGroup)}</div>:<div className="result-empty"><Layers3 size={28}/><h3>These changes need more than one palette.</h3><p>No scale in this catalog contains every chord tone across your progression. Follow the options for each chord below.</p></div>}
    {groups.length>3&&<button className="more-results" onClick={()=>setShowAll(!showAll)}>{showAll?'Show fewer collections':`Show all ${groups.length} collections`}</button>}
    <section className="per-chord-section"><h3>Follow each chord</h3><p>Useful local choices. You can stay with a shared scale when one is available.</p><div className="per-chord-grid">{parsed.chords.map((chord,i)=><article className="per-chord" key={i}><strong>{pretty(chord.symbol)}</strong><span>Landing notes: {chord.notes.map(n=>pretty(n.name)).join(' · ')}</span>{chord.bass&&<span>Bass: {pretty(chord.bass)}</span>}{perChordChoices(chord).map(c=><button key={c.scale.id} onClick={()=>onExplore(c,[chord])}>{pretty(c.root)} {c.scale.name}<ArrowRight size={13}/></button>)}{perChordChoices(chord).length===0&&<p>Use the chord tones as your starting point; no root-centered scale in this catalog covers this chord.</p>}</article>)}</div></section>
    {colors.length>0&&<section className="color-options"><h3>A little more color</h3>{colors.map(({candidate,explanation})=><article key={candidate.scale.id}><div><strong>{pretty(candidate.root)} {candidate.scale.name}</strong><p>{explanation}</p></div><button className="show-neck" onClick={()=>onExplore(candidate,parsed.chords)}>Explore <ArrowRight size={16}/></button></article>)}</section>}
    <p className="catalog-note">Catalog: seven major modes, major/minor pentatonic and blues, harmonic minor, and jazz melodic minor. Chords are treated as equal length. Tonal centers are suggestions; your melody and emphasis matter.</p>
   </>}
  </section>
 </div>;
}
