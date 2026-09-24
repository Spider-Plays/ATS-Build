import{j as u,e as l}from"./index-Do3c_LH8.js";import{a as s}from"./vendor-query-CDNOJGXE.js";const p=`
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
`;function x(e){return e.includes("</head>")?e.replace("</head>",`${p}</head>`):`${p}${e}`}function v(e){const a=e.key.toLowerCase();(e.ctrlKey||e.metaKey)&&["p","s","c","a","u"].includes(a)&&e.preventDefault(),a==="printscreen"&&e.preventDefault()}function O({html:e,title:a="Offer letter",className:h,restrictCopy:n=!1}){const m=s.useRef(null),[D,d]=s.useState(960),c=s.useMemo(()=>{const t=n?x(e):e,i=new Blob([t],{type:"text/html;charset=utf-8"});return URL.createObjectURL(i)},[e,n]);return s.useEffect(()=>{if(n)return document.addEventListener("keydown",v),()=>document.removeEventListener("keydown",v)},[n]),s.useEffect(()=>()=>URL.revokeObjectURL(c),[c]),s.useEffect(()=>{const t=m.current;if(!t)return;const i=()=>{try{const r=t.contentDocument,f=r==null?void 0:r.body,o=r==null?void 0:r.documentElement;if(!f)return;const L=Math.max(f.scrollHeight,f.offsetHeight,(o==null?void 0:o.scrollHeight)??0,(o==null?void 0:o.offsetHeight)??0);d(Math.max(640,L+24))}catch{d(2400)}};t.addEventListener("load",i);const b=window.setTimeout(i,150);return()=>{t.removeEventListener("load",i),window.clearTimeout(b)}},[c]),u.jsxDEV("div",{className:l("relative",n&&"offer-letter-protected"),onContextMenu:n?t=>t.preventDefault():void 0,children:[u.jsxDEV("iframe",{ref:m,title:a,src:c,className:l("w-full border rounded-xl bg-slate-100",h),style:{height:`${D}px`},sandbox:"allow-same-origin"},void 0,!1,{fileName:"C:/Users/Karthik_VC/OneDrive - Intact Green Services (India) PVT LTD/Desktop/ATS/src/components/offers/OfferLetterFrame.tsx",lineNumber:107,columnNumber:7},this),n&&u.jsxDEV("div",{className:"offer-letter-watermark","aria-hidden":"true"},void 0,!1,{fileName:"C:/Users/Karthik_VC/OneDrive - Intact Green Services (India) PVT LTD/Desktop/ATS/src/components/offers/OfferLetterFrame.tsx",lineNumber:116,columnNumber:9},this)]},void 0,!0,{fileName:"C:/Users/Karthik_VC/OneDrive - Intact Green Services (India) PVT LTD/Desktop/ATS/src/components/offers/OfferLetterFrame.tsx",lineNumber:103,columnNumber:5},this)}export{O};
