import {validQr,hashQr,decryptPacket,encryptAttendance,evaluate} from './offline-core.js';
const element=id=>document.getElementById(id);
let pack=null,key=null,manifest=null,scanner=null,busy=false,storage=null,cacheReady=false;
const requestValue=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const status=text=>{element('status').textContent=text;};

async function openStorage(){
  const request=indexedDB.open('asound-offline-scanner',1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('packs',{keyPath:'pack_id'});request.result.createObjectStore('uses',{keyPath:'id'});};
  return requestValue(request);
}
async function storedPack(){return requestValue(storage.transaction('packs').objectStore('packs').get(pack));}
async function journal(){const rows=await requestValue(storage.transaction('uses').objectStore('uses').getAll());return rows.filter(row=>row.pack_id===pack);}
async function savePack(){
  await new Promise((resolve,reject)=>{const tx=storage.transaction('packs','readwrite');tx.objectStore('packs').put({pack_id:pack,key,manifest});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  localStorage.setItem('asound-current-pack',pack);
}
async function updateCard(){
  const rows=await journal();
  const now=Math.floor(Date.now()/1000);
  const valid=manifest&&now<=manifest.expires_at;
  element('connection').textContent=valid?'Список билетов загружен':'Срок списка истёк';
  element('count').textContent=manifest?`${manifest.tickets.length} билетов`:'';
  element('snapshot').textContent=manifest?`Обновлён: ${new Date(manifest.generated_at*1000).toLocaleString('ru-RU')}. Проходов на этом устройстве: ${rows.length}.`:'';
  element('readiness').textContent=valid?(cacheReady?'Готов к работе без интернета на этом телефоне.':'Список сохранён. Подготавливаем страницу для работы без интернета…'):'Нужен новый список от организатора. Журнал проходов сохранён.';
  document.querySelector('.card').classList.toggle('ready',Boolean(valid&&cacheReady));
  element('start').disabled=!valid;
  element('submit').disabled=!valid;
  element('export').disabled=false;
  element('refresh').disabled=false;
}
async function loadManifest(){
  const response=await fetch('./manifest.enc.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw new Error('Не удалось загрузить список билетов');
  const candidate=await decryptPacket(await response.json(),key,pack);
  if(candidate.pack_id!==pack||!Array.isArray(candidate.tickets)||candidate.version!==1)throw new Error('Некорректный список');
  if(Date.now()/1000>candidate.expires_at)throw new Error('Срок списка закончился. Организатор должен подготовить новый.');
  manifest=candidate;
  await savePack();
  await updateCard();
}
function popup(title,details,kind='warning'){
  element('title').textContent=title;element('details').textContent=details;
  element('verdict').dataset.kind=kind;element('verdict').showModal();
}
async function record(qrHash){
  const ticket=manifest.tickets.find(ticket=>ticket.qr_hash===qrHash);
  return new Promise((resolve,reject)=>{
    const tx=storage.transaction('uses','readwrite');const store=tx.objectStore('uses');
    const id=pack+':'+(ticket?.ticket_id||qrHash);let verdict;
    const request=store.get(id);
    request.onsuccess=()=>{
      const now=Math.floor(Date.now()/1000);
      verdict=evaluate(manifest,ticket,request.result,now);
      if(verdict.ok)store.add({id,pack_id:pack,request_id:crypto.randomUUID().replaceAll('-',''),ticket_id:ticket.ticket_id,qr_hash:qrHash,scanned_at:now});
    };
    tx.oncomplete=()=>resolve(verdict);
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function scan(value){
  if(busy||element('verdict').open||!manifest)return;
  busy=true;
  try{
    const qr=String(value||'').trim();
    if(!validQr(qr)){popup('❌ Недействительный QR','Это не QR билета.','danger');return;}
    const result=await record(await hashQr(qr));
    const ticket=result.ticket;
    const details=ticket?`${ticket.ticket_type==='vip'?'VIP столик':'Обычный билет'}\n${ticket.client_name}\nБилет: ${ticket.ticket_id.slice(0,8)}…`:'';
    if(result.ok){popup('✅ Пропустить',details+'\nВыдайте гостю браслет.','success');await updateCard();}
    else if(result.reason==='already_used'){const stamp=typeof result.used_at==='number'?new Date(result.used_at*1000).toLocaleString('ru-RU'):result.used_at;popup('⛔️ Уже использован',details+'\nПогашен: '+(stamp||'ранее'),'danger');}
    else if(result.reason==='not_in_snapshot')popup('⚠️ Нет в загруженном списке','Не пропускайте гостя без проверки у организатора. Возможно, билет куплен после обновления списка.');
    else if(result.reason==='clock')popup('⚠️ Проверьте время телефона','Включите автоматическую настройку даты и времени.');
    else popup('⚠️ Срок списка закончился','Обновите список через организатора.');
  }catch(error){popup('⚠️ Проверка не выполнена','Не удалось сохранить проход на телефоне. Не пропускайте гостя. '+(error.message||''));}
  finally{busy=false;}
}
element('start').addEventListener('click',()=>{
  if(scanner)return;
  try{
    scanner=new Html5QrcodeScanner('reader',{fps:10,qrbox:{width:240,height:240}},false);
    scanner.render(scan,()=>{});status('Камера готова. Наведите её на QR гостя.');
  }catch{scanner=null;status('Камера недоступна. Проверьте HTTPS и разрешение браузера.');}
});
element('submit').addEventListener('click',()=>scan(element('qr').value));
element('close').addEventListener('click',()=>{element('verdict').close();element('qr').value='';status('Готово к следующему билету.');});
element('verdict').addEventListener('cancel',event=>{event.preventDefault();element('close').click();});
element('refresh').addEventListener('click',async()=>{try{await loadManifest();status('Список обновлён. Журнал проходов сохранён.');}catch(error){status('Не удалось обновить: '+error.message+'. Продолжайте по сохранённому списку, если он актуален.');}});
element('export').addEventListener('click',async()=>{
  try{
    const operations=(await journal()).map(({request_id,ticket_id,qr_hash,scanned_at})=>({request_id,ticket_id,qr_hash,scanned_at}));
    const packet=await encryptAttendance({pack_id:pack,operations},key);
    const url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`attendance-${pack}.enc.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    status(`Журнал (${operations.length} проходов) выгружен. Передайте файл организатору. Не очищайте данные браузера.`);
  }catch{status('Не удалось выгрузить журнал. Не очищайте данные браузера.');}
});
async function init(){
  try{
    if(!window.isSecureContext)throw new Error('Для камеры и работы без интернета нужен HTTPS');
    storage=await openStorage();
    const params=new URLSearchParams(location.hash.slice(1));
    pack=params.get('pack')||localStorage.getItem('asound-current-pack');
    key=params.get('key');
    if(!pack)throw new Error('Нужна секретная ссылка от организатора');
    const stored=await storedPack();
    key=key||stored?.key;
    if(!key)throw new Error('В ссылке нет ключа доступа');
    if(stored&&stored.key===key)manifest=stored.manifest;
    try{await loadManifest();}catch(error){if(!manifest)throw error;await updateCard();status('Используется сохранённый список.');}
    history.replaceState(null,'',location.pathname);
    document.body.classList.add('authorized');
    if('serviceWorker' in navigator){
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;cacheReady=true;
      await updateCard();
    }
    status('Готово. Перед работой проверьте сканирование в авиарежиме.');
  }catch(error){status(error.message||'Не удалось открыть сканер');element('readiness').textContent='Сканер ещё не подготовлен к работе. Доступ в админку не требуется.';}
}
init();
