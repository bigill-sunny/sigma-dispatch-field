const guardTabs=[
  ['shifts','Schedule'],['open','Offers & swaps'],['leave','Time off'],['hours','Availability']
];
const guardAssignments=()=>data.requests.filter(r=>r.mine).sort((a,b)=>a.start-b.start);
const guardOpenShifts=()=>data.requests.filter(r=>r.canVolunteer&&(!r.rush||!activeOffer(r.offer))).sort((a,b)=>a.start-b.start);
const rushOffers=()=>data.requests.filter(r=>r.rush&&activeOffer(r.offer)).sort((a,b)=>a.offer.expires-b.offer.expires);
const briefStatus=r=>r.mine.ack?'Brief acknowledged':'Brief unread';

function guardView() {
  const rush=rushOffers();
  return `${attendanceScanPanel()}${rush.length?rushBanner(rush[0],rush.length):''}
    <div class="field-heading"><p>Guard workspace</p><h1>${guardTabs.find(([id])=>id===view.guardTab)[1]}</h1></div>
    <nav class="guard-tabs" aria-label="Guard workspace">${guardTabs.map(([id,label])=>`<button type="button" data-action="guard-tab" data-id="${id}" aria-pressed="${view.guardTab===id}"><span class="nav-icon nav-${id}" aria-hidden="true"></span>${label}</button>`).join('')}</nav>
    ${({shifts:guardSchedule,open:guardAdditionalShifts,hours:guardHours,leave:guardLeave})[view.guardTab]()}`;
}

function offerActions(r) {
  return `<div class="actions offer-actions">
    ${r.canVolunteer?button(r.rush?'I can cover this':'Request shift','volunteer',r.id,'','primary'):tag('Eligibility changed','warn')}
    ${r.rush&&activeOffer(r.offer)?button('Decline','decline',r.id):''}
  </div>`;
}
function rushBanner(r,count) {
  const {area,uniform}=r.location;
  return `<aside class="rush-banner" aria-label="Rush shift offer">
    <div class="row"><strong>Rush shift · ${safe(area)}</strong><span class="countdown" data-reply-deadline="${r.offer.replyDeadline||0}" data-reply-expires="${r.offer.expires}"></span></div>
    <p>${shiftTime(r)} · ${safe(uniform)} · ${r.eta} min ETA</p>
    <p class="small">Site name and instructions appear after approval.${count>1?' More offers in Offers &amp; swaps.':''}</p>
    ${offerActions(r)}
  </aside>`;
}
function updateRushCountdown() {
  for(const el of document.querySelectorAll('[data-reply-deadline]')){
    const simulated=Number(el.dataset.replyExpires)-data.now;
    const real=Number(el.dataset.replyDeadline)?Number(el.dataset.replyDeadline)-Date.now():simulated;
    const seconds=Math.max(0,Math.ceil(Math.min(real,simulated)/1000));
    el.textContent=seconds?'Reply in '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):'Reply window closed';
    if(!seconds)for(const btn of el.closest('.rush-banner, .entry')?.querySelectorAll('.offer-actions button')||[])btn.disabled=true;
  }
  signalRush();
}
function guardCalendarStatus(r){
  if(r.mine)return 'booked';
  if(r.start<=data.now)return null;
  if(r.offer?.status==='Volunteered'||r.backup)return 'pending';
  if(r.canVolunteer&&(!r.offer||activeOffer(r.offer)))return 'available';
  return null;
}
const calendarLabels={booked:'Booked',available:'Available',pending:'Unconfirmed'};
const fallsOnDate=(r,date)=>inputDate(r.start)<=date&&inputDate(r.end-1)>=date;
function monthCalendar(requests){
  const selected=view.calendarDate||inputDate(data.now);
  const first=selected.slice(0,7)+'-01';
  const offset=(new Date(first+'T12:00Z').getUTCDay()+6)%7;
  const label=new Intl.DateTimeFormat('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(first+'T12:00Z'));
  return `<div class="calendar calendar-scalable" data-calendar-size="${calendarSizes[view.calendarZoom||0]}">${calendarZoom()}<div class="row"><button type="button" data-month="-1" aria-label="Previous month">‹</button><strong>${label}</strong><button type="button" data-month="1" aria-label="Next month">›</button></div><div class="days">
  ${['M','T','W','T','F','S','S'].map(d=>'<span>'+d+'</span>').join('')}
  ${Array.from({length:42},(_,i)=>{
    const date=calendarDate(first,i-offset);
    const statuses=[...new Set(requests.filter(r=>fallsOnDate(r,date)).flatMap(r=>{
      const status=guardCalendarStatus(r);
      return r.mine&&!r.mine.ack?['booked','pending']:[status];
    }).filter(Boolean))];
    const labels=statuses.map(key=>calendarLabels[key]);
    return `<button type="button" data-date="${date}" aria-pressed="${selected===date}" aria-label="${[date,...labels].join(', ')}" class="${date.slice(0,7)!==first.slice(0,7)?'adjacent':''}">${Number(date.slice(-2))}<span class="calendar-day-markers" aria-hidden="true">${statuses.map(key=>calendarMarker(key,'')).join('')}</span></button>`;
  }).join('')}</div><div class="wrap calendar-legend">${Object.entries(calendarLabels).map(([key,label])=>calendarMarker(key,label)).join('')}</div></div>`;
}
document.addEventListener('click',event=>{
  const control=event.target.closest('[data-schedule-mode],[data-date],[data-month]');
  if(!control||view.role!=='guard')return;
  if(control.dataset.scheduleMode)view.scheduleMode=control.dataset.scheduleMode;
  if(control.dataset.date)view.calendarDate=control.dataset.date;
  if(control.dataset.month){
    const month=new Date((view.calendarDate||inputDate(data.now)).slice(0,7)+'-01T12:00Z');
    month.setUTCMonth(month.getUTCMonth()+Number(control.dataset.month));
    view.calendarDate=month.toISOString().slice(0,10);
  }
  render();
  const key=Object.keys(control.dataset)[0];
  const attr={scheduleMode:'data-schedule-mode',date:'data-date',month:'data-month'}[key];
  document.querySelector('['+attr+'="'+control.dataset[key]+'"]')?.focus({preventScroll:true});
});
function guardSchedule() {
  const shifts=guardAssignments();
  const pending=data.requests.filter(r=>r.offer?.status==='Volunteered'&&!isPast(r));
  const phoneSupported=location.protocol!=='file:'&&'PushManager' in window&&'Notification' in window;
  const phoneOn=phoneSupported&&Notification.permission==='granted'&&data.phoneRegistered;
  const selected=view.calendarDate||inputDate(data.now);
  const calendarRequests=data.requests.filter(guardCalendarStatus);
  const monthMode=view.scheduleMode==='Month';
  const visible=monthMode?shifts.filter(r=>fallsOnDate(r,selected)):shifts;
  const opportunities=monthMode?calendarRequests.filter(r=>!r.mine&&fallsOnDate(r,selected)):[];
  return `    ${pending.map(r=>`<section class="card"><h2>${safe(r.location.area)} · Awaiting dispatch approval</h2><p>${shiftTime(r)}</p><p>You volunteered. Wait for assignment confirmation before travelling.</p>${r.rush?button('Update arrival estimate','volunteer',r.id,'refresh-eta'):''}</section>`).join('')}
    ${data.requests.filter(r=>r.backup).map(r=>`<section class="card"><h2>Standby · ${safe(r.location.area)}</h2><p>${shiftTime(r)} · ${safe(r.backup.post)}</p><p>${r.backup.status==='Ready'?'On standby. Wait for dispatch approval before travelling.':'Can you cover this shift if needed?'}</p><div class="actions">${r.backup.status==='Invited'?button('Accept standby','standby-accept',r.id,'','primary'):''}${button(r.backup.status==='Ready'?'Withdraw standby':'Decline standby','standby-decline',r.id)}</div></section>`).join('')}
    ${supervisorCrewPanel()}
    ${data.notices?.length?`<details class="card"><summary>Assignment changes (${data.notices.length})</summary>${data.notices.map(n=>`<p>${safe(n.site)} · ${formatDay(n.start)} ${formatTime(n.start)} · ${safe(n.status)}</p>`).join('')}</details>`:''}
    <section class="card schedule-card"><div class="section-top"><h2>Assignments</h2><div class="segments" aria-label="Schedule view">${['Agenda','Month'].map(mode=>`<button type="button" data-schedule-mode="${mode}" aria-pressed="${(view.scheduleMode||'Agenda')===mode}">${mode}</button>`).join('')}</div></div>
    ${view.scheduleMode==='Month'?monthCalendar(calendarRequests):''}
    ${visible.length?visible.map((r,index)=>{
    const {name,uniform,notes,brief,dress}=r.location;
    const label=isPast(r)?'In progress':r===shifts[0]?'Next shift':'Upcoming';
    return `<div class="entry"><div class="row"><strong class="shift-time">${formatTime(r.start)} – ${formatTime(r.end)}</strong>${calendarMarker('booked','Booked · '+label)}</div>
      <p class="sub">${calendarMarker(r.mine.ack?'booked':'pending',r.mine.ack?'Brief confirmed':'Brief unconfirmed')}</p>
      <p class="site-line">${safe(name)}</p><p class="sub">${shiftTime(r)} · ${safe(uniform)} · ${r.mine.post||'Confirmed'}${dress?' · '+safe(dress):''}</p>
      <p class="sub" data-shift-reminder="${r.id}"></p>
      ${!isPast(r)&&r.location.coordinates?`<div class="actions">${button(travelWatches.has(r.id)?'Stop travel alert':'Enable travel alert','travel-alert',r.id)}<span class="small" data-travel-status="${r.id}" aria-live="polite"></span></div>`:''}
      <div class="actions" data-arrival-action="${r.id}">${arrivalAction(r)}</div>
      <p class="check-in"><strong>Check-in instructions</strong> ${safe(notes)}${brief?' '+safe(brief):''}</p>
      <div class="actions form-actions">${r.mine.ack?tag(briefStatus(r),'good'):button('Acknowledge site brief','ack',r.id,'','primary')}</div>
      ${!isPast(r)?`<div class="actions form-actions">${r.pendingSwap?tag('Swap pending','warn'):r.peers.length?button('Offer to swap pool','pool',r.id):''}${button('Report cancellation','guard-cancel',r.id,'','danger')}</div>
      ${r.peers.length?`<details class="details"><summary>Propose swap to an eligible peer</summary>
        <form data-swap="${r.id}" class="wrap"><label>Eligible guard <select name="target" required><option value="">Choose a guard</option>${r.peers.map(peer=>option(peer.id,peer.name+' · '+peer.id)).join('')}</select></label><button class="button">Propose swap</button></form>
      </details>`:''}`:''}
    </div>`;
  }).join(''):opportunities.length?'':empty(monthMode?'No shifts or offers for this date.':'Your approved assignments will appear here.')}
    ${opportunities.map(r=>{
      const status=guardCalendarStatus(r);
      const label=r.offer?.status==='Volunteered'?'Unconfirmed · awaiting dispatch approval':r.backup?'Unconfirmed · standby':'Available';
      return `<div class="entry"><div class="row"><strong>${safe(r.location.area)}</strong>${calendarMarker(status,label)}</div><p class="sub">${shiftTime(r)} · ${safe(r.location.uniform)}</p>${status==='available'?offerActions(r):''}</div>`;
    }).join('')}</section><section class="card"><h2>Shift notifications on this phone</h2><div class="actions"><strong>${phoneSupported?(phoneOn?'On':'Off'):'Unavailable here'}</strong>
    ${phoneSupported?button(phoneOn?'Turn phone alerts off':'Turn phone alerts on','phone-alert'):''}
    ${button(alertGuard===account.id?'Mute in-app alerts':'Enable in-app alerts','alert-device')}</div></section>`;
}
function regularOfferCard(r) {
  const {area,uniform}=r.location;
  return `<article class="entry"><strong>${r.rush?'Rush · ':''}${safe(area)}</strong><p class="sub">${shiftTime(r)} · ${safe(uniform)}</p>${offerActions(r)}</article>`;
}
function guardAdditionalShifts() {
  const regular=guardOpenShifts();
  const otherRush=rushOffers().slice(1);
  const waiting=data.requests.filter(r=>r.offer?.status==='Volunteered');
  return `<section class="card"><h2>Open shifts and swap pool</h2>
    <p class="sub">Site name and instructions appear after approval.</p>
    ${otherRush.map(r=>`<article class="entry"><div class="row"><strong>Rush · ${safe(r.location.area)}</strong><span data-reply-deadline="${r.offer.replyDeadline||0}" data-reply-expires="${r.offer.expires}"></span></div><p class="sub">${shiftTime(r)} · ${safe(r.location.uniform)}</p>${offerActions(r)}</article>`).join('')}
    ${regular.map(regularOfferCard).join('')}
    ${data.poolSwaps.map(s=>`<article class="entry"><strong>${safe(s.location.area)} · Swap pool</strong><p class="sub">${shiftTime(s)} · ${safe(s.location.uniform)}</p>${button('Claim pool swap','claim',s.id,'','primary')}</article>`).join('')}
    ${waiting.map(r=>`<article class="entry"><div class="row"><strong>${safe(r.location.area)}</strong>${tag('Awaiting admin approval','warn')}</div><p class="sub">${shiftTime(r)}</p></article>`).join('')}
    ${!(regular.length||otherRush.length||waiting.length||data.poolSwaps.length)?empty('Eligible regular shifts and peer swaps will appear here.'):''}
    </section>`;
}
function choices(values,selected,name) {
  return values.map(value=>`<label class="choice"><input type="checkbox" name="${name}" value="${value}" ${selected.includes(value)?'checked':''}><span>${value}</span></label>`).join('');
}
function guardHours() {
  const profile=data.profile;
  return `<section class="card"><h2>Unavailable periods</h2><form id="unavailable" class="fields"><label>From date<input type="date" name="date" value="${inputDate(data.now)}" required></label><label>From time<input type="time" name="from" required></label><label>Until date<input type="date" name="endDate" value="${inputDate(data.now)}" required></label><label>Until time<input type="time" name="to" required></label><button class="button">Save unavailable period</button></form>
    ${(profile.unavailable||[]).filter(w=>w.end>data.now).map(w=>`<p>${shiftTime(w)} ${button('Remove period','remove-window',w.start)}</p>`).join('')}</section><section class="card"><h2>Preferred working hours</h2>
    <form id="preferences" class="preference-form">
      <fieldset><legend>Days</legend><div class="wrap">${choices(weekdays,profile.days,'days')}</div></fieldset>
      <fieldset><legend>Shift blocks</legend><div class="wrap">${choices(blocks,profile.blocks,'blocks')}</div>
      <p class="sub">Morning 6 a.m.–noon · Afternoon noon–6 p.m. · Overnight 6 p.m.–6 a.m.</p></fieldset>
      <label>Maximum weekly hours target <input type="number" name="maxHours" min="1" max="168" step="0.5" value="${profile.maxHours}" required></label>
      <label class="choice"><input type="checkbox" name="standby" ${profile.standby?'checked':''}> Receive standby invitations for critical posts</label>
      <label class="choice"><input type="checkbox" name="rush"  ${profile.rush?'checked':''}> Receive last-minute rush offers</label>
      <div class="actions"><button class="button primary">Save preferences</button></div>
    </form>
  </section>`;
}
function guardLeave() {
  const upcoming=inputDate(data.now+day);
  return `<section class="card"><h2>Request time off</h2><form id="leave-request" class="preference-form">
    <div class="fields"><label>First day<input name="first" type="date" min="${inputDate(data.now)}" value="${upcoming}" required></label>
    <label>Last day<input name="last" type="date" min="${inputDate(data.now)}" value="${upcoming}" required></label></div>
    <button class="button primary">Request leave</button></form>
    <hr class="divider"><h2>Leave and swap status</h2>
    ${data.leaves.map(l=>`<div class="row entry"><span>Leave · ${formatDay(l.start)} to ${formatDay(l.end-1)}</span>${tag(l.status)}</div>`).join('')}
    ${data.swaps.map(s=>{
      const pending=s.status==='Pending'&&s.accepted;
      const status=pending?(s.incoming&&s.claimedFromPool?'Claimed · Awaiting admin approval':'Awaiting admin approval'):s.status;
      return `<div class="row entry"><span>${s.incoming?'Swap from ':'Swap to '}${safe(s.peer||'eligible pool')} · ${formatDay(s.start)}</span>
        ${s.incoming&&s.status==='Pending'&&!s.accepted?button('Accept swap','accept-swap',s.id,'','primary'):tag(status,pending?'warn':'')}</div>`;
    }).join('')}
    ${!(data.leaves.length||data.swaps.length)?empty('Leave and swap requests will appear here.'):''}
  </section>`;
}

let alertGuard=null, alertAudio=null, seenRush=new Set();
function toggleRushSound() {
  if(alertGuard===account.id){alertGuard=null;render();return;}
  alertGuard=account.id;
  seenRush=new Set(rushOffers().map(r=>r.id+':'+r.offer.replyDeadline));
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(Audio){
    try{alertAudio ||= new Audio();alertAudio.resume().catch(()=>{});}catch{}
  }
  render();
}
function signalRush() {
  if(!account||view.role!=='guard'||alertGuard!==account.id)return;
  for(const r of rushOffers()){
    const key=r.id+':'+r.offer.replyDeadline;
    if(seenRush.has(key))continue;
    seenRush.add(key);
    const banner=document.querySelector('.rush-banner');
    if(banner && !matchMedia('(prefers-reduced-motion: reduce)').matches){
      banner.animate([{outline:'4px solid transparent'},{outline:'4px solid #d88600'},{outline:'4px solid transparent'}],{duration:1600,iterations:2});
    }
    navigator.vibrate?.([180,80,180]);
    if(alertAudio?.state==='running'){
      const oscillator=alertAudio.createOscillator();
      const gain=alertAudio.createGain();
      oscillator.frequency.value=625;
      gain.gain.value=.09;
      oscillator.connect(gain).connect(alertAudio.destination);
      oscillator.start();
      oscillator.stop(alertAudio.currentTime+.20);
    }
  }
}
async function managePhoneAlerts(){
  try{
    const disable=data.phoneRegistered&&Notification.permission==='granted';
    if(!disable&&await Notification.requestPermission()!=='granted')throw Error('Phone notifications are off. To enable them, allow notifications in browser settings.');
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(disable){
      const removed=await requestApi('/api/push',apiOptions({endpoint:null}));
      if(!removed.ok)throw Error('Could not turn off phone alerts.');
      await subscription?.unsubscribe();
      await refresh();return;
    }
    if(!subscription){
      const response=await fetch('/api/push');
      if(!response.ok)throw Error('Sign in again to enable notifications.');
      const {publicKey}=await response.json();
      subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
    }
    const saved=await requestApi('/api/push',apiOptions({endpoint:subscription?.endpoint||null}));
    if(!saved.ok)throw Error('Could not save the notification preference.');
    await refresh();
    announce(subscription?'Rush notifications enabled for this sign-in.':'Phone notifications turned off.');
  }catch(error){announce(error.message,true);}
}


const travelWatches=new Map();
const remindedShifts=new Set();
function clearTravelAlerts(){
  for(const watch of travelWatches.values())navigator.geolocation.clearWatch(watch.handle);
  travelWatches.clear();
  remindedShifts.clear();
}
function travelEstimate(origin,destination){
  const rad=Math.PI/180;
  const [lat,lon]=origin.map(x=>x*rad);
  const [destLat,destLon]=destination.map(x=>x*rad);
  const a=Math.sin((destLat-lat)/2)**2+Math.cos(lat)*Math.cos(destLat)*Math.sin((destLon-lon)/2)**2;
  return Math.ceil(12742*Math.asin(Math.sqrt(Math.min(1,a)))*1.35/35*60);
}
function updateShiftAlerts(){
  if(!account||view.role!=='guard')return;
  const now=Date.now();
  for(const [id,watch] of travelWatches){
    const r=byId(id);
    if(!r?.mine||r.start<=now){
      navigator.geolocation.clearWatch(watch.handle);
      travelWatches.delete(id);
      continue;
    }
    const status=document.querySelector('[data-travel-status="'+id+'"]');
    if(!watch.position){if(status)status.textContent=watch.error||'Waiting for location';continue;}
    const eta=travelEstimate(watch.position,r.location.coordinates);
    const leave=r.start-(eta+10)*minute;
    if(status)status.textContent='Estimated '+eta+' min drive · '+(leave<=now?'Leave now':'Leave by '+formatTime(leave))+' · 10 min arrival buffer';
    if(leave<=now&&!watch.alerted){
      watch.alerted=true;
      announce('Leave now for '+r.location.name+'. Allow '+eta+' minutes plus the arrival buffer.');
      navigator.vibrate?.(250);
    }
  }
  for(const r of guardAssignments()){
    const arrival=document.querySelector('[data-arrival-action="'+r.id+'"]');
    const action=arrivalAction(r);
    if(arrival&&arrival.dataset.current!==action){arrival.dataset.current=action;arrival.innerHTML=action;}
    const remaining=r.start-now;
    if(remaining<=0||remaining>hour)continue;
    const message='Shift starts in '+Math.ceil(remaining/minute)+' min. '+(r.mine.ack?'Site brief acknowledged.':'Review and acknowledge the site brief.');
    const label=document.querySelector('[data-shift-reminder="'+r.id+'"]');
    if(label&&label.textContent!==message)label.textContent=message;
    const key=r.id+':'+r.mine.at;
    if(!remindedShifts.has(key)){remindedShifts.add(key);announce(r.location.name+' · '+message);}
  }
}
function toggleTravelAlert(id){
  const existing=travelWatches.get(id);
  if(existing){navigator.geolocation.clearWatch(existing.handle);travelWatches.delete(id);render();return;}
  if(!navigator.geolocation){announce('Location access is unavailable in this browser.',true);return;}
  const watch={position:null,alerted:false};
  travelWatches.set(id,watch);
  watch.handle=navigator.geolocation.watchPosition(position=>{
    watch.position=[position.coords.latitude,position.coords.longitude];
    updateShiftAlerts();
  },error=>{watch.error=error.code===1?'Location permission denied':'Location unavailable';updateShiftAlerts();},{maximumAge:60000,timeout:15000});
  render();
  updateShiftAlerts();
}

function arrivalAction(r){
  if(r.mine.checkIn)return tag('Checked in at '+formatTime(r.mine.checkIn.at),'good');
  if(r.start-data.now>15*minute||data.now>=r.end)return '';
  if(data.qrAttendance)return button('Scan supervisor QR','open-attendance-scan',r.id,'','primary');
  return button('I am on site · self-report','check-in',r.id,'','primary');
}
