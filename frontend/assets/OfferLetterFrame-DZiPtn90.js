import{a as s,j as f}from"./vendor-query-D4SHj8q5.js";import{e as m}from"./index-Bdt6uVon.js";const p=`
<style id="offer-letter-protection">
  *, *::before, *::after {
    user-select: none !important;
    -webkit-user-select: none !important;
    -moz-user-select: none !important;
    -ms-user-select: none !important;
  }
  @media print {
    html, body { display: none !important; visibility: hidden !important; }
  }
</style>
<script>
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  document.addEventListener('copy', function(e) { e.preventDefault(); });
  document.addEventListener('cut', function(e) { e.preventDefault(); });
  document.addEventListener('dragstart', function(e) { e.preventDefault(); });
<\/script>
`;function w(e){return e.includes("</head>")?e.replace("</head>",`${p}</head>`):`${p}${e}`}function v(e){const i=e.key.toLowerCase();(e.ctrlKey||e.metaKey)&&["p","s","c","a","u"].includes(i)&&e.preventDefault(),i==="printscreen"&&e.preventDefault()}function g({html:e,title:i="Offer letter",className:h,restrictCopy:n=!1}){const d=s.useRef(null),[x,l]=s.useState(960),c=s.useMemo(()=>{const t=n?w(e):e,a=new Blob([t],{type:"text/html;charset=utf-8"});return URL.createObjectURL(a)},[e,n]);return s.useEffect(()=>{if(n)return document.addEventListener("keydown",v),()=>document.removeEventListener("keydown",v)},[n]),s.useEffect(()=>()=>URL.revokeObjectURL(c),[c]),s.useEffect(()=>{const t=d.current;if(!t)return;const a=()=>{try{const r=t.contentDocument,u=r==null?void 0:r.body,o=r==null?void 0:r.documentElement;if(!u)return;const L=Math.max(u.scrollHeight,u.offsetHeight,(o==null?void 0:o.scrollHeight)??0,(o==null?void 0:o.offsetHeight)??0);l(Math.max(640,L+24))}catch{l(2400)}};t.addEventListener("load",a);const b=window.setTimeout(a,150);return()=>{t.removeEventListener("load",a),window.clearTimeout(b)}},[c]),f.jsxs("div",{className:m("relative",n&&"offer-letter-protected"),onContextMenu:n?t=>t.preventDefault():void 0,children:[f.jsx("iframe",{ref:d,title:i,src:c,className:m("w-full border rounded-xl bg-slate-100",h),style:{height:`${x}px`},sandbox:"allow-same-origin"}),n&&f.jsx("div",{className:"offer-letter-watermark","aria-hidden":"true"})]})}export{g as O};
