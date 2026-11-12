export interface TerminalSpan {text:string;foreground?:string;background?:string;bold?:boolean}
const ansiColors=['#1e2430','#e06c75','#98c379','#e5c07b','#61afef','#c678dd','#56b6c2','#d5dce8','#727b8b','#ff8e96','#b3e49a','#ffdc93','#89c9ff','#e0a2ff','#7ddbe4','#ffffff'];
const indexedColor=(value:number)=>value<16?ansiColors[value]:value<232?'rgb('+[Math.floor((value-16)/36),Math.floor((value-16)%36/6),(value-16)%6].map(n=>n===0?0:55+40*n).join(',')+')':'rgb('+Array(3).fill(8+10*(value-232)).join(',')+')';
/** Preserve SGR colors and every line; canvas viewport size never truncates text. */
export function parseAnsi(source:string):TerminalSpan[]{
  // Some forum plugins strip ESC while keeping SGR; ordinary [INFO] stays text.
  source=source.replace(/(?<!\x1b)\[([0-9;:]{1,24})m/g,'\x1b[$1m');
  const out:TerminalSpan[]=[],state:{foreground?:string;background?:string;bold?:boolean}={};
  const escape=/(?:\x1b\[|\u009b)([0-9;:]*)([a-zA-Z])|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
  let last=0,match:RegExpExecArray|null;
  const append=(text:string)=>{text=text.replace(/\r\n/g,'\n').replace(/\r/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');if(text)out.push({text,...state});};
  while((match=escape.exec(source))){append(source.slice(last,match.index));last=escape.lastIndex;if(match[2]!=='m')continue;const values=(match[1]||'0').split(/[;:]/).map(Number);
    for(let i=0;i<values.length;i++){const n=values[i];if(n===0){delete state.foreground;delete state.background;delete state.bold;}else if(n===1)state.bold=true;else if(n===22)delete state.bold;else if(n===39)delete state.foreground;else if(n===49)delete state.background;else if(n>=30&&n<=37)state.foreground=ansiColors[n-30];else if(n>=90&&n<=97)state.foreground=ansiColors[n-90+8];else if(n>=40&&n<=47)state.background=ansiColors[n-40];else if(n>=100&&n<=107)state.background=ansiColors[n-100+8];else if(n===38||n===48){const key=n===38?'foreground':'background';if(values[i+1]===5&&values[i+2]>=0&&values[i+2]<=255){state[key]=indexedColor(values[i+2]);i+=2;}else if(values[i+1]===2&&values.slice(i+2,i+5).length===3&&values.slice(i+2,i+5).every(v=>v>=0&&v<=255)){state[key]='rgb('+values.slice(i+2,i+5).join(',')+')';i+=4;}}}
  }append(source.slice(last));return out;
}
