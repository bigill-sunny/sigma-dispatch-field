const minute = 60000;
const hour = 60 * minute;
const day = 24 * hour;
const tiers = ['Guard','Tier 2','Supervisor'];
let {sites,clients,guards}=typeof module!=='undefined'?require('./catalog.js'):{sites:[],clients:{},guards:[]};

const guardId=id=>Number(id)>0&&Number(id)<=120?3000+Number(id):Number(id);
const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const blocks=['Morning','Afternoon','Overnight'];
const defaultPreferences={days:[...weekdays],blocks:[...blocks],maxHours:44,rush:true,standby:false};

function migrate(snapshot) {
  if(snapshot.version===2)return snapshot;
  for(const r of snapshot.requests){
    for(const a of r.assignments)a.guard=guardId(a.guard);
    if(r.cancelledGuard)r.cancelledGuard=guardId(r.cancelledGuard);
    if(r.cancelledGuards)r.cancelledGuards=r.cancelledGuards.map(guardId);
    r.offers=Object.fromEntries(Object.entries(r.offers).map(([id,offer])=>[guardId(id),offer]));
  }
  for(const leave of snapshot.leaves)leave.guard=guardId(leave.guard);
  for(const swap of snapshot.swaps){
    swap.guard=guardId(swap.guard);
    if(swap.target)swap.target=guardId(swap.target);
  }
  snapshot.profiles={};
  snapshot.version=2;
  return snapshot;
}

function newRequest(id,site,when,length,need,tier,rush,notes='') {
  return {id,site,start:when,end:when+length,need,tier,rush,notes,offers:{},assignments:[],alertCount:0};
}

function seed(){
  const now=Date.now();
  const surge=newRequest(1,'harbor',now+2*hour,4*hour,10,1,true,'Additional entrance coverage for an evening event. Check in at east reception.');
  surge.supervisors=1;
  const lobby=newRequest(2,'cedar',now+30*minute,4*hour,1,2,false,'Supervisor must collect the access log at reception.');
  lobby.supervisors=1;
  lobby.assignments.push({guard:3019,post:'Supervisor',at:now-hour});
  const requests=[surge,lobby];
  for(const [index,site] of sites.slice(2).entries()){
    const start=now+(1+index%7)*day+(index%3)*hour;
    const post=newRequest(index+3,site.id,start,6*hour,2,0,false,'Scheduled lobby coverage.');
    const incumbents=guards.filter(g=>g.available&&g.licensedUntil>=post.end&&g.trained.includes(site.id)&&g.uniforms.includes(site.uniform)&&!requests.some(other=>overlaps(other,post)&&other.assignments.some(a=>a.guard===g.id)));
    for(const guard of incumbents.slice(0,index%4===0?1:2))post.assignments.push({guard:guard.id,post:'General',at:now});
    requests.push(post);
  }
  return {version:2,now,profiles:{},requests,leaves:[],swaps:[],next:101,log:[{at:now,message:'Weekly staffing requests received.'}]};
}

let data;
const view={role:'admin',selected:1,guard:null,client:null,contact:null,search:'',status:'all',page:0,template:null,prefill:{},checked:new Set()};

const byId=(id)=>data.requests.find(r=>r.id===Number(id));
const guardBy=(id)=>guards.find(g=>g.id===Number(id));
const siteBy=(id)=>sites.find(s=>s.id===id);
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'});const inputDate=n=>{const parts=Object.fromEntries(dateFmt.formatToParts(n).map(p=>[p.type,p.value]));return [parts.year,parts.month,parts.day].join('-');};
const calendarDate=(date,offset)=>new Date(Date.parse(date+'T12:00Z')+offset*day).toISOString().slice(0,10);
const clockFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});const inputTime=n=>clockFmt.format(n);
function localTime(date,time){const base=Date.parse(date+'T'+time+'Z');for(const offset of [4,5]){const t=base+offset*hour;if(Number.isFinite(t)&&inputDate(t)===date&&inputTime(t)===time)return t;}throw Error('Choose a valid Toronto local time.');}
const formatTime=(n)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit',hour12:true}).format(n);
const formatDay=(n)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',weekday:'short',month:'short',day:'numeric'}).format(n);
const shiftTime=(r)=>`${formatDay(r.start)} · ${formatTime(r.start)}–${inputDate(r.start)===inputDate(r.end)?'':formatDay(r.end)+' '}${formatTime(r.end)}`;
const open=(r)=>r.need-r.assignments.length;
const isPast=(r)=>r.start<=data.now;
function companyAlertUntil(r,now) {
  if(r.start<=now||r.need<=(r.confirmed??r.assignments.length))return 0;
  if(inputDate(r.start)===inputDate(now))return r.start;
  const received=r.receivedAt??r.history?.find(event=>event.status==='Received')?.at;
  return received<=now&&received+day>now?Math.min(r.start,received+day):0;
}
const overlaps=(a,b)=>a.start<b.end&&b.start<a.end;
const safe=(val)=>String(val??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

function gap(r){return Math.max(0,(r.supervisors||0)-r.assignments.filter(a=>a.post==='Supervisor').length);}
const calendarCache=new WeakMap();
function requestCalendar(r){
  if(calendarCache.has(r))return calendarCache.get(r);
  const midnight=localTime(inputDate(r.start),'00:00');
  const dow=(new Date(inputDate(midnight)+'T12:00Z').getUTCDay()+6)%7;
  const dateAt=i=>new Date(Date.parse(inputDate(midnight)+'T12:00Z')+i*day).toISOString().slice(0,10);
  const monday=localTime(dateAt(-dow),'00:00'),weekEnd=localTime(dateAt(7-dow),'00:00');
  const calendar={monday,weekEnd};
  calendarCache.set(r,calendar);
  return calendar;
}
function scheduleCheck(g,r){
  const {monday,weekEnd}=requestCalendar(r);
  const duties=data.requests.filter(x=>r.id!==x.id&&x.assignments.some(a=>a.guard===g.id));
  const hours=duties.reduce((n,x)=>n+Math.max(0,Math.min(x.end,weekEnd)-Math.max(x.start,monday))/hour,0);
  const nextHours=duties.reduce((n,x)=>n+Math.max(0,Math.min(x.end,weekEnd+7*day)-Math.max(x.start,weekEnd))/hour,0);
  const firstWeek=hours+(Math.min(r.end,weekEnd)-r.start)/hour;
  const secondWeek=nextHours+Math.max(0,r.end-weekEnd)/hour;
  const crossesWeek=r.end>weekEnd;
  const projected=crossesWeek?Math.max(firstWeek,secondWeek):firstWeek;
  const overtime=Math.max(0,firstWeek-44)-Math.max(0,hours-44)+(crossesWeek?Math.max(0,secondWeek-44)-Math.max(0,nextHours-44):0);
  const shifts=[...duties,r].sort((a,b)=>a.start-b.start);
  const rest=insufficientRest(shifts,r);
  return {rest,projected,ot:overtime,review:(g.id-3000)%23===0};
}
function insufficientRest(shifts,proposed){
  let cycleStart=shifts[0].start;
  let cycle=[];
  const dailyRestFailed=()=>{
    if(!cycle.includes(proposed))return false;
    for(let start=cycleStart;start<cycle.at(-1).end;start+=day){
      const end=start+day;
      let cursor=start,longest=0;
      for(const shift of cycle){
        if(shift.end<=start||shift.start>=end)continue;
        longest=Math.max(longest,shift.start-cursor);
        cursor=Math.max(cursor,Math.min(end,shift.end));
      }
      if(Math.max(longest,end-cursor)<11*hour)return true;
    }
    return false;
  };
  for(const shift of shifts){
    const previous=cycle.at(-1);
    if(previous){
      const gap=shift.start-previous.end;
      if(gap>=day){
        if(dailyRestFailed())return true;
        cycleStart=shift.start;cycle=[];
      }else if((previous===proposed||shift===proposed)&&gap>=0&&gap<8*hour&&previous.end-previous.start+shift.end-shift.start>13*hour)return true;
    }
    cycle.push(shift);
  }
  return dailyRestFailed();
}

function eligibility(g,r,{forSwap=false}={}) {
  const site=siteBy(r.site);
  const remaining=Math.floor((r.start-data.now)/minute);
  const reasons=[];
  if(!forSwap&&g.tier<2&&open(r)>0&&gap(r)>=open(r))reasons.push('Supervisor post required');
  if(r.force&&(g.id-3000)%6===0)reasons.push('MORB / use-of-force record missing');
  if(r.vehicle&&(g.id-3000)%3!==1)reasons.push('Vehicle authorization missing');
  const review=scheduleCheck(g,r);
  if(review.rest)reasons.push('Rest check failed');
  if(review.review)reasons.push('Schedule history needs review');
  if(g.licensedUntil<r.end) reasons.push('Licence expires before shift ends');
  if(g.tier<r.tier) reasons.push('Tier below site requirement');
  if(!g.trained.includes(site.id)) reasons.push('Site training missing');
  if(!g.uniforms.includes(site.uniform)) reasons.push('Required uniform unavailable');
  if((preferencesFor(g.id).unavailable||[]).some(window=>overlaps(window,r)))reasons.push('Unavailable during this period');
  if(!g.available) reasons.push('Marked unavailable');
  if(data.leaves.some(l=>l.guard===g.id&&l.status==='Approved'&&overlaps(l,r))) reasons.push('Approved leave');
  if(r.cancelledGuard===g.id||r.cancelledGuards?.includes(g.id)) reasons.push('Cancelled this shift');
  if(!forSwap&&r.backup?.guard===g.id&&r.backup.status==='Ready')reasons.push('Reserved as standby');
  if(r.assignments.some(a=>a.guard===g.id)) reasons.push('Already assigned here');
  if(data.requests.some(other=>other.id!==r.id&&overlaps(r,other)&&(other.assignments.some(a=>a.guard===g.id)||other.backup?.guard===g.id&&other.backup.status==='Ready'))) reasons.push('Overlapping assignment');
  if(remaining<=0) reasons.push('Shift already started');
  else {
    const response=r.offers[g.id];
    if(r.rush&&response?.status==='Volunteered'){
      const travel=Number.isFinite(response.arrivalAt)?response.arrivalAt-response.at:travelMinutes(g,r)*minute;
      if(data.now+travel>r.start)reasons.push('Departure window passed. Ask the guard for a current ETA.');
    }
  }
  if(open(r)<=0&&!forSwap) reasons.push('All positions filled');
  return reasons;
}

function travelMinutes(g,r){
  const site=siteBy(r.site);
  const areaIndex=['Brampton','Mississauga','Vaughan','Toronto','Markham'].indexOf(site.area);
  return Math.max(5,g.eta+areaIndex*(3+(g.id%8)));
}
const attendanceCache=new WeakMap();
function attendance(g,siteId){
  let index=attendanceCache.get(data);
  if(!index){
    index=new Map();
    const stats=id=>{
      if(!index.has(id))index.set(id,{onTime:0,completed:0,accepted:0,cancelled:0,ratings:new Map(),fit:new Map()});
      return index.get(id);
    };
    for(const r of data.requests){
      for(const event of r.history||[])if(event.status==='Guard cancelled')stats(event.guard).cancelled++;
      if(r.end<=data.now){
        for(const review of r.fitReviews||[]){
          if(review.at<r.end||!r.assignments.some(a=>a.guard===review.guard&&['qr-location','dispatcher'].includes(a.checkIn?.method)))continue;
          const fit=stats(review.guard).fit;
          const previous=fit.get(r.site)||new Map();
          const scores=previous.get(r.id)||[];
          scores.push(review.verdict==='Good fit'?1:review.verdict==='Needs coaching'?0.5:0);
          previous.set(r.id,scores);
          fit.set(r.site,previous);
        }
      }
      for(const assignment of r.assignments){
        const record=stats(assignment.guard);
        if(assignment.review){
          record.completed++;
          if(assignment.review.arrival==='On time')record.onTime++;
          if(assignment.review.report==='Accepted')record.accepted++;
        }
        if(r.clientFeedback){
          const scores=record.ratings.get(r.site)||[];
          scores.push(r.clientFeedback.rating);
          record.ratings.set(r.site,scores);
        }
      }
    }
    attendanceCache.set(data,index);
  }
  const recorded=index.get(g.id);
  const onTime=g.onTime+(recorded?.onTime||0),completed=g.completed+(recorded?.completed||0);
  const rate=onTime/completed;
  const reports=(g.reportRecord.accepted+(recorded?.accepted||0))/(g.reportRecord.reviewed+(recorded?.completed||0));
  const cancellations=g.priorCancellations+(recorded?.cancelled||0);
  const showUp=completed/(completed+cancellations);
  const scores=recorded?.ratings.get(siteId)||[];
  const feedback=scores.length?scores.reduce((sum,rating)=>sum+rating,0)/scores.length:null;
  const base=(rate*.4+reports*.25+showUp*.2)/.85;
  const feedbackWeight=.15*Math.min(scores.length/3,1);
  const fitShifts=[...(recorded?.fit.get(siteId)?.values()||[])];
  const fitScores=fitShifts.map(items=>items.reduce((total,value)=>total+value,0)/items.length);
  const fitAverage=fitScores.length?fitScores.reduce((total,value)=>total+value,0)/fitScores.length:null;
  const fitAdjustment=fitAverage===null?0:(fitAverage-.5)*16*Math.min(fitScores.length/3,1);
  const score=Math.min(100,Math.max(0,(base*(1-feedbackWeight)+(feedback===null?0:(feedback-1)/4)*feedbackWeight)*100+fitAdjustment));
  return {onTime,completed,rate,reports,cancellations,feedback,feedbackCount:scores.length,fitCount:fitScores.length,fitAdjustment,score};

}
const sortedGuards=r=>[...guards].sort((a,b)=>attendance(b,r.site).score-attendance(a,r.site).score||travelMinutes(a,r)-travelMinutes(b,r)||a.id-b.id);
const audit=(message)=>data.log.unshift({at:data.now,message});
const offerFor=(r,g)=>r.offers[g.id];
const waiting=(r)=>Object.values(r.offers).filter(o=>o.status==='Volunteered').length;
const preferencesFor=(id)=>data.profiles[id]||defaultPreferences;
const activeOffer=(o)=>o?.status==='Invited'&&o.expires>data.now&&(!o.replyDeadline||o.replyDeadline>Date.now());
const availableForWave=(r)=>sortedGuards(r).filter(g=>!offerFor(r,g)&&(!r.rush||preferencesFor(g.id).rush)&&!eligibility(g,r).length);

function preferenceMatches(g,r,projected) {
  const {days,blocks:preferred,maxHours}=preferencesFor(g.id);
  const weekday=weekdays[(new Date(inputDate(r.start)+'T12:00Z').getUTCDay()+6)%7];
  const startHour=Number(inputTime(r.start).slice(0,2));
  const block=startHour>=6&&startHour<12?'Morning':startHour>=12&&startHour<18?'Afternoon':'Overnight';
  return days.includes(weekday)&&preferred.includes(block)&&projected<=maxHours;
}

function insist(condition,message) {if(!condition) throw new Error(message);}

function volunteer(r,g,arrivalMinutes) {
  const existing=offerFor(r,g);
  const updating=existing?.status==='Volunteered';
  if(updating&&!Number.isFinite(arrivalMinutes))return 'Your response is already awaiting approval.';
  insist(!existing||updating||activeOffer(existing),'The offer expired. Check the open shift list.');
  if(updating)r.offers[g.id]={...existing,at:data.now,arrivalAt:data.now+arrivalMinutes*minute};
  const failures=eligibility(g,r);
  insist(!failures.length,failures.join(' · '));
  const arrivalAt=Number.isFinite(arrivalMinutes)?data.now+arrivalMinutes*minute:null;
  const needsEta=r.offers[g.id]?.verifyArrival||travelMinutes(g,r)+10>(r.start-data.now)/minute;
  insist(!r.rush||!needsEta||arrivalAt!==null,'Confirm your travel time before volunteering.');
  insist(arrivalAt===null||arrivalAt<=r.start,'This arrival time misses the shift start.');
  r.offers[g.id]={...existing,status:'Volunteered',at:data.now,arrivalAt};
  audit(`${g.name} volunteered for ${siteBy(r.site).name}.`);
  return 'Response sent. The shift appears on your schedule after administrator approval.';
}

function closeOffers(r) {
  for(const o of Object.values(r.offers)) if(['Invited','Volunteered'].includes(o.status)) o.status='Closed';
}

function recordEvent(r,status,guard){
  (r.history ||= []).push({at:data.now,status,guard});
}
function autoWave(r){
  if(r.rush&&open(r)>0&&!isPast(r)&&availableForWave(r).length)sendWave(r);
}
function chooseBackup(r,guardId,post){
  const g=guardBy(guardId);
  insist(g&&!isPast(r)&&r.need>0,'Choose a guard for an upcoming shift.');
  insist(!r.backup||!['Invited','Ready'].includes(r.backup.status),'Release the existing standby first.');
  insist(['General','Supervisor'].includes(post),'Choose a standby post.');
  insist(post==='General'||r.supervisors&&g.tier===2,'A qualified supervisor and supervisor post are required.');
  const failures=eligibility(g,r,{forSwap:true});
  insist(!failures.length,failures.join(' · '));
  r.backup={guard:g.id,post,status:'Invited',at:data.now};
  recordEvent(r,'Standby invited',g.id);
  return 'Standby invitation listed for the guard.';
}

function activateBackup(r){
  const backup=r.backup;
  insist(backup?.status==='Ready'&&open(r)>0,'An accepted standby and an open post are required.');
  insist(backup.post==='Supervisor'?gap(r)>0:open(r)>gap(r),'The open post does not match the standby role.');
  const g=guardBy(backup.guard);
  const failures=eligibility(g,r,{forSwap:true});
  insist(!failures.length,failures.join(' · '));
  insist(travelMinutes(g,r)*minute<=r.start-data.now,'Standby travel estimate misses this start. Contact the guard or move the recovery start.');
  r.assignments.push({guard:g.id,post:backup.post,at:data.now});
  backup.status='Activated';
  if(!open(r)){closeOffers(r);delete r.followUp;r.escalated=false;}
  recordEvent(r,'Standby approved',g.id);
  audit(g.name+' activated from standby at '+siteBy(r.site).name+'.');
  return 'Standby guard approved for the shift.';
}

function assign(r,g,post=g.tier===2&&gap(r)?'Supervisor':'General') {
  const failures=eligibility(g,r);
  insist(!failures.length,failures.join(' · '));
  insist(offerFor(r,g)?.status==='Volunteered','This guard has not volunteered.');
  insist(post==='Supervisor'?g.tier===2&&gap(r)>0:open(r)>gap(r),'This guard cannot fill the proposed post.');
  r.assignments.push({guard:g.id,post,at:data.now});
  offerFor(r,g).status='Approved';recordEvent(r,'Approved',g.id);
  if(!open(r)){closeOffers(r);delete r.followUp;r.escalated=false;}
  audit(`${g.name} approved and notified for ${siteBy(r.site).name}.`);
}

function cancelAssignment(r,g,reason='Guard cancelled') {
  insist(!isPast(r),'This shift has already started.');
  const index=r.assignments.findIndex(a=>a.guard===g.id);
  insist(index!==-1,'This assignment is already open.');
  r.assignments.splice(index,1);
  for(const s of data.swaps)if(s.shift===r.id&&s.guard===g.id&&s.status==='Pending')s.status='Declined';
  r.cancelledGuards=[...new Set([...(r.cancelledGuards||[]),r.cancelledGuard,g.id].filter(Boolean))];
  r.cancelledGuard=g.id;
  for(const [id,o] of Object.entries(r.offers))if(o.status==='Closed')delete r.offers[id];
  if(offerFor(r,g)) offerFor(r,g).status='Cancelled';
  recordEvent(r,reason,g.id);
  r.replacement=true;
  r.rush ||= r.start-data.now<=2*hour;
  autoWave(r);
  audit(`${g.name} ${reason.toLowerCase()}. A position reopened at ${siteBy(r.site).name}.`);
}

function assignedSupervisor(r,id){
  return Boolean(r?.assignments.some(a=>a.guard===id&&a.post==='Supervisor')&&guardBy(id)?.tier===2);
}

function attendanceWindow(r,now){
  return r&&now>=r.start-15*minute&&now<r.end;
}

function recordQrArrival(snapshot,{requestId,guard,issuer,distance,accuracy,now}){
  const next=structuredClone(snapshot);
  const r=next.requests.find(request=>request.id===requestId);
  insist(attendanceWindow(r,now),'Check-in is closed for this shift.');
  insist(assignedSupervisor(r,issuer),'The issuing supervisor is no longer assigned.');
  const assignment=r.assignments.find(a=>a.guard===guard);
  insist(assignment,'You are not assigned to this shift.');
  if(assignment.checkIn?.method==='qr-location')return {state:snapshot,message:'Your verified check-in is already recorded.'};
  assignment.checkIn={at:now,source:'Supervisor QR + location',method:'qr-location',issuer,distance,accuracy};
  r.arrivalFollowUp=r.assignments.every(a=>a.checkIn)?null:r.arrivalFollowUp;
  (r.history ||= []).push({at:now,status:'QR and location checked',guard});
  versionRequests(snapshot,next);
  return {state:next,message:'Check-in verified with supervisor QR and location.'};
}

const fitSignals=['Site orientation','Role readiness','Communication','Procedure knowledge','Team coordination'];

function supervisorReview(r,reviewer,fields){
  insist(assignedSupervisor(r,reviewer)&&data.now>=r.start-4*hour&&data.now<=r.end+7*day,'Only the assigned supervisor can review this crew.');
  const guard=Number(fields.guard);
  insist(guard!==reviewer&&guardBy(guard)&&(r.assignments.some(a=>a.guard===guard)||r.offers[guard]?.status==='Volunteered'),'Select an assigned or volunteered guard from this shift.');
  const verdict=fields.verdict;
  insist(['Good fit','Needs coaching','Needs review'].includes(verdict)&&fitSignals.includes(fields.signal),'Choose a fit assessment and observed skill.');
  const note=String(fields.note||'').trim().slice(0,300);
  insist(note,'Describe what you observed.');
  const reviews=(r.fitReviews||[]).filter(entry=>entry.guard!==guard||entry.reviewer!==reviewer);
  r.fitReviews=[...reviews,{guard,reviewer,verdict,signal:fields.signal,note,at:data.now}];
  attendanceCache.delete(data);
  recordEvent(r,'Supervisor fit review saved',guard);
  return 'Supervisor feedback saved for dispatch.';
}
function checkIn(r,id,source){
  const assignment=r.assignments.find(a=>a.guard===id);
  insist(assignment&&data.now>=r.start-15*minute&&data.now<r.end,'Check-in opens 15 minutes before the shift and closes at shift end.');
  if(assignment.checkIn)return 'Arrival already recorded.';
  assignment.checkIn={at:data.now,source,method:source==='Guard'?'self-reported':'dispatcher'};
  recordEvent(r,'Checked in',id);
  return 'Arrival recorded.';
}

function recoverNoShow(r,id){
  const assignment=r.assignments.find(a=>a.guard===id);
  insist(assignment&&!assignment.checkIn&&data.now>=r.start&&r.end>data.now,'Choose an unarrived guard on a shift in progress.');
  r.assignments=r.assignments.filter(a=>a!==assignment);
  (r.noShows ||= []).push({...assignment,reportedAt:data.now,reportedBy:view.contact});
  recordEvent(r,'No-show reported',id);
  if(r.end-data.now<=5*minute)return 'No-show recorded. Less than five minutes remain.';
  const lead=Math.min(30*minute,Math.floor((r.end-data.now)/2));
  const recovery=newRequest(data.next++,r.site,data.now+lead,r.end-data.now-lead,1,r.tier,true,r.notes);
  Object.assign(recovery,{recoveryOf:r.id,supervisors:Number(assignment.post==='Supervisor'),dress:r.dress,force:r.force,vehicle:r.vehicle,cancelledGuards:[id]});
  if(r.backup?.status==='Ready'&&r.backup.post===assignment.post){
    recovery.backup={...r.backup};
    r.backup.status='Released';
    const eta=travelMinutes(guardBy(recovery.backup.guard),recovery);
    if(eta*minute>lead)recovery.backup.status='Invited';
  }
  data.requests.push(recovery);
  recordEvent(recovery,'Recovery opened',id);
  autoWave(recovery);
  openRequest(recovery);
  return 'No-show recorded. A replacement request is open for the remaining shift.';
}

function sendWave(r,broadcast=false) {
  const pool=availableForWave(r);
  const viable=pool.filter(g=>travelMinutes(g,r)+10<(r.start-data.now)/minute);
  const general=r.rush&&viable.length?[...viable,...pool.filter(g=>!viable.includes(g))]:pool;
  const specialists=general.filter(g=>g.tier===2).slice(0,gap(r)*2);
  const ranked=[...specialists,...general.filter(g=>!specialists.includes(g))];
  insist(pool.length,'No new eligible guards. Review the exclusions and escalate if needed.');
  const invited=broadcast===true?ranked:ranked.slice(0,Math.min(24,Math.max(3,2*open(r))));
  for(const g of invited){
    const departure=r.start-(travelMinutes(g,r)+10)*minute;
    const verifyArrival=r.rush&&departure<=data.now;
    const expires=Math.min(r.start,r.rush&&!verifyArrival?departure:Infinity,data.now+(r.rush?5:60)*minute);
    r.offers[g.id]={status:'Invited',at:data.now,expires,replyDeadline:r.rush?expires:null,verifyArrival};
  }
  r.alertCount+=1;recordEvent(r,'Seeking cover');
  audit(`Offer wave ${r.alertCount} sent to ${invited.length} eligible guards.`);
  return `${invited.length} offers sent. Responses will appear in this request.`;
}

function eligibleSwaps(l) {
  const r=byId(l.shift);
  const assignment=r?.assignments.find(a=>a.guard===l.guard);
  if(!assignment||isPast(r))return [];
  return guards.filter(g=>(assignment.post!=='Supervisor'||g.tier===2)&&g.id!==l.guard&&!eligibility(g,r,{forSwap:true}).length);
}

function resolveChange(type,id,approve) {
  insist(type==='leave'||type==='swap','Choose a valid schedule change.');
  const item=(type==='leave'?data.leaves:data.swaps).find(x=>x.id===Number(id));
  insist(item?.status==='Pending','This item was already reviewed.');
  const g=guardBy(item.guard);
  if(approve&&type==='leave') {
    const affected=data.requests.filter(r=>!isPast(r)&&overlaps(item,r)&&r.assignments.some(a=>a.guard===g.id));
    for(const r of affected) cancelAssignment(r,g,'Released for approved leave');
    audit(`Leave approved for ${g.name}. ${affected.length} future shift positions reopened.`);
  }
  if(approve&&type==='swap') {
    const r=byId(item.shift);
    const index=r.assignments.findIndex(a=>a.guard===g.id);
    insist(index>=0,'The original assignment has changed.');
    insist(item.accepted,'The proposed guard must accept first.');
    insist(eligibleSwaps(item).some(x=>x.id===item.target),'The replacement no longer meets the shift requirements.');
    r.assignments[index]={guard:item.target,post:r.assignments[index].post,at:data.now};
    recordEvent(r,'Swap approved',item.target);
    audit(`Swap approved from ${g.name} to ${guardBy(item.target).name}.`);
  }
  if(!approve) audit(`${type==='swap'?'Swap':'Leave'} declined for ${g.name}.`);
  item.status=approve?'Approved':'Declined';
  return `${type==='swap'?'Swap':'Leave'} ${item.status.toLowerCase()}.`;
}

function reviewBatch(r) {
  const selected=sortedGuards(r).sort((a,b)=>Number(b.tier===2)-Number(a.tier===2)).filter(g=>view.checked.has(g.id)&&offerFor(r,g)?.status==='Volunteered');
  let approved=0;
  for(const g of selected) {
    if(eligibility(g,r).length) continue;
    assign(r,g);
    approved++;
  }
  view.checked.clear();
  return `${approved} approved · ${selected.length-approved} skipped · ${open(r)} positions still open.`;
}

function openRequest(r) {
  view.selected=r.id;
  view.checked.clear();
}

const adminActions={
  wave:r=>sendWave(r),
  broadcast:r=>sendWave(r,true),
  'activate-backup':activateBackup,
  'no-show':(r,_,id)=>recoverNoShow(r,Number(id)),
  'verify-arrival':(r,_,id)=>checkIn(r,Number(id),view.contact),
  'release-backup':r=>{insist(r.backup?.status==='Ready'||r.backup?.status==='Invited','No active standby.');if(r.offers[r.backup.guard]?.status==='Standby')delete r.offers[r.backup.guard];r.backup.status='Released';recordEvent(r,'Standby released',r.backup.guard);return 'Standby released.';},
  escalate:r=>{
    insist(open(r)>0,'This request is already staffed.');
    r.escalated=true;
    r.followUp={owner:view.contact,at:data.now,due:Math.max(data.now,Math.min(r.start,data.now+5*minute))};
    audit(view.contact+' took responsibility for follow-up at '+siteBy(r.site).name+'.');
    return 'You own the follow-up.';
  },
  approve:(r,_,extra)=>{assign(r,guardBy(extra));return 'Guard approved. Confirmation is visible in their guard view.';},
  batch:reviewBatch,
  cancel:(r,_,extra)=>{cancelAssignment(r,guardBy(extra),'Removed by dispatch');return 'The position is open again.';},
  'accept-change':(_,id,extra)=>resolveChange(extra,id,true),
  'deny-change':(_,id,extra)=>resolveChange(extra,id,false)
};

const guardActions={
  'standby-accept':r=>{
    const b=r.backup;
    insist(b?.guard===view.guard&&b.status==='Invited','Standby invitation unavailable.');
    const failures=eligibility(guardBy(view.guard),r,{forSwap:true});
    insist(!failures.length,failures.join(' · '));
    if(offerFor(r,guardBy(view.guard)))r.offers[view.guard].status='Standby';
    b.status='Ready';recordEvent(r,'Standby accepted',view.guard);return 'You are on standby. Wait for dispatch before travelling.';
  },
  'standby-decline':r=>{
    const b=r.backup;
    insist(b?.guard===view.guard&&['Invited','Ready'].includes(b.status)&&!isPast(r),'Standby invitation unavailable.');
    if(r.offers[view.guard]?.status==='Standby')delete r.offers[view.guard];
    b.status='Declined';recordEvent(r,'Standby declined',view.guard);return 'Standby declined.';
  },
  'check-in':r=>checkIn(r,view.guard,'Guard'),
  ack:r=>{const a=r.assignments.find(a=>a.guard===view.guard);insist(a&&r.end>data.now,'Current assignment required.');a.ack=data.now;audit(guardBy(view.guard).name+' acknowledged the site brief.');return 'Acknowledgment recorded.';},
  pool:r=>{insist(!isPast(r)&&r.assignments.some(a=>a.guard===view.guard),'Upcoming assignment required.');insist(!data.swaps.some(s=>s.shift===r.id&&s.guard===view.guard&&s.status==='Pending'),'There is already a pending swap for this assignment.');data.swaps.push({id:data.next++,shift:r.id,guard:view.guard,target:null,status:'Pending',accepted:false});recordEvent(r,'Swap requested',view.guard);audit('Swap opened to eligible peers.');return 'Pool open. Your assignment stays active until approval.';},
  claim:(_,id)=>{
    const s=data.swaps.find(x=>x.id===Number(id));
    insist(s&&s.status==='Pending'&&!s.target&&eligibleSwaps(s).some(x=>x.id===view.guard),'Swap unavailable.');
    s.target=view.guard;
    s.accepted=true;
    s.claimedFromPool=true;
    return 'Claim sent for approval.';
  },

  volunteer:(r,_,extra)=>{
    const g=guardBy(view.guard);
    insist(!r.rush||offerFor(r,g)?.status==='Volunteered'||(!offerFor(r,g)&&preferencesFor(g.id).rush)||activeOffer(offerFor(r,g)),'An active offer is required for this urgent shift.');
    const estimate=extra===''||extra===undefined?null:Number(extra);
    insist(estimate===null||Number.isFinite(estimate)&&estimate>=0&&estimate<=180,'Enter travel time between 0 and 180 minutes.');
    return volunteer(r,g,estimate);
  },
  decline:(r)=>{
    const g=guardBy(view.guard);
    const offer=offerFor(r,g);
    const canDeclineAnnouncement=!offer&&companyAlertUntil(r,data.now)&&(!r.rush||preferencesFor(g.id).rush)&&!eligibility(g,r).length;
    insist(activeOffer(offer)||canDeclineAnnouncement,'This offer is no longer active.');
    r.offers[g.id]={...offer,status:'Declined',at:data.now};
    recordEvent(r,'Rejected offer',g.id);
    audit(`${g.name} declined an offer.`);
    return 'Offer declined.';
  },
  'guard-cancel':(r)=>{cancelAssignment(r,guardBy(view.guard));return 'Cancellation recorded. Dispatch can now find cover.';},
  'accept-swap':(_,id)=>{
    const s=data.swaps.find(x=>x.id===Number(id)&&x.target===view.guard&&x.status==='Pending');
    insist(s,'This proposal is no longer available.');
    insist(eligibleSwaps(s).some(g=>g.id===view.guard),'You are no longer eligible for this shift.');
    s.accepted=true;
    audit(`${guardBy(view.guard).name} accepted a swap proposal.`);
    return 'Acceptance sent for administrator approval.';
  }
};

function createRequest(form) {
  const site=siteBy(form.get('site'));
  const start=localTime(form.get('date'),form.get('time'));
  const length=Number(form.get('hours'))*hour;
  const count=Number(form.get('count'));
  const tier=Number(form.get('tier'));
  insist(site?.client===view.client,'Choose a site belonging to this client.');
  insist(start>data.now,'Choose a start time after the current time.');
  insist(length>=hour/2&&length<=24*hour&&Number.isInteger(count)&&count>=1&&count<=120&&tiers[tier],'Check duration, guard count, and tier.');
  const r=newRequest(data.next++,site.id,start,length,count,tier,form.get('rush')==='urgent'||start-data.now<=2*hour,String(form.get('notes')||'').slice(0,400));
  r.contact=view.contact; r.dress=String(form.get('dress')||'').slice(0,160);r.source=['Phone','Email'].includes(form.get('source'))?form.get('source'):'Portal';
  r.supervisors=Number(form.get('supervisors')||0);insist(Number.isInteger(r.supervisors)&&r.supervisors>=0&&r.supervisors<=count,'Supervisor posts must fit inside total headcount.');r.force=Boolean(form.get('force'));r.vehicle=Boolean(form.get('vehicle'));
  data.requests.push(r);recordEvent(r,'Received');autoWave(r);
  openRequest(r);
  audit(`${clients[view.client]} submitted a ${r.rush?'rush':'regular'} request for ${count} guards.`);
  view.template=null;
  view.prefill={};
  return 'Request submitted. Coverage will update here as assignments are approved.';
}

function leaveRange(first,last,now,leaves) {
  insist(/^\d{4}-\d{2}-\d{2}$/.test(first)&&/^\d{4}-\d{2}-\d{2}$/.test(last)&&first>=inputDate(now)&&last>=first,'Choose valid leave dates.');
  const start=localTime(first,'00:00');
  localTime(last,'00:00');
  const end=localTime(calendarDate(last,1),'00:00');
  insist(!leaves.some(l=>l.status!=='Declined'&&overlaps(l,{start,end})),'An existing leave request overlaps those dates.');
  return {start,end};
}

function requestLeave(form) {
  const {start,end}=leaveRange(form.get('first'),form.get('last'),data.now,data.leaves.filter(l=>l.guard===view.guard));
  data.leaves.push({id:data.next++,guard:view.guard,start,end,status:'Pending'});
  audit(`${guardBy(view.guard).name} requested leave.`);
  return 'Leave sent for administrator review.';
}

function requestSwap(form,shift) {
  const r=byId(shift);
  const target=Number(form.get('target'));
  insist(r?.assignments.some(a=>a.guard===view.guard),'Only the assigned guard can propose a swap.');
  insist(eligibleSwaps({shift:r.id,guard:view.guard}).some(g=>g.id===target),'That guard is no longer eligible.');
  insist(!data.swaps.some(s=>s.shift===r.id&&s.guard===view.guard&&s.status==='Pending'),'There is already a pending swap for this assignment.');
  data.swaps.push({id:data.next++,shift:r.id,guard:view.guard,target,status:'Pending',accepted:false});
  recordEvent(r,'Swap requested',view.guard);audit(`${guardBy(view.guard).name} proposed a swap.`);
  return 'Swap proposed. Your assignment stays active while it is under review.';
}

function savePreferences(fields) {
  const {days,blocks:preferred,maxHours,rush}=fields;
  insist(Array.isArray(days)&&days.every(day=>weekdays.includes(day))&&Array.isArray(preferred)&&preferred.every(block=>blocks.includes(block)),'Choose valid working days and shift blocks.');
  insist(Number.isFinite(maxHours)&&maxHours>=1&&maxHours<=168&&typeof rush==='boolean','Choose a weekly hours target from 1 to 168.');
  data.profiles[view.guard]={...preferencesFor(view.guard),days:[...new Set(days)],blocks:[...new Set(preferred)],maxHours,rush,standby:fields.standby??preferencesFor(view.guard).standby??false};
  return 'Working preferences saved.';
}

function project(snapshot,account) {
  data=migrate(snapshot); data.now=Date.now();
  if(account.role==='admin')return {state:data,catalog:{sites,clients,guards}};
  if(account.role==='client'){
    const clientSites=sites.filter(site=>site.client===account.client);
    const requests=data.requests.filter(r=>siteBy(r.site).client===account.client).map(r=>{
      const {id,site,start,end,need,tier,rush,notes,supervisors,force,vehicle,replacement,contact}=r;
      return {id,version:r.version||0,site,start,end,need,tier,rush,notes,supervisors,force,vehicle,replacement,contact,receivedAt:r.history?.find(event=>event.status==='Received')?.at,timeline:(r.history||[]).filter(e=>['Received','Seeking cover','Approved','Guard cancelled','Removed by dispatch','Released for approved leave','Revised shift listed','Rescheduled by dispatch','No-show reported','Recovery opened'].includes(e.status)).map(e=>({at:e.at,status:['Guard cancelled','Removed by dispatch','Released for approved leave'].includes(e.status)?'Post reopened':e.status})),feedback:r.clientFeedback?{rating:r.clientFeedback.rating,at:r.clientFeedback.at}:null,dress:r.dress,source:r.source,progress:!r.need?'Rescheduled':r.assignments.length===r.need?'Fully staffed':r.assignments.length?'Partially staffed':r.alertCount?'Seeking cover':'Listed for guards',updated:r.history?.at(-1)?.at,supervisorGap:gap(r),confirmed:r.assignments.length};
    });
    return {state:{now:data.now,requests},catalog:{sites:clientSites,clients:{[account.client]:clients[account.client]},guards:[]}};
  }
  const g=guardBy(account.guard);
  const requests=[],companyAnnouncements=[];
  for(const r of data.requests){
    const mine=r.assignments.find(a=>a.guard===g.id);
    const offer=offerFor(r,g);
    const invited=activeOffer(offer);
    const volunteered=offer?.status==='Volunteered'&&!isPast(r);
    const announcementUntil=companyAlertUntil(r,data.now);
    if(announcementUntil&&!mine&&!volunteered&&offer?.status!=='Declined'){
      companyAnnouncements.push({id:r.id,until:announcementUntil});
    }
    const needsArrivalCheck=r.rush&&(offer?.verifyArrival||travelMinutes(g,r)+10>(r.start-data.now)/minute);
    const canVolunteer=(!offer&&(!r.rush||preferencesFor(g.id).rush)||invited)&&!eligibility(g,r).length;
    const supervisory=assignedSupervisor(r,g.id)&&data.now>=r.start-4*hour&&data.now<=r.end+7*day;
    const crew=supervisory?[...new Set([...r.assignments.map(a=>a.guard),...Object.keys(r.offers).filter(id=>r.offers[id].status==='Volunteered').map(Number)])].filter(id=>id!==g.id).map(id=>{
      const person=guardBy(id);
      const assigned=r.assignments.find(a=>a.guard===id);
      return {id,name:person.name,tier:person.tier,post:assigned?.post,checkedIn:assigned?.checkIn?.method||null,review:r.fitReviews?.find(item=>item.guard===id&&item.reviewer===g.id)||null};
    }):null;
    const pendingSwap=data.swaps.some(s=>s.shift===r.id&&s.guard===g.id&&s.status==='Pending');
    const backup=r.backup?.guard===g.id&&!isPast(r)&&['Invited','Ready'].includes(r.backup.status)?{status:r.backup.status,post:r.backup.post}:null;
    if(!(mine&&r.end>data.now)&&!invited&&!volunteered&&!canVolunteer&&!backup&&!supervisory)continue;
    const {area,uniform,name,notes}=siteBy(r.site);
    const location=mine?{area,uniform,name,notes,brief:r.notes,dress:r.dress,coordinates:siteBy(r.site).coordinates}:{area,uniform,dress:r.dress};
    const peers=mine&&!pendingSwap?eligibleSwaps({shift:r.id,guard:g.id}).map(({id,name})=>({id,name})):[];
    requests.push({id:r.id,version:r.version||0,start:r.start,end:r.end,rush:r.rush,location,eta:travelMinutes(g,r),mine,crew,supervisory,backup,needsArrivalCheck,offer:invited||volunteered?offer:null,canVolunteer,announcementUntil,pendingSwap,peers});
  }
  const poolSwaps=data.swaps.filter(s=>s.status==='Pending'&&!s.target&&eligibleSwaps(s).some(peer=>peer.id===g.id)).map(s=>{
    const {start,end,site}=byId(s.shift);
    const {area,uniform}=siteBy(site);
    return {id:s.id,start,end,location:{area,uniform}};
  });
  const swaps=data.swaps.filter(s=>s.guard===g.id||s.target===g.id).map(s=>({
    id:s.id,start:byId(s.shift).start,status:s.status,incoming:s.target===g.id,accepted:s.accepted,claimedFromPool:s.claimedFromPool,
    peer:guardBy(s.target===g.id?s.guard:s.target)?.name
  }));
  const notices=data.requests.flatMap(r=>(r.history||[]).filter(e=>e.guard===g.id&&['Removed by dispatch','Rescheduled by dispatch','Released for approved leave'].includes(e.status)).map(e=>({at:e.at,status:e.status,site:siteBy(r.site).name,start:r.start}))).sort((a,b)=>b.at-a.at).slice(0,5);
  const state={now:data.now,notices,requests,companyAnnouncements,poolSwaps,swaps,leaves:data.leaves.filter(l=>l.guard===g.id),profile:preferencesFor(g.id),eta:g.eta};
  return {state,catalog:{sites:[],clients:{},guards:[]}};
}

const requestActions=new Set(['wave','broadcast','no-show','verify-arrival','check-in','activate-backup','release-backup','standby-accept','standby-decline','escalate','approve','batch','cancel','ack','pool','volunteer','decline','guard-cancel','choose-backup','supervisor-review','feedback','review-duty','call-note']);

function canApplyCommand(snapshot,command,revision){
  if(command.revision===revision||command.action==='create-request')return true;
  const r=snapshot.requests.find(request=>request.id===Number(command.id));
  return requestActions.has(command.action)&&r&&Number.isInteger(command.requestVersion)&&command.requestVersion===(r.version||0);
}

function versionRequests(previous,next){
  const prior=new Map(previous.requests.map(r=>[r.id,r]));
  for(const r of next.requests){
    const old=prior.get(r.id);
    if(old&&JSON.stringify(old)!==JSON.stringify(r))r.version=(old.version||0)+1;
    else if(!old)r.version=0;
  }
}

function tickDispatch(snapshot,now=Date.now(),owner='Duty dispatcher'){
  data=migrate(structuredClone(snapshot));
  data.now=now;
  let changed=false;
  for(const r of data.requests){
    if(r.end<=now)continue;
    if(r.start<=now){
      if(r.assignments.some(a=>!a.checkIn)&&!r.arrivalFollowUp&&r.start+5*minute<=now){
        r.arrivalFollowUp=now;
        r.arrivalFollowUpOwner=owner;
        recordEvent(r,'Arrival not verified');
        changed=true;
      }
      continue;
    }
    if(!r.backup&&r.supervisors===1&&r.start-now<=2*hour){
      const candidate=sortedGuards(r).find(g=>g.tier===2&&preferencesFor(g.id).standby&&travelMinutes(g,r)+10<(r.start-now)/minute&&!eligibility(g,r,{forSwap:true}).length);
      if(candidate){chooseBackup(r,candidate.id,'Supervisor');changed=true;}
    }
    if(!r.rush||!open(r)||r.followUp)continue;
    const active=Object.values(r.offers).some(activeOffer);
    const replies=guards.filter(g=>offerFor(r,g)?.status==='Volunteered'&&!eligibility(g,r).length);
    const ready=replies.length>0;
    const earliestDecision=Math.min(...replies.map(g=>{
      const offer=offerFor(r,g);
      const travel=offer.arrivalAt===null||offer.arrivalAt===undefined?travelMinutes(g,r):(offer.arrivalAt-offer.at)/minute;
      return r.start-(travel+10)*minute;
    }));
    const pool=availableForWave(r);
    const viable=pool.filter(g=>travelMinutes(g,r)+10<(r.start-now)/minute);
    if(!active&&!ready&&viable.length){
      sendWave(r);changed=true;continue;
    }
    const urgentReview=earliestDecision<=now||r.start-now<=10*minute||!active&&!ready&&!viable.length;
    const standbyReady=r.backup?.status==='Ready'&&(r.backup.post==='Supervisor'?gap(r)>0:open(r)>gap(r));
    if((urgentReview||standbyReady)&&!r.escalated){
      r.escalated=true;
      r.followUp={owner,at:now,due:now,automatic:true};
      recordEvent(r,standbyReady?'Review standby for vacancy':'Manual follow-up due');
      changed=true;
    }
  }
  if(!changed)return null;
  versionRequests(snapshot,data);
  return data;
}

function coveragePlan(){
  const slots=[];
  for(const r of data.requests){
    if(isPast(r)||r.start-data.now>4*hour||!open(r))continue;
    const volunteers=sortedGuards(r).filter(g=>offerFor(r,g)?.status==='Volunteered'&&!eligibility(g,r,{forSwap:true}).length);
    for(const post of ['Supervisor','General']){
      const total=post==='Supervisor'?gap(r):open(r)-gap(r);
      if(total<=0)continue;
      const b=r.backup;
      const standby=b?.status==='Ready'&&b.post===post&&travelMinutes(guardBy(b.guard),r)*minute<=r.start-data.now&&!eligibility(guardBy(b.guard),r,{forSwap:true}).length?guardBy(b.guard):null;
      const candidates=[...(standby?[standby]:[]),...volunteers.filter(g=>post!=='Supervisor'||g.tier===2)];
      if(candidates.length)for(let index=0;index<Math.min(total,24);index++)slots.push({r,post,candidates});
    }
  }
  slots.sort((a,b)=>Number(b.post==='Supervisor')-Number(a.post==='Supervisor')||a.candidates.length-b.candidates.length||a.r.start-b.r.start);
  const choices=[];
  for(const slot of slots){
    const {r,post,candidates}=slot;
    const g=candidates.find(candidate=>!choices.some(choice=>{
      if(choice.guard!==candidate.id)return false;
      const other=byId(choice.request);
      const spacing=Math.max(other.start-r.end,r.start-other.end);
      return overlaps(r,other)||spacing<(travelMinutes(candidate,r)+10)*minute;
    }));
    if(g)choices.push({request:r.id,guard:g.id,post,reason:candidates.length===1?'Only eligible '+post.toLowerCase():post==='Supervisor'?'Supervisor vacancy takes priority':'Best eligible remaining volunteer'});
    if(choices.length>=24)break;
  }
  return choices;
}

function approveCoveragePlan(expected){
  const plan=coveragePlan();
  insist(Array.isArray(expected)&&plan.length&&JSON.stringify(expected)===JSON.stringify(plan.map(({request,guard,post})=>({request,guard,post}))),'The recommendation changed. Review the current plan.');
  for(const choice of plan){
    const r=byId(choice.request),g=guardBy(choice.guard);
    if(r.backup?.guard===g.id&&r.backup.status==='Ready'&&r.backup.post===choice.post)activateBackup(r);
    else assign(r,g,choice.post);
  }
  return plan.length+' assignments approved.';
}

if(typeof module!=='undefined') module.exports={
  seed,migrate,project,tickDispatch,canApplyCommand,assignedSupervisor,attendanceWindow,recordQrArrival,
  execute(snapshot, command, account) {
    data=migrate(structuredClone(snapshot)); data.now=Date.now();
    const {role,client,guard,name:contact}=account;
    const {action,id,extra,fields={}}=command;
    Object.assign(view,{role,client,guard,contact,checked:new Set(role==='admin'&&Array.isArray(command.checked)?command.checked:[])});
    const form=new Map(Object.entries(fields));
    const shift=byId(id);
    let message;
    if(role==='guard'&&action==='supervisor-review')message=supervisorReview(shift,guard,fields);
    else if(role==='admin'&&action==='approve-plan')message=approveCoveragePlan(fields.plan);
    else if(role==='client'&&action==='feedback'){
      insist(shift&&siteBy(shift.site).client===client&&shift.end<=data.now&&shift.assignments.length,'Feedback is available after a staffed shift ends.');
      const rating=Number(fields.rating);
      insist(Number.isInteger(rating)&&rating>=1&&rating<=5&&!shift.clientFeedback,'Choose a rating from 1 to 5. Each shift accepts one response.');
      shift.clientFeedback={rating,note:String(fields.note||'').slice(0,300),at:data.now};
      recordEvent(shift,'Client feedback received');
      message='Feedback recorded.';
    }else if(role==='admin'&&action==='choose-backup'){
      insist(shift,'Shift unavailable.');
      message=chooseBackup(shift,Number(fields.guard),fields.post);
    }else if(role==='admin'&&action==='adjust-assignment'){
      const g=guardBy(extra);
      const assigned=shift?.assignments.find(a=>a.guard===g?.id);
      insist(assigned&&!isPast(shift),'Upcoming assignment required.');
      const start=localTime(fields.date,fields.time),duration=Number(fields.hours)*hour;
      insist(start>data.now&&duration>=hour/2&&duration<=24*hour,'Choose a future start and a valid duration.');
      insist(start!==shift.start||start+duration!==shift.end,'Choose a different time or duration.');
      const moved=newRequest(data.next++,shift.site,start,duration,1,shift.tier,start-data.now<=2*hour,shift.notes);
      Object.assign(moved,{dress:shift.dress,force:shift.force,vehicle:shift.vehicle,contact:shift.contact,source:shift.source,supervisors:Number(assigned.post==='Supervisor')});
      shift.assignments=shift.assignments.filter(a=>a!==assigned);
      shift.need--;
      if(!shift.need&&shift.backup)shift.backup.status='Released';
      shift.supervisors=Math.max(0,(shift.supervisors||0)-moved.supervisors);
      if(shift.offers[g.id])shift.offers[g.id].status='Rescheduled';
      for(const swap of data.swaps)if(swap.shift===shift.id&&swap.guard===g.id&&swap.status==='Pending')swap.status='Declined';
      recordEvent(shift,'Rescheduled by dispatch',g.id);
      data.requests.push(moved);recordEvent(moved,'Revised shift listed',g.id);
      if(!eligibility(g,moved).length&&(!moved.rush||preferencesFor(g.id).rush)){
        const expires=Math.min(start,data.now+(moved.rush?5:60)*minute);
        moved.offers[g.id]={status:'Invited',at:data.now,expires,replyDeadline:moved.rush?expires:null};
      }
      autoWave(moved);openRequest(moved);audit(view.contact+' revised the post for '+g.name+'. Fresh acceptance required.');
      message='Revised shift listed for fresh acceptance.';
    }else if(role==='admin'&&action==='review-duty'){
      const assignment=shift?.assignments.find(a=>a.guard===Number(extra));
      insist(assignment&&shift.end<=data.now,'Choose a completed assignment.');
      insist(['On time','Late'].includes(fields.arrival)&&['Accepted','Needs correction'].includes(fields.report),'Choose attendance and report outcomes.');
      insist(typeof fields.note==='string'&&fields.note.trim(),'Enter the review basis.');
      assignment.review={arrival:fields.arrival,report:fields.report,note:String(fields.note||'').slice(0,200),by:contact,at:data.now};
      recordEvent(shift,'Duty review saved',Number(extra));
      attendanceCache.delete(data);
      message='Duty record saved.';
    }else if(role==='admin'&&action==='call-note'){
      const g=guardBy(extra);
      insist(shift&&g&&['No answer','Unavailable','Will review offer'].includes(fields.outcome),'Choose a guard and outcome.');
      recordEvent(shift,fields.outcome,g.id);audit(view.contact+' logged phone follow-up with '+g.name+': '+fields.outcome);
      message='Follow-up recorded.';
    }else if(role==='client'&&action==='create-request') message=createRequest(form);
    else if(role==='guard'&&action==='leave-request') message=requestLeave(form);
    else if(role==='guard'&&action==='swap-request') message=requestSwap(form,id);
    else if(role==='guard'&&action==='unavailable'){
      const start=localTime(fields.date,fields.from),end=localTime(fields.endDate,fields.to);
      insist(start<end&&end>data.now,'Choose an unavailable period ending in the future.');
      const profile=preferencesFor(guard);
      insist(!data.requests.some(r=>r.assignments.some(a=>a.guard===guard)&&overlaps(r,{start,end})),'An assigned shift overlaps. Request a swap or report the cancellation first.');
      const windows=(profile.unavailable||[]).filter(w=>w.end>data.now);
      insist(!windows.some(w=>overlaps(w,{start,end})),'An unavailable period already overlaps these dates.');
      data.profiles[guard]={...profile,unavailable:[...windows,{start,end}]};message='Unavailable period saved.';
    }else if(role==='guard'&&action==='remove-window'){
      const profile=preferencesFor(guard);
      data.profiles[guard]={...profile,unavailable:(profile.unavailable||[]).filter(w=>w.start!==Number(id))};message='Unavailable period removed.';
    }else if(role==='guard'&&action==='preferences') message=savePreferences(fields);
    else{
      const actions=role==='admin'?adminActions:role==='guard'?guardActions:{};
      insist(Object.hasOwn(actions,action),'Unavailable action.');
      if(action==='advance') insist(Number(id)===5,'Choose a five minute step.');
      if(['cancelSupervisor','fast','wave','broadcast','no-show','verify-arrival','check-in','activate-backup','release-backup','standby-accept','standby-decline','replies','escalate','approve','batch','cancel','ack','pool','volunteer','decline','guard-cancel'].includes(action))insist(shift,'Shift unavailable.');
      if(['approve','cancel'].includes(action))insist(guardBy(extra),'Unknown guard.');
      message=actions[action](shift,id,extra);
    }
    versionRequests(snapshot,data);
    return {state:data,message,selected:view.selected,checked:[...view.checked]};
  }
};

