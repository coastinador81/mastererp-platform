import React from 'react';

const paths={
  summary:<><path d="M4 20V11m5 9V6m5 14V3m5 17V9"/></>,
  clients:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></>,
  quote:<><path d="m3 12 9-9h8v8l-9 9-8-8Z"/><circle cx="16" cy="7" r="1"/></>,
  sales:<><path d="M3 4h2l2 12h12l2-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
  document:<><path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6"/></>,
  supplier:<><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
  order:<><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8m-9 5v9"/></>,
  invoice:<><path d="M7 7H3v14h12v-4M8 3h9l4 4v10H8V3Zm9 0v5h4M11 11h6m-6 3h6"/></>,
  search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  plus:<path d="M12 4v16M4 12h16"/>,
};
export default function FinanceIcon({name,className=''}){
  return <svg className={'finance-line-icon '+className} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]||paths.document}</svg>;
}
