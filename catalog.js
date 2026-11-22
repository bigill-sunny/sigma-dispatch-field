const startOfDemo = Date.UTC(new Date().getUTCFullYear(),0,1);
const day = 86400000;
const sites = [
  {id:'harbor',client:'c1',name:'Maple Junction Centre',area:'Brampton',uniform:'Black polo',notes:'Meet the fictional site lead at the east reception desk. Bring your guard licence and photo ID.'},
  {id:'cedar',client:'c2',name:'Cedar Square',area:'Mississauga',uniform:'Navy blazer',notes:'Check in at the fictional concierge desk. Ask for the site orientation sheet.'}
];
const clients = {c1:'Maple Property Group',c2:'Cedar Facilities'};
const firstNames = ['Avery','Robin','Casey','Jamie','Morgan','Taylor','Reese','Quinn','Jordan','Drew','Sage','Parker'];
const lastNames = ['Vale','Finch','Lane','Brooks','Reed','West','Blake','Shore','Fields','Hart'];
const guards = Array.from({length:1000},(_,i)=>({
  id:3001+i,name:`${firstNames[i%12]} ${lastNames[Math.floor(i/12)%10]+(i>=120?" "+(1+Math.floor(i/120)):"")}`,tier:i===2?0:i%9===0?2:1,
  licensedUntil:i===0?startOfDemo-day:startOfDemo+730*day,
  trained:[36,45,54].includes(i)?['harbor','cedar']:i===1?['cedar']:i<20?['harbor','cedar']:i%3===0?['cedar']:['harbor'],
  uniforms:[36,45,54].includes(i)?['Black polo','Navy blazer']:i===3?['Navy blazer']:i<20?['Black polo','Navy blazer']:i%3===0?['Navy blazer']:['Black polo'],
  eta:[36,45,54].includes(i)?21:i===4?185:i===15?37:i>=20?33+(i*7)%65:8+(i*3)%22,
  reliability:87+(i*7)%14,available:i!==5 && (i<31||i%4!==0)
}));

const areas=['Brampton','Mississauga','Vaughan','Toronto','Markham'];
for(let number=3;number<=100;number++){
  const client='c'+number;
  const area=areas[(number-3)%areas.length];
  clients[client]=area+' Facilities '+number;
  sites.push({id:'site'+number,client,area,name:area+' Plaza '+number,uniform:'Black polo',notes:'Report to reception with your guard licence and collect the site briefing.'});
}
const areaCentres={Brampton:[43.7315,-79.7624],Mississauga:[43.5890,-79.6441],Vaughan:[43.8372,-79.5083],Toronto:[43.6532,-79.3832],Markham:[43.8561,-79.3370]};
for(const [i,site] of sites.entries()){
  const [lat,lon]=areaCentres[site.area];
  site.coordinates=[lat+(i%7)*.003,lon-(i%5)*.003];
}
for(const [i,g] of guards.entries()){
  for(let offset=0;offset<5;offset++)g.trained.push('site'+(3+(i+offset*19)%98));
  if(i>=120){
    g.eta=7+(i*17)%65;
    g.available=i%7!==0;
  }
  g.phone='+1-416-555-'+String(100+i%100).padStart(4,'0')+' ext '+g.id;
  g.reportRecord={reviewed:10,accepted:7+i%4,asOf:startOfDemo,basis:'Supervisor review for completeness and timely submission'};
  g.priorCancellations=i%4;
  g.onTime=18+(i*7)%13;
  g.completed=30;
  g.reliability=Math.round(100*g.onTime/g.completed);
}
if(typeof module!=='undefined')module.exports={sites,clients,guards};

