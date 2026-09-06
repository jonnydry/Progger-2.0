'use client';
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import Image from 'next/image';
import { ArrowLeft, ArrowUpRight, Compass, Guitar, Layers3, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Fretboard } from '@/components/fretboard';
import { MatchChords } from '@/components/match-chords';
import { VoicingDiagram } from '@/components/voicing-diagram';
import { SCALES, ROOTS, patterns, pretty, spell } from '@/lib/music';
import { diatonicChords, QUALITIES, voicings, type Chord, type Candidate } from '@/lib/harmony';

export default function Home() {
  const [page,setPage]=useState('explore'),[kind,setKind]=useState('scales');
  const [scaleRoot,setScaleRoot]=useState('C'),[chordRoot,setChordRoot]=useState('C');
  const root=kind==='scales'?scaleRoot:chordRoot;
  const setRoot=kind==='scales'?setScaleRoot:setChordRoot;
  const [scaleId, setScaleId] = useState('major'),[qualityId,setQualityId]=useState('major');
  const [view, setView] = useState<'map'|'pattern'>('map');
  const [degrees, setDegrees] = useState(false), [left, setLeft] = useState(false), [position, setPosition] = useState(0);
  const [context,setContext]=useState<Chord[]>([]),[activeChord,setActiveChord]=useState(0);
  const scale = SCALES.find(s => s.id === scaleId)!;
  const quality=QUALITIES.find(q=>q.id===qualityId)!;
  const formula=kind==='scales'?scale.formula:quality.formula;
  const title=kind==='scales'?scale.name:quality.name;
  const notes = useMemo(()=>spell(root,formula),[root,formula]);
  const shapes = useMemo(()=>kind==='scales'?patterns(notes):[],[notes,kind]);
  const shape = view === 'pattern' ? shapes[Math.min(position,shapes.length-1)] : undefined;
  const related=useMemo(()=>diatonicChords(root,scale),[root,scale]);
  const chordVoicings=useMemo(()=>voicings(root,quality),[root,quality]);
  useEffect(()=>{
    const sync=()=>setPage(location.hash==='#match'?'match':'explore');
    sync();window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);
  },[]);
  useEffect(()=>{
    const registry=(document as Document & {modelContext?: {registerTool:(tool:unknown,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!registry?.registerTool)return;
    const lifecycle=new AbortController();
    const tool={name:'explore_scale',title:'Explore a guitar scale',description:'Choose a root and scale in Progger, show its notes on the guitar neck, and return the scale formula.',inputSchema:{type:'object',properties:{root:{type:'string',enum:ROOTS},scaleId:{type:'string',enum:SCALES.map(s=>s.id)}},required:['root','scaleId'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input:unknown){
      if(!input||typeof input!=='object')throw new Error('Expected root and scaleId.');
      const value=input as Record<string,unknown>;
      if(Object.keys(value).some(key=>!['root','scaleId'].includes(key))||typeof value.root!=='string'||!ROOTS.includes(value.root))throw new Error('Choose a supported root.');
      const selected=SCALES.find(s=>s.id===value.scaleId);if(!selected)throw new Error('Choose a supported scaleId.');
      const chosenRoot=value.root;
      flushSync(()=>{setScaleRoot(chosenRoot);setScaleId(selected.id);setKind('scales');setPage('explore');setView('map');setPosition(0);setContext([]);});location.hash='explore';
      return {root:chosenRoot,scale:selected.name,notes:spell(chosenRoot,selected.formula).map(n=>n.name),formula:selected.formula};
    }};
    try{void Promise.resolve(registry.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* A missing optional browser capability must not block the reference. */}
    return()=>lifecycle.abort();
  },[]);
  function choose(rootValue: string, id: string) { setRoot(rootValue); setScaleId(id); setPosition(0);setContext([]);if(![5,7].includes(SCALES.find(s=>s.id===id)!.formula.length))setView('map'); }
  function navigate(destination:string){setPage(destination);location.hash=destination;}
  function openMatch(candidate:Candidate,chords:Chord[]){setScaleRoot(candidate.root);setScaleId(candidate.scale.id);setKind('scales');setPosition(0);setView('map');setContext(chords);setActiveChord(0);navigate('explore');document.getElementById('main-content')?.focus();}
  function openChord(chordRoot:string,id:string){setChordRoot(chordRoot);setQualityId(id);setKind('chords');setView('map');setContext([]);}
  return <div className="app-shell">
    <header className="site-header"><a href="#explore" onClick={()=>navigate('explore')} className="brand" aria-label="Progger home"><Image unoptimized src="/progger-mascot.png" alt="" width={64} height={64}/><span>PROGGER<span className="brand-dot">.</span></span></a><nav aria-label="Main navigation"><a href="#explore" aria-current={page==='explore'?'page':undefined} onClick={()=>setPage('explore')} className={`nav-item ${page==='explore'?'active':''}`}><Compass size={18}/> Explore</a><a href="#match" aria-current={page==='match'?'page':undefined} onClick={()=>setPage('match')} className={`nav-item ${page==='match'?'active':''}`}><Layers3 size={17}/> Match chords</a></nav><span className="header-note"><span className="status-dot"/> Find your next note.</span></header>
    <main id="main-content" tabIndex={-1}>
      <div className="workspace-heading"><div><div className="eyebrow">YOUR FRETBOARD FIELD GUIDE</div><h1>{page==='match'?'From chords to possibilities':kind==='scales'?'Scales & modes':'Chord reference'}<span className="green-dot">.</span></h1></div><div className="instrument-badge"><Guitar size={17}/> 6 strings <span>·</span> 24 frets</div></div>
      <div hidden={page!=='match'}><MatchChords onExplore={openMatch}/></div>
      <div hidden={page!=='explore'}>
      {context.length>0&&<div className="context-banner"><button onClick={()=>navigate('match')}><ArrowLeft size={15}/> Back to your chords</button><span>Palette for {context.map(c=>pretty(c.symbol)).join(' → ')}</span><button onClick={()=>setContext([])}>Clear context</button></div>}
      <section className="explorer-panel" aria-label="Guitar reference explorer">
        <div className="reference-tabs" role="group" aria-label="Reference type"><button aria-pressed={kind==='scales'} onClick={()=>{setKind('scales');setView('map');}}>Scales & modes</button><button aria-pressed={kind==='chords'} onClick={()=>{setKind('chords');setView('map');setContext([]);}}>Chords</button><span>{kind==='scales'?'13 scales & modes · every root':'19 chord qualities · every root'}</span></div>
        <div className="selection-bar"><label>ROOT NOTE<NativeSelect value={root} onChange={e=>choose(e.target.value,scaleId)}>{(!ROOTS.includes(root)?[root,...ROOTS]:ROOTS).map(r=><option value={r} key={r}>{pretty(r)}</option>)}</NativeSelect></label><label className="scale-select">{kind==='scales'?'SCALE / MODE':'CHORD QUALITY'}<NativeSelect value={kind==='scales'?scaleId:qualityId} onChange={e=>{if(kind==='scales')choose(root,e.target.value);else {setQualityId(e.target.value);setContext([]);}}}>{kind==='scales'?['Major modes','Pentatonic & blues','Minor families'].map(family=><optgroup label={family} key={family}>{SCALES.filter(s=>s.family===family).map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</optgroup>):QUALITIES.map(q=><option key={q.id} value={q.id}>{q.name}</option>)}</NativeSelect></label><div className="selection-spacer"/><label className="handedness"><SlidersHorizontal size={16}/><input type="checkbox" checked={left} onChange={e=>setLeft(e.target.checked)}/> Left-handed</label></div>
        <div className="scale-overview"><div><div className="scale-kicker">{kind==='scales'?scale.family:`${pretty(root)}${quality.symbol}`} <span>/ {notes.length} notes</span></div><h2>{pretty(root)} <span>{title}</span></h2><p>{kind==='scales'?scale.description:'Find the chord tones across the neck, then try a voicing below. Amber marks the root; each voicing is one way to bring the notes together.'}</p></div><div className="note-palette" aria-label={kind==='scales'?'Scale notes':'Chord notes'}>{notes.map(n=><div key={n.degree} className={`palette-note ${n.degree==='1'?'root-palette':''}`}><span>{pretty(n.name)}</span><small>{pretty(n.degree)}</small></div>)}</div></div>
        <div className="diagram-toolbar"><div className="segmented" role="group" aria-label="Fretboard view"><button aria-pressed={view==='map'} onClick={()=>setView('map')}>Full neck</button>{shapes.length>0&&<button aria-pressed={view==='pattern'} onClick={()=>setView('pattern')}>{notes.length===5?'2':'3'} notes / string</button>}</div><div className="segmented compact" role="group" aria-label="Note labels"><button aria-pressed={!degrees} onClick={()=>setDegrees(false)}>Notes</button><button aria-pressed={degrees} onClick={()=>setDegrees(true)}>Degrees</button></div></div>
        {view==='pattern'&&shapes.length>0&&<div className="position-strip" role="group" aria-label="Practice pattern starting fret"><span>STARTING FRET · LOW E</span>{shapes.map((p,i)=><button key={p.start} aria-label={`${notes.length===5?2:3} notes per string, low E starting fret ${p.start}`} aria-pressed={i===Math.min(position,shapes.length-1)} onClick={()=>setPosition(i)}>{p.start}</button>)}</div>}
        {kind==='scales'&&context.length>0&&<div className="chord-targets" role="group" aria-label="Highlight chord tones"><span>LANDING NOTES FOR</span>{context.map((c,i)=><button key={i} aria-pressed={i===activeChord} onClick={()=>setActiveChord(i)}>{pretty(c.symbol)}</button>)}<span className="target-description">{context[activeChord]?.notes.map(n=>pretty(n.name)).join(' · ')}</span><div className="outside-palette">{context[activeChord]?.notes.some(n=>!notes.some(scaleNote=>scaleNote.pc===n.pc))&&<span>Outside this palette: {context[activeChord].notes.filter(n=>!notes.some(scaleNote=>scaleNote.pc===n.pc)).map(n=>pretty(n.name)).join(', ')}.</span>}<button onClick={()=>{const c=context[activeChord];setChordRoot(c.root);setQualityId(c.quality.id);setKind('chords');setView('map');}}>See {pretty(context[activeChord]?.symbol??'')} chord tones <ArrowUpRight size={14}/></button></div></div>}
        <Fretboard notes={notes} root={`${pretty(root)} ${title}`} pattern={shape} degrees={degrees} left={left} targets={context[activeChord]?.pcs}/>
      </section>
      {kind==='chords'?<section className="voicing-section"><div><div className="eyebrow">PUT IT UNDER YOUR FINGERS</div><h3>Ways to play {pretty(root)}{quality.symbol}</h3><p>× mute · ○ open. Numbers below read low E → high e. Movable shapes may need a barre; dots show fret positions.</p></div><div className="voicing-grid">{chordVoicings.map((v,i)=><VoicingDiagram key={i} {...v} notes={notes} left={left}/>)}</div></section>:<>
      {related.length>0&&<section className="related-chords"><div><span className="eyebrow">BUILT FROM THESE NOTES</span><h3>Chords in {pretty(root)} {scale.name.toLowerCase()}</h3></div><div className="harmony-row">{related.map((chord,i)=><button key={i} onClick={()=>openChord(chord.root,chord.qualityId)}><small>{scale.formula[i].replace(/\d+/,'')}{['minor','dim'].includes(chord.qualityId)?['i','ii','iii','iv','v','vi','vii'][i]:['I','II','III','IV','V','VI','VII'][i]}{chord.qualityId==='dim'?'°':chord.qualityId==='aug'?'+':''}</small><strong>{pretty(chord.symbol)}</strong><ArrowUpRight size={13}/></button>)}</div></section>}
      <div className="insight-grid"><section className="insight-card"><div className="card-label"><span>01</span> THE FORMULA</div><h3>A little structure. A lot of sound.</h3><div className="formula">{scale.formula.map(f=><span key={f}>{pretty(f)}</span>)}</div><p>Degrees describe each note’s distance from {pretty(root)}. The shape travels; the relationships stay.</p></section><section className="insight-card color-card"><div className="card-label"><Sparkles size={15}/> FIND THE COLOR</div><h3>Make {pretty(root)} feel like home.</h3><p>{scale.color}</p><p className="practice-tip">Start and finish a short phrase on an amber root note.</p></section><aside className="frog-card"><Image unoptimized src="/progger-mascot.png" alt="Progger, a pixel frog playing an amber electric guitar" width={150} height={150}/><div><span className="eyebrow">TAKE A SMALL HOP</span><h3>Try a different shade.</h3><Button className="try-button" onClick={()=>choose(root,scaleId==='dorian'?'minor':'dorian')}>Explore {scaleId==='dorian'?'natural minor':'Dorian'} <ArrowUpRight size={16}/></Button></div></aside></div>
      </>}
      </div>
      <footer><span>PROGGER <span className="muted">/ A little further up the neck.</span></span><span>Built for curious guitarists.</span></footer>
    </main>
  </div>;
}
