'use strict';
const {randomBytes,createHash}=require('node:crypto');
const QRCode=require('qrcode');
const {assignedSupervisor,attendanceWindow,recordQrArrival}=require('./model');

const tokenHash=token=>createHash('sha256').update(token).digest('hex');
function siteDistance(lat,lon,targetLat,targetLon){
  const rad=Math.PI/180;
  const a=Math.sin((targetLat-lat)*rad/2)**2+
    Math.cos(lat*rad)*Math.cos(targetLat*rad)*Math.sin((targetLon-lon)*rad/2)**2;
  return 12742000*Math.asin(Math.sqrt(Math.min(1,a)));
}
function coordinates(body){
  const {latitude,longitude}=body;
  if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180)throw Error('Provide a valid latitude and longitude.');
  return [latitude,longitude];
}

function attendanceService(db,{radius=150,maxAccuracy=75,ttl=180000,requireLocation=true}={}){
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_pins (site TEXT PRIMARY KEY, latitude REAL NOT NULL, longitude REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS attendance_tokens (request INTEGER PRIMARY KEY, hash TEXT NOT NULL, issuer INTEGER NOT NULL, expires INTEGER NOT NULL);
  `);
  const getPin=db.prepare('SELECT latitude,longitude FROM attendance_pins WHERE site=?');
  const savePin=db.prepare('INSERT OR REPLACE INTO attendance_pins VALUES(?,?,?)');
  const getToken=db.prepare('SELECT hash,issuer,expires FROM attendance_tokens WHERE request=?');
  const saveToken=db.prepare('INSERT OR REPLACE INTO attendance_tokens VALUES(?,?,?,?)');
  const expire=db.prepare('DELETE FROM attendance_tokens WHERE expires<=?');
  function pin(site,body,requestIds){
    const [lat,lon]=coordinates(body);
    db.exec('BEGIN IMMEDIATE');
    try{
      savePin.run(site,lat,lon);
      const remove=db.prepare('DELETE FROM attendance_tokens WHERE request=?');
      for(const id of requestIds)remove.run(id);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function proximity(site,body,now){
    const [latitude,longitude]=coordinates(body);
    const target=getPin.get(site);
    if(!target)throw Error('Ask dispatch to configure the attendance pin for this site.');
    const {accuracy,capturedAt}=body;
    if(!Number.isFinite(capturedAt)||capturedAt>now+10000||now-capturedAt>60000)throw Error('Get a fresh location fix and retry.');
    if(!Number.isFinite(accuracy)||accuracy<=0||accuracy>maxAccuracy)throw Error('Location is too imprecise. Move to a spot with a clear signal and retry.');
    const distance=siteDistance(latitude,longitude,target.latitude,target.longitude);
    if(distance+accuracy>radius)throw Error('Location does not place this device inside the attendance area.');
    return {distance:Math.round(distance),accuracy:Math.ceil(accuracy)};
  }
  async function issue(shift,account,body,origin,now){
    if(account.role!=='guard'||!shift||!assignedSupervisor(shift,account.guard))throw Error('Only the assigned supervisor can issue this code.');
    if(!attendanceWindow(shift,now))throw Error('Check-in opens 15 minutes before shift start.');
    if(requireLocation)proximity(shift.site,body,now);
    const token=randomBytes(24).toString('base64url');
    const expires=Math.min(now+ttl,shift.end);
    // A fragment keeps the code out of standard HTTP URL logs.
    const link=origin+'/#attendance='+shift.id+'.'+token;
    const image=await QRCode.toDataURL(link,{width:360,margin:4,errorCorrectionLevel:'M'});
    expire.run(now);
    saveToken.run(shift.id,tokenHash(token),account.guard,expires);
    return {image,expires};
  }
  function redeem(snapshot,shift,account,body,now){
    if(account.role!=='guard'||!shift?.assignments.some(a=>a.guard===account.guard))throw Error('Sign in with a guard account assigned to this shift.');
    if(!attendanceWindow(shift,now))throw Error('Check-in is closed for this shift.');
    const saved=getToken.get(shift.id);
    if(typeof body.code!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(body.code)||!saved||saved.expires<=now||saved.hash!==tokenHash(body.code))throw Error('Code expired or invalid. Scan the supervisor’s current QR code.');
    if(!assignedSupervisor(shift,saved.issuer))throw Error('The issuing supervisor is no longer assigned.');
    const evidence=requireLocation?proximity(shift.site,body,now):{};
    return recordQrArrival(snapshot,{requestId:shift.id,guard:account.guard,issuer:saved.issuer,now,...evidence});
  }
  return {pin,issue,redeem,hasPin:site=>Boolean(getPin.get(site))};
}
module.exports={attendanceService,siteDistance};
