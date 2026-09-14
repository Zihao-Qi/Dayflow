/**
 * Dayflow's themes key off `data-theme` and `data-accent` on the root element.
 * This runs synchronously before first paint and stamps the stored theme and accent
 * attributes from localStorage, preventing any flash of incorrect theme on initial load.
 * It also brings the browser chrome colour with it, so the title bar does not sit
 * bright over a dark canvas until hydration.
 */
export function ThemeScript() {
  const source = `(function(){try{
var validThemes=["light","dark","warm","system"];
var validAccents=["neutral","sage","blue","clay","iris"];
var t=localStorage.getItem("dayflow_theme");
if(!validThemes.includes(t)) t="light";
var a=localStorage.getItem("dayflow_accent");
if(!validAccents.includes(a)) a="neutral";
var effective=t;
if(t==="system"){
  effective=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
}
var r=document.documentElement;
r.dataset.theme=effective;
r.dataset.themePreference=t;
r.dataset.accent=a;
/* themeColor in layout.tsx is one static light value, so a cold load into a
   dark or warm theme showed a bright browser chrome until React hydrated.
   Read --bg back off the root rather than repeating the palette here: if the
   stylesheet has not parsed yet this yields nothing and the provider corrects
   it on mount, which is no worse than before. */
var m=document.querySelector('meta[name="theme-color"]');
if(m){
  var bg=getComputedStyle(r).getPropertyValue("--bg").trim();
  if(bg) m.setAttribute("content",bg);
}
}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: source }} />;
}
