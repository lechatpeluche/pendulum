/* Dependency-free Chrome DevTools checks. Run: node tests/browser-checks.cjs
 * Requires Node 22+ (native WebSocket) and Chrome/Chromium, not an app dependency.
 * Set CHROME_PATH for a nonstandard installation. Screenshots go to a temp directory.
 */
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const candidates=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].filter(Boolean);
const chromePath=candidates.find(p=>fs.existsSync(p));
if(!chromePath) throw new Error('Chrome not found. Set CHROME_PATH to the browser executable.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pendulum-checks-'));
const browser=spawn(chromePath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--remote-debugging-port=0',`--user-data-dir=${path.join(temp,'profile')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws,session,passed=0;
const pending=new Map(),exceptions=[],requests=[];let nextId=1;
function send(method,params={},sessionId=session) {
  return new Promise((resolve,reject)=>{
    const id=nextId++,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout: ${method}`));},15000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
}
async function evaluate(expression) {
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.text+': '+JSON.stringify(result.exceptionDetails.exception));
  return result.result.value;
}
const snapshot=()=>evaluate('pendulumLab.snapshot()');
const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
async function fill(id,value) {
  return evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function select(selector,value) {
  return evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function speed(value) {await evaluate(`document.querySelector('[data-speed="${value}"]').click()`);}
async function waitFor(expression,timeout=10000) {
  const start=Date.now();while(Date.now()-start<timeout) {if(await evaluate(expression)) return;await sleep(40);}
  throw new Error(`Condition timed out: ${expression}; diagnostics: ${JSON.stringify(await evaluate('({snapshot:pendulumLab.snapshot(),feedback:document.getElementById("feedback").textContent,focus:document.activeElement.id})'))}`);
}
async function check(name,fn) {await fn();passed++;console.log('PASS',name);}
async function viewport(width,height,mobile=false) {
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:mobile?2:1,mobile,screenOrientation:{type:width>height?'landscapePrimary':'portraitPrimary',angle:width>height?90:0}});
  await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});await sleep(100);
}
async function screenshot(name) {
  const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  fs.writeFileSync(path.join(temp,name+'.png'),Buffer.from(result.data,'base64'));
}
async function main() {
  const endpoint=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Chrome launch timed out: '+output)),15000);
    browser.stderr.on('data',data=>{output+=data.toString();const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    browser.on('error',reject);browser.on('exit',code=>{if(!output.includes('DevTools listening')){clearTimeout(timer);reject(new Error(`Chrome exited ${code}: ${output}`));}});
  });
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id) {
      const request=pending.get(message.id);if(!request)return;
      clearTimeout(request.timer);pending.delete(message.id);
      if(message.error) request.reject(new Error(JSON.stringify(message.error)));else request.resolve(message.result);
    } else {
      if(message.method==='Runtime.exceptionThrown') exceptions.push(message.params);
      if(message.method==='Network.requestWillBeSent') requests.push(message.params.request.url);
    }
  });
  const target=await send('Target.createTarget',{url:'about:blank'},null);
  session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await viewport(1440,1000);
  await send('Page.navigate',{url:pathToFileURL(path.join(__dirname,'../index.html')).href});
  await waitFor('typeof pendulumLab!=="undefined"');

  await check('file:// startup, defaults, shared pivot, zero velocities, no external resources',async()=>{
    const s=await snapshot();assert.equal(s.state,'ready');assert.equal(s.time,0);assert.equal(s.speed,1);assert.equal(s.trailsEnabled,true);
    assert.deepEqual(s.config.map(p=>p.links.map(l=>l.angle)),[[120,-10],[120.01,-10]]);
    s.config.forEach(p=>p.links.forEach(l=>{assert.equal(l.mass,1);assert.equal(l.length,1);}));
    assert.deepEqual(s.y.filter((_,i)=>[2,3,6,7].includes(i)),[0,0,0,0]);
    assert.ok(s.trails.every(t=>!t.length));assert.ok(requests.every(url=>url.startsWith('file:')||url==='about:blank'));
    assert.equal(await evaluate('document.getElementById("configuration").disabled'),false);
    assert.equal(await evaluate('[...document.querySelectorAll("[data-speed]")].every(b=>b.disabled)'),true);
  });

  await check('320, 390, 768, 1440 px layouts and smartphone orientation changes',async()=>{
    for(const [w,h,mobile] of [[320,720,true],[390,844,true],[768,1024,true],[1440,1000,false],[844,390,true],[390,844,true]]) {
      await viewport(w,h,mobile);
      const layout=await evaluate(`(()=>{const a=document.querySelector('.scene').getBoundingClientRect(),b=document.querySelector('.settings').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,overlap:!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom),fields:[...document.querySelectorAll('input[type=number]')].every(e=>{const r=e.getBoundingClientRect();return r.width>=50&&r.left>=0&&r.right<=innerWidth;}),width:innerWidth};})()`);
      assert.equal(layout.overflow,false,`${w} overflow`);assert.equal(layout.overlap,false,`${w} overlap`);assert.equal(layout.fields,true,`${w} clipped fields`);
      const s=await snapshot();const reach=Math.max(...s.config.map(p=>p.links.reduce((a,l)=>a+l.length,0)));
      assert.ok(reach*s.scale+6<=Math.min(s.width,s.height)/2,`${w} chain fit`);
      if(w===320||w===1440) await screenshot('initial-'+w);
    }
    await viewport(1440,1000);
  });

  await check('Live valid preview, invalid/empty fields, input precision, atomic last-valid restore',async()=>{
    await fill('p0-l0-angle','90.0001');let s=await snapshot();assert.equal(s.time,0);assert.equal(s.config[0].links[0].angle,90.0001);
    assert.ok(Math.abs(s.points[0][0].x-1)<1e-10);
    const previous=s.points;
    for(const [id,value] of [['p0-l0-angle',''],['p0-l0-angle','180.0001'],['p0-l0-angle','0.00001'],['p0-l0-length','.249'],['p0-l0-mass','500.01']]) {
      await fill(id,value);s=await snapshot();assert.equal(s.valid,false);assert.deepEqual(s.points,previous);
      assert.equal(await evaluate('document.getElementById("start").disabled'),true);
      assert.ok(await evaluate(`document.getElementById('${id}-error').textContent`));
      await click('reset');s=await snapshot();assert.equal(s.valid,true);assert.deepEqual(s.points,previous);
      assert.equal(await evaluate('document.querySelectorAll("[aria-invalid=true]").length'),0);
    }
    await fill('p0-l0-angle','120');
  });

  await check('Count changes, new defaults, maximum reach, four independent four-link chains',async()=>{
    await select('#pendulum-count',4);
    let s=await snapshot();assert.equal(s.config.length,4);
    assert.deepEqual(s.config[2].links,[{length:1,mass:1,angle:0},{length:1,mass:1,angle:0}]);
    for(let p=0;p<4;p++) await select(`[data-link-count="${p}"]`,4);
    s=await snapshot();assert.equal(s.y.length,32);assert.equal(s.config[0].links[3].angle,0);
    for(let l=0;l<4;l++) {await fill(`p3-l${l}-length`,5);await fill(`p3-l${l}-mass`,500);await fill(`p3-l${l}-angle`,180);}
    s=await snapshot();assert.ok(Math.abs(s.scale*20-(Math.min(s.width,s.height)/2-32))<1e-10);
    await click('start');await sleep(250);await click('start');s=await snapshot();assert.equal(s.state,'paused');assert.ok(s.time>0);
    assert.deepEqual(s.y.slice(24),[Math.PI,Math.PI,Math.PI,Math.PI,0,0,0,0]);
    await click('reset');await select('#pendulum-count',2);await select('[data-link-count="0"]',2);await select('[data-link-count="1"]',2);
  });

  await check('Keyboard Start, locked configuration, exact pause hold, speed changes preserve paused state',async()=>{
    await evaluate('document.getElementById("start").focus()');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await waitFor('pendulumLab.snapshot().time>.25');
    assert.equal(await evaluate('document.getElementById("configuration").disabled'),true);
    assert.equal(await evaluate('[...document.querySelectorAll("#configuration input,#configuration select")].every(e=>e.matches(":disabled"))'),true);
    await click('start');const before=await snapshot();assert.equal(before.state,'paused');
    await sleep(250);let after=await snapshot();assert.equal(after.time,before.time);assert.deepEqual(after.y,before.y);assert.deepEqual(after.trails,before.trails);
    for(const rate of [2,5,10,1]) {await speed(rate);after=await snapshot();assert.equal(after.speed,rate);assert.equal(after.time,before.time);assert.deepEqual(after.y,before.y);assert.deepEqual(after.trails,before.trails);}
    await click('start');await sleep(80);await click('start');after=await snapshot();assert.ok(after.time>before.time&&after.time-before.time<.2,'resume must not catch up pause duration');
  });

  await check('Trail toggle clears/reseeds without changing physics, ten-second bounds, speed ×10',async()=>{
    let before=await snapshot();await click('trails');let after=await snapshot();assert.equal(after.trailsEnabled,false);assert.ok(after.trails.every(t=>!t.length));assert.deepEqual(after.y,before.y);assert.equal(after.time,before.time);
    await click('trails');after=await snapshot();assert.ok(after.trails.every(t=>t.length===1&&t[0].t===before.time));assert.deepEqual(after.y,before.y);
    await speed(10);await click('start');await waitFor('pendulumLab.snapshot().time>12',15000);await click('start');after=await snapshot();
    after.trails.forEach((history,p)=>{
      assert.ok(history.length>1000&&history.length<=1202);
      assert.ok(history[0].t>=after.time-10);assert.ok(history.at(-1).t<=after.time);
      assert.ok(after.time-history.at(-1).t<1/120+1e-10);
      history.forEach(point=>assert.ok(Math.hypot(point.x,point.y)<=after.config[p].links.reduce((s,l)=>s+l.length,0)+1e-12));
    });
    await screenshot('motion-1440');
  });

  await check('Reset restores accepted positions, zeroes time/velocity, keeps trail setting, returns ×1',async()=>{
    const before=await snapshot();await click('trails');await click('reset');const after=await snapshot();
    assert.equal(after.time,0);assert.equal(after.state,'ready');assert.equal(after.speed,1);assert.equal(after.trailsEnabled,false);assert.ok(after.trails.every(t=>!t.length));assert.deepEqual(after.config,before.config);
    assert.deepEqual(after.y.filter((_,i)=>[2,3,6,7].includes(i)),[0,0,0,0]);
    assert.equal(await evaluate('document.getElementById("configuration").disabled'),false);
    await click('trails');await fill('p0-l0-angle',110);assert.ok((await snapshot()).trails.every(t=>!t.length));await fill('p0-l0-angle',120);
  });

  await check('Hidden running tab freezes; visible return has no jump; paused tab stays paused',async()=>{
    await click('start');await waitFor('pendulumLab.snapshot().time>.15');
    const other=await send('Target.createTarget',{url:'about:blank'},null);
    await send('Target.activateTarget',{targetId:other.targetId},null);
    await waitFor('document.hidden');const hidden=await snapshot();await sleep(400);const held=await snapshot();assert.equal(held.time,hidden.time);assert.deepEqual(held.y,hidden.y);assert.deepEqual(held.trails,hidden.trails);
    await send('Target.activateTarget',{targetId:target.targetId},null);await waitFor('!document.hidden');await sleep(90);await click('start');let shown=await snapshot();assert.equal(shown.state,'paused');assert.ok(shown.time-hidden.time<.25);
    await send('Target.activateTarget',{targetId:other.targetId},null);await waitFor('document.hidden');await sleep(150);
    await send('Target.activateTarget',{targetId:target.targetId},null);await waitFor('!document.hidden');await sleep(100);const still=await snapshot();assert.equal(still.state,'paused');assert.equal(still.time,shown.time);assert.deepEqual(still.y,shown.y);
    await send('Target.closeTarget',{targetId:other.targetId},null);await click('reset');
  });

  await check('Touch activation at 320 px and no state changes on orientation/resize',async()=>{
    await viewport(320,720,true);
    await evaluate('document.getElementById("start").scrollIntoView({block:"center"})');
    const point=await evaluate('(()=>{const r=document.getElementById("start").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,radiusX:1,radiusY:1}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await waitFor('pendulumLab.snapshot().time>.1');await click('start');const before=await snapshot();
    await viewport(844,390,true);await viewport(390,844,true);const after=await snapshot();assert.equal(after.time,before.time);assert.deepEqual(after.y,before.y);assert.deepEqual(after.trails,before.trails);
    await screenshot('motion-390');await click('reset');await viewport(1440,1000);
  });

  await check('Measured simulation-time rates at ×1, ×2, ×5, and ×10',async()=>{
    await select('#pendulum-count',1);await select('[data-link-count="0"]',1);await fill('p0-l0-angle',30);await click('start');
    for(const rate of [1,2,5,10]) {
      await speed(rate);await sleep(80);
      const measurement=await evaluate('new Promise(resolve=>{const t=pendulumLab.snapshot().time,wall=performance.now();setTimeout(()=>resolve({sim:pendulumLab.snapshot().time-t,real:(performance.now()-wall)/1000}),500);})');
      const achieved=measurement.sim/measurement.real;
      console.log(`  selected ×${rate}, measured ×${achieved.toFixed(2)}`);
      assert.ok(achieved>rate*.75&&achieved<rate*1.15,`selected ${rate}, achieved ${achieved}`);
    }
    await click('start');await click('reset');
  });

  await check('Compute-limited feedback under CPU throttling; controls remain usable; no lag replay',async()=>{
    await select('#pendulum-count',4);
    for(let p=0;p<4;p++) {
      await select(`[data-link-count="${p}"]`,4);
      for(let l=0;l<4;l++) {await fill(`p${p}-l${l}-length`,.25);await fill(`p${p}-l${l}-mass`,l===3?500:1);await fill(`p${p}-l${l}-angle`,l===3?120.0001:120);}
    }
    await click('start');await speed(10);await send('Emulation.setCPUThrottlingRate',{rate:12});
    await waitFor('pendulumLab.snapshot().lagging',15000);
    assert.match(await evaluate('document.getElementById("feedback").textContent'),/Compute-limited/);
    const wall=Date.now();await click('start');assert.ok(Date.now()-wall<1500);const before=await snapshot();assert.equal(before.state,'paused');
    await send('Emulation.setCPUThrottlingRate',{rate:1});await sleep(200);await speed(1);await click('start');await sleep(80);await click('start');const after=await snapshot();assert.ok(after.time-before.time<.2,'must not replay prior lag');assert.ok(after.energyErrors.every(e=>e<1e-5));
    await click('reset');
  });

  assert.deepEqual(exceptions,[],'No uncaught browser errors');
  assert.ok(requests.every(url=>url.startsWith('file:')||url==='about:blank'),'No external application resource requests');
  console.log(`\n${passed} browser checks passed. Screenshots: ${temp}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(ws) ws.close();browser.kill('SIGTERM');
  for(const request of pending.values()) clearTimeout(request.timer);
  await sleep(300);
  try {fs.rmSync(path.join(temp,'profile'),{recursive:true,force:true});} catch {}
});
