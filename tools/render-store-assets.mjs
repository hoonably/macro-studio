// Render the shipped UI with synthetic data; never open a user's Chrome profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { projectRoot } from './build.mjs';

const build = path.join(projectRoot, 'dist-store');
const manifest = JSON.parse(await fs.readFile(path.join(build, 'manifest.json'), 'utf8'));
const output = path.join(projectRoot, 'docs/store-assets');
const website = path.join(projectRoot, 'website/assets/features');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'macro-studio-media-'));
const chromeBinary = process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const samples = [
  {id:'recording',title:'평소처럼 작업하고, 순서대로 기록하세요.',description:'필요한 사이트만 켜고 클릭·입력을 기록합니다.\n작업실은 같은 오른쪽 패널에서 이어집니다.'},
  {id:'agent',title:'작업을 설명하고, 지시문을 복사하세요.',description:'검토한 기록과 요청을 Codex·Claude Code에 전달합니다.\n조절할 입력값을 미리 전부 나열할 필요는 없어요.'},
  {id:'launcher',title:'자주 쓰는 값은 잠그거나 숨겨두세요.',description:'입력값을 확인하고 직접 실행합니다.\n이름 수정과 입력 설정은 확장이 기억합니다.'},
  {id:'library',title:'내 매크로를 한곳에서 관리하세요.',description:'이름을 수정하고 사용 중·보관 중 목록을 정리합니다.\n연결한 폴더의 변경도 바로 확인할 수 있어요.'}
];
const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const catalog = [
  {id:'request-demo',name:'출장 신청 준비',local:true,matches:['https://example.com/*']},
  {id:'weekly-report',name:'주간 보고서 작성',local:true,matches:['https://example.com/*']},
  {id:'old-request',name:'이전 신청 양식',local:true,matches:['https://example.com/*']}
];
const recording = {id:'example-recording',schemaVersion:1,tabId:42,name:'출장 신청 준비',status:'stopped',createdAt:'2026-11-14T00:00:00.000Z',origins:['https://example.com/*'],stopBefore:'최종 제출은 직접 합니다.',steps:[
  {id:'open',action:'click',target:{tag:'button',label:'새 신청서',selectors:['#new-request']},page:{url:'https://example.com/requests',title:'예시 업무 화면'},mode:'fixed',modeSource:'automatic'},
  {id:'day',action:'input',target:{tag:'input',type:'date',label:'출장 날짜',selectors:['#day']},value:'2026-11-20',page:{url:'https://example.com/requests',title:'예시 업무 화면'},mode:'fixed',modeSource:'automatic'},
  {id:'city',action:'input',target:{tag:'input',type:'text',label:'출장지',selectors:['#city']},value:'서울 중구',page:{url:'https://example.com/requests',title:'예시 업무 화면'},mode:'fixed',modeSource:'automatic'}
]};
function fixture(scene) {
  return `(() => {
    const catalog=${JSON.stringify(catalog)}, recording=${JSON.stringify(recording)};
    const scene=${JSON.stringify(scene)};
    if(scene==='recording') recording.status='recording';
    const folder={name:'MyMacros',queryPermission:async()=> 'granted',isSameEntry:async()=>true};
    const state={connected:true,readable:true,writable:true,enabled:true,folderName:'MyMacros',folderPath:'/Users/example/Documents/MyMacros',folderRelativePath:[],count:3,scripts:catalog,missingOrigins:[],errors:[]};
    const preference=scene==='launcher'?{'request-demo':{city:{type:'text',locked:true,hidden:false,value:'서울 중구'},memo:{type:'text',locked:false,hidden:true,value:'회의 자료 지참'}}}:{};
    const library={ready:true,siteEnabled:true,available:catalog.map(x=>x.id),catalog,archived:['old-request'],deleted:[],fieldPreferences:preference};
    const quiet={addListener(){}};
    const draft={name:recording.name,goal:scene==='agent'?'신청서를 열고 날짜·출장지·목적을 입력해주세요. 내용을 확인할 수 있게 최종 제출 직전에 멈춰주세요.':''};
    const memory={folder,folderPath:state.folderPath};
    window.fixtureRead=async key=>memory[key]; window.fixtureWrite=async values=>Object.assign(memory,values);
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.fixtureClipboard=text;}}});
    window.chrome={
      runtime:{id:'media-fixture',getURL:p=>location.origin+'/'+p,getManifest:()=>({version:${JSON.stringify(manifest.version)},content_scripts:[{world:'MAIN',matches:[location.origin+'/*']}]}),onMessage:quiet,
        sendMessage:async message=>{
          if(['local:status','local:sync'].includes(message.type))return {ok:true,value:structuredClone(state)};
          if(message.type==='studio:state')return {ok:true,value:structuredClone(recording)};
          if(message.type==='frames:scan')return {ok:true,value:{tabId:42,origin:'https://example.com',pattern:'https://example.com/*',topAllowed:true,siteEnabled:true,detectionEnabled:true,frames:[]}};
          if(message.type==='scripts:state')return {ok:true,value:structuredClone(library)};
          if(message.type==='update:check')return {ok:true,value:{managedByChrome:true,pending:false}};
          return {ok:true,value:{}};
        }},
      windows:{getCurrent:async()=>({id:1})},tabs:{query:async()=>[{id:42,url:'https://example.com/requests'}],onActivated:quiet,onUpdated:quiet},
      permissions:{contains:async()=>true,onAdded:quiet,onRemoved:quiet},
      storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}},session:{get:async()=>({macroStudioStudioDraft:draft}),set:async()=>{},remove:async()=>{}},onChanged:quiet}
    };
    window.fixtureReady=true;
  })();`;
}
const pageStyle = `*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;color:#20334d;font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f5f9}.stage{height:100%;display:grid;grid-template-columns:minmax(0,1fr) 430px;gap:36px;padding:32px}.story{min-width:0;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:650}.brand img{width:34px;height:34px}h1{font-size:36px;line-height:1.35;letter-spacing:-1px;margin:36px 0 14px;max-width:16em}p{color:#52647b;margin:0 0 24px;white-space:pre-line}.example{background:white;border:1px solid #dce4ef;border-radius:14px;padding:24px;margin-top:auto;margin-bottom:24px}h2{font-size:18px;margin:0 0 16px}.example small{color:#52647b;font-size:12px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.value{display:block;border-bottom:1px solid #dce4ef;padding:10px 0 12px;font-size:15px;font-weight:550}.example button{font:inherit;background:#155fc0;color:white;border:0;border-radius:8px;padding:9px 14px;margin-top:20px}.footnote{font-size:12px;color:#52647b;margin-top:auto}.app-frame{height:100%;min-height:0;width:430px;border:1px solid #dce4ef;background:#f6f7f9;border-radius:14px;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}.badge{display:inline-block;color:#345986;font-size:12px;margin-left:auto}.launcher-stage{height:100%;padding:32px 430px 32px 32px}.launcher-stage .story{height:100%}.launcher-stage .example{margin-top:auto}`;
function sampleForm() {return `<section class="example"><small>example.com · 예시 업무 화면</small><h2>출장 신청서</h2><div class="form-grid"><div><small>출장 날짜</small><span class="value">2026년 11월 20일</span></div><div><small>출장지</small><span class="value">서울 중구</span></div><div><small>방문 기관</small><span class="value">예시 연구소</span></div><div><small>출장 목적</small><span class="value">프로젝트 협업 미팅</span></div></div><button type="button">임시저장</button></section>`;}
function story(sample) {return `<div class="story"><header class="brand"><img src="/assets/icon-48.png" alt="">Macro Studio<span class="badge">v${manifest.version}</span></header><h1>${escape(sample.title)}</h1><p>${escape(sample.description)}</p>${sampleForm()}<div class="footnote">예시 데이터로 실제 확장 UI를 렌더링한 화면입니다.<br>코딩 에이전트는 별도로 필요하며, 최종 제출은 직접 합니다.</div></div>`;}
function stage(sample) {
  const route=sample.id==='library'?'library':'studio';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(sample.title)}</title><style>${pageStyle}</style></head><body><main class="stage">${story(sample)}<div class="app-frame"><iframe title="Macro Studio 실제 UI 예시" src="/ui/${route}.html?scene=${sample.id}"></iframe></div></main></body></html>`;
}
function launcher() {
  const sample=samples.find(x=>x.id==='launcher');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${pageStyle}</style><script src="/fixture.js?scene=launcher"></script></head><body><main class="launcher-stage">${story(sample)}</main><script src="/ui/launcher.js"></script><script>
    window.MacroStudio.launcher.create().register({id:'request-demo',name:'출장 신청 준비',local:{id:'request-demo',revision:'example'},fields:[{name:'day',label:'출장 날짜',type:'date',value:'2026-11-20',required:true},{name:'city',label:'출장지',value:'서울 중구'},{name:'memo',label:'메모',value:'회의 자료 지참'}],note:'최종 제출은 직접 합니다.',run:async()=> '예시 화면입니다.'});
  </script><script src="/core/studio-entry.js"></script></body></html>`;
}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fixture(url.searchParams.get('scene')));return;}
    if(url.pathname==='/capture.html'){const sample=samples.find(x=>x.id===url.searchParams.get('scene'));res.setHeader('Content-Type','text/html; charset=utf-8');res.end(sample.id==='launcher'?launcher():stage(sample));return;}
    const isWebsite=url.pathname.startsWith('/site/');
    const base=isWebsite?path.join(projectRoot,'website'):build;
    const relative=isWebsite?url.pathname.slice(6):url.pathname.slice(1);
    const target=path.resolve(base,relative||'index.html');
    if(!target.startsWith(base+path.sep))throw Error('Outside preview root');
    let body=await fs.readFile(target);
    if(target.endsWith('.html')){body=body.toString().replace('<head>','<head><script src="/fixture.js?scene='+encodeURIComponent(url.searchParams.get('scene')||'agent')+'"></script>');res.setHeader('Content-Type','text/html; charset=utf-8');}
    else if(target.endsWith('.js')){body=body.toString();if(url.pathname==='/ui/scripts.js')body=body.replace("import { readLocal, writeLocal } from '../scripts/store.js';","const readLocal=window.fixtureRead,writeLocal=window.fixtureWrite;");res.setHeader('Content-Type','text/javascript; charset=utf-8');}
    else if(target.endsWith('.css'))res.setHeader('Content-Type','text/css');
    const mime={'.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json'}[path.extname(target)];
    if(mime)res.setHeader('Content-Type',mime);
    res.end(body);
  } catch {res.statusCode=404;res.end('Preview resource not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser,socket;
const results=[];
try {
  await fs.mkdir(output,{recursive:true});
  browser=spawn(chromeBinary,['--headless','--window-size=1280,1000','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--user-data-dir='+temporary+'/profile','--remote-debugging-port=0',origin+'/capture.html?scene=recording'],{stdio:'ignore'});
  let port;
  for(let i=0;i<100;i++){try{port=Number((await fs.readFile(temporary+'/profile/DevToolsActivePort','utf8')).split('\n')[0]);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  if(!port)throw Error('Isolated Chrome did not start; set CHROME_BINARY to a Chrome executable.');
  const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let nextId=0;const pending=new Map();
  socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const call=pending.get(data.id);pending.delete(data.id);data.error?call.reject(Error(data.error.message)):call.resolve(data.result);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++nextId,{resolve,reject});socket.send(JSON.stringify({id:nextId,method,params}));});
  const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result.value;};
  async function waitFor(expression){for(let i=0;i<150;i++){try{if(await evaluate(expression))return;}catch{}await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Preview did not become ready: '+expression);}
  async function navigate(sample,height,density){
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height,deviceScaleFactor:density,mobile:false});
    const previousTime = await evaluate('performance.timeOrigin');
    await call('Page.navigate',{url:origin+'/capture.html?scene='+sample.id});
    await waitFor('performance.timeOrigin !== ' + previousTime);
    if(sample.id==='launcher'){
      await waitFor(`document.getElementById('macro-studio-launcher')?.hidden===false`);
      await evaluate(`(()=>{const root=document.getElementById('macro-studio-launcher').shadowRoot;root.querySelector('.orb').click();root.querySelector('.script').click();root.querySelector('.panel').blur();})()`);
    } else {
      await waitFor(`document.querySelector('iframe')?.contentDocument?.querySelector('${sample.id==='library'?'#active-scripts .script-name':'#setup-section[data-ready=true]'}')`);
      await evaluate(`document.querySelector('iframe').contentDocument.fonts.ready`);
      if(sample.id==='agent'){
        await evaluate(`document.querySelector('iframe').contentDocument.querySelector('#prompt').click()`);
        await waitFor(`document.querySelector('iframe').contentDocument.querySelector('#prompt').dataset.copyState==='success'`);
        await evaluate(`document.querySelector('iframe').contentDocument.querySelector('#agent-title').scrollIntoView({block:'center'})`);
      }
      if(sample.id==='library')await evaluate(`document.querySelector('iframe').contentDocument.querySelector('.name-edit').click()`);
    }
    await evaluate('document.fonts.ready');
    if (sample.id !== 'launcher') await evaluate(`Promise.all(document.querySelector('iframe').contentDocument.getAnimations().map(animation=>animation.finished.catch(()=>{})))`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  for(const [index,sample] of samples.entries()){
    await navigate(sample,800,1);
    const store=path.join(output,String(index+1).padStart(2,'0')+'-'+sample.id+'.png');
    const png=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(store,Buffer.from(png.data,'base64'));
    if(index<3){
      await navigate(sample,1000,2);
      const jpg=await call('Page.captureScreenshot',{format:'jpeg',quality:95});await fs.writeFile(path.join(website,sample.id+'.jpg'),Buffer.from(jpg.data,'base64'));
    }
    results.push({scene:sample.id,store:path.relative(projectRoot,store),storeSize:[1280,800],website:index<3?'website/assets/features/'+sample.id+'.jpg':null});
  }
  execFileSync('magick',[path.join(output,'01-recording.png'),'-quality','91',path.join(projectRoot,'.github/site-preview.webp')]);
  await fs.copyFile(path.join(build,'assets/icon-128.png'),path.join(output,'icon-128.png'));
  if (process.env.SCREENSHOT_QA_DIR) {
    const qaDirectory=path.resolve(process.env.SCREENSHOT_QA_DIR); await fs.mkdir(qaDirectory,{recursive:true});
    const checks=[];
    for (const width of [1280,390]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      const previousTime=await evaluate('performance.timeOrigin');
      await call('Page.navigate',{url:origin+'/site/index.html'});
      await waitFor('performance.timeOrigin !== '+previousTime+" && document.readyState === 'complete'");
      await evaluate('document.fonts.ready');
      await evaluate(`Promise.all([...document.images].filter(img=>img.loading!=='lazy').map(img=>img.decode().catch(()=>{})))`);
      for (let index=0;index<3;index++) await evaluate(`document.querySelectorAll('[data-feature-gallery] [role=tab]')[${index}].click()`);
      await evaluate(`Promise.all([...document.querySelectorAll('.feature-stage img')].map(img=>img.decode()))`);
      const check=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,images:[...document.querySelectorAll('.feature-stage img')].map(img=>({width:img.naturalWidth,height:img.naturalHeight})),preview:document.querySelector('.section-intro')?.textContent})`);
      if(check.scrollWidth>width || check.images.length!==3 || check.images.some(img=>img.width!==2560 || img.height!==2000))throw Error('Website layout or media mismatch: '+JSON.stringify(check));
      const broken=await evaluate(`([...document.images].filter(img=>img.getClientRects().length>0&&!img.naturalWidth)).map(img=>img.src)`);
      if(broken.length)throw Error('Broken website images: '+JSON.stringify(broken));
      const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(qaDirectory,'website-'+width+'.png'),Buffer.from(shot.data,'base64'));
      await evaluate(`document.querySelector('.features').scrollIntoView({behavior:'instant',block:'start'})`);
      const featureShot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(qaDirectory,'website-features-'+width+'.png'),Buffer.from(featureShot.data,'base64'));checks.push(check);
    }
    await fs.writeFile(path.join(qaDirectory,'verification.json'),JSON.stringify(checks,null,2)+'\n');
  }
  await fs.writeFile(path.join(output,'capture-manifest.json'),JSON.stringify({version:manifest.version,buildId:JSON.parse(await fs.readFile(path.join(build,'core/build-info.json'),'utf8')).id,date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()),source:'dist-store actual UI with synthetic runtime fixture; no personal data',results},null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
  await call('Browser.close');
} finally {
  if(socket?.readyState===WebSocket.OPEN)socket.close();
  if(browser&&!browser.killed)browser.kill();
  await new Promise(resolve=>{if(browser?.exitCode!==null)return resolve();browser?.once('exit',resolve);setTimeout(resolve,1500);});
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:150});
}
