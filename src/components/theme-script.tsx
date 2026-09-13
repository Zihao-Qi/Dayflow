/**
 * Dayflow's themes key off `data-theme` and `data-accent` on the root element.
 * This runs synchronously before first paint and stamps the stored theme and accent
 * attributes from localStorage, preventing any flash of incorrect theme on initial load.
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
}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: source }} />;
}
