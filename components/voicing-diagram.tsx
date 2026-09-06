import { TUNING, mod, type Note } from '@/lib/music';
export function VoicingDiagram({frets,name,notes,left}:{frets:(number|null)[];name:string;notes:Note[];left:boolean}) {
 let minFret=25,maxFret=0;
 for(const fret of frets){if(fret!==null&&fret>0){minFret=Math.min(minFret,fret);maxFret=Math.max(maxFret,fret);}}
 const start=minFret>1?minFret:1;
 const rows=Math.max(4,maxFret-start+1);
 const strings=left?[5,4,3,2,1,0]:[0,1,2,3,4,5];
 const label=`${name}. Low E to high e: ${frets.map(f=>f===null?'mute':f===0?'open':f).join(', ')}.`;
 return <div className="voicing"><svg viewBox={`0 0 168 ${70+rows*23}`} role="img" aria-label={label}>
  {Array.from({length:rows+1},(_,i)=><line key={i} x1="29" x2="139" y1={40+i*23} y2={40+i*23} stroke={i===0&&start===1?'#bfc8b4':'#506148'} strokeWidth={i===0&&start===1?4:1}/>)}
  {strings.map((string,i)=><g key={string}><line x1={29+i*22} x2={29+i*22} y1="40" y2={40+rows*23} stroke="#64735b"/><text x={29+i*22} y="26" textAnchor="middle" fill="#c1cbb9" fontSize="13">{frets[string]===null?'×':frets[string]===0?'○':''}</text><text x={29+i*22} y={59+rows*23} textAnchor="middle" fill="#acb8a5" fontSize="11">{['E','A','D','G','B','e'][string]}</text>{frets[string]!==null&&frets[string]!>0&&<circle cx={29+i*22} cy={40+(frets[string]!-start+.5)*23} r="7" fill={notes.find(n=>n.pc===mod(TUNING[string]+frets[string]!))?.degree==='1'?'#f6c56c':'#b5ef74'}/>}</g>)}
  <text x="12" y="55" textAnchor="middle" fill="#c1cbb9" fontSize="11">{start}</text>
 </svg><p>{name}</p><small>{frets.map(f=>f===null?'×':f).join(' · ')}</small></div>;
}
