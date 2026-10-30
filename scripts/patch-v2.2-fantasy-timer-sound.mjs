import { readFile, writeFile } from "node:fs/promises";

const bundleUrl = new URL("../dist/client/assets/page-DgGL8wLX.js", import.meta.url);
let source = await readFile(bundleUrl, "utf8");

const before = "if(ue.current=e,t)try{let e=new(window.AudioContext||window.webkitAudioContext),t=e.createOscillator(),n=e.createGain();t.type=`sine`,t.frequency.setValueAtTime(740,e.currentTime),n.gain.setValueAtTime(1e-4,e.currentTime),n.gain.exponentialRampToValueAtTime(.18,e.currentTime+.02),n.gain.exponentialRampToValueAtTime(1e-4,e.currentTime+.28),t.connect(n).connect(e.destination),t.start(),t.stop(e.currentTime+.3)}catch{}";
const after = "if(ue.current=e,t)try{let e=new(window.AudioContext||window.webkitAudioContext),t=e.currentTime,n=e.createGain(),r=e.createDelay(.7),i=e.createGain();n.gain.setValueAtTime(1e-4,t),n.gain.exponentialRampToValueAtTime(.2,t+.08),n.gain.exponentialRampToValueAtTime(1e-4,t+5),r.delayTime.setValueAtTime(.32,t),i.gain.setValueAtTime(.28,t),r.connect(i).connect(r),r.connect(n),n.connect(e.destination),[[146.83,0,5,.03,`triangle`],[293.66,0,3.2,.085,`triangle`],[349.23,.35,3.2,.07,`sine`],[440,.7,3.3,.07,`triangle`],[587.33,1.05,3.5,.06,`sine`],[698.46,1.45,3.2,.05,`triangle`],[880,1.85,3,.04,`sine`]].forEach(([a,o,s,c,l])=>{let u=e.createOscillator(),d=e.createGain(),f=t+o,p=Math.min(t+4.95,f+s);u.type=l,u.frequency.setValueAtTime(a,f),u.detune.setValueAtTime(-7,f),u.detune.linearRampToValueAtTime(7,p),d.gain.setValueAtTime(1e-4,f),d.gain.exponentialRampToValueAtTime(c,f+.03),d.gain.exponentialRampToValueAtTime(1e-4,p),u.connect(d),d.connect(n),d.connect(r),u.start(f),u.stop(p)}),window.setTimeout(()=>void e.close(),5500)}catch{}";

const matches = source.split(before).length - 1;
if (matches === 1) {
  source = source.replace(before, after);
} else if (!source.includes(after)) {
  throw new Error(`Timer-Piepton: erwartet wurde genau ein Treffer, gefunden wurden ${matches}`);
}

const neutralHostText = "Werte, Effekte und Timer bleiben danach auf dem Server gespeichert.";
if (!source.includes(neutralHostText)) {
  source = source.replace(
    /Werte, Effekte und Timer bleiben danach auf [A-Za-z0-9._-]+ gespeichert\./,
    neutralHostText,
  );
}
if (!source.includes(neutralHostText)) {
  throw new Error("Neutraler Speicherhinweis wurde im Browserpaket nicht gefunden");
}
await writeFile(bundleUrl, source, "utf8");
console.log("V2.2-Fantasyklang für Timer wurde angewendet.");
