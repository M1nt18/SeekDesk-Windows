/** Exact publication time in the reader's local timezone, as in the original desktop app. */
export function formatPublicationDate(value?:string):{day:string;time:string;iso:string}|null {
  if(!value)return null;
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
  const pad=(number:number)=>String(number).padStart(2,'0');
  return {day:[date.getFullYear(),pad(date.getMonth()+1),pad(date.getDate())].join('-'),time:[date.getHours(),date.getMinutes(),date.getSeconds()].map(pad).join(':'),iso:date.toISOString()};
}
