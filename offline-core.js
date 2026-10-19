export const validQr=qr=>/^TICKET-[a-f0-9]{32}-[a-f0-9]{16}$/.test(qr);
export const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
export async function hashQr(qr){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(qr))));}
export function toBase64(bytes){let text='';for(let start=0;start<bytes.length;start+=16384)text+=String.fromCharCode(...bytes.subarray(start,start+16384));return btoa(text);}
export function fromBase64(text){return Uint8Array.from(atob(text),letter=>letter.charCodeAt(0));}
async function aesKey(key){const normalized=key.replaceAll('-','+').replaceAll('_','/');return crypto.subtle.importKey('raw',fromBase64(normalized+'='.repeat((4-normalized.length%4)%4)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function decryptPacket(packet,key,packId,kind='manifest'){
  if(packet.version!==1||packet.kind!==kind||packet.pack_id!==packId)throw new Error('Неподходящий файл списка');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(packet.iv),additionalData:new TextEncoder().encode(`pay-bot-offline-v1:${kind}:${packId}`)},await aesKey(key),fromBase64(packet.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
export async function encryptAttendance(data,key){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`pay-bot-offline-v1:attendance:${data.pack_id}`)},await aesKey(key),new TextEncoder().encode(JSON.stringify(data)));
  return {version:1,kind:'attendance',pack_id:data.pack_id,iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(bytes))};
}
export function evaluate(manifest,ticket,previous,now){
  if(!manifest||now>manifest.expires_at)return {ok:false,reason:'expired'};
  if(now<manifest.created_at-300)return {ok:false,reason:'clock'};
  if(!ticket)return {ok:false,reason:'not_in_snapshot'};
  if(ticket.used||previous)return {ok:false,reason:'already_used',ticket,used_at:previous?.scanned_at||ticket.used_at};
  return {ok:true,reason:'first_use',ticket};
}
