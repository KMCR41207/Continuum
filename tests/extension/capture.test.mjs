import { test } from "node:test";
import assert from "node:assert/strict";

test("background capture enforces consent, platform, pause, automatic opt-in, authentication and persistent retry", async () => {
  let listener;
  let state = {};
  const requests = [];
  let offline = false;
  globalThis.chrome = {
    storage: {local:{get:async()=>structuredClone(state),set:async(value)=>{state={...state,...structuredClone(value)};}}},
    runtime: {onMessage:{addListener:(callback)=>{listener=callback;}},onInstalled:{addListener:()=>{}}},
    alarms:{create:()=>{},onAlarm:{addListener:()=>{}}},
  };
  globalThis.fetch = async (url, options) => {
    requests.push({url:String(url), options});
    if(offline)throw new Error("offline");
    return new Response(JSON.stringify({id:"actual-api-result",duplicate:false,proposals:1}));
  };
  await import("../../apps/browser-extension/src/background.js");
  const message = {type:"capture", title:"Visible conversation", messages:[{role:"user",content:"I prefer concise explanations for my future work."}], automatic:false};
  const sender = {tab:{id:1},url:"https://chatgpt.com/c/visible"};
  const send = (input=message, origin=sender) => new Promise((resolve)=>listener(input,origin,resolve));
  assert.ok((await send()).error);
  assert.equal(requests.length,0);
  state={consent:true,chatgpt:true,claude:false,paused:false,auto:false,token:"ctm_capture_only_fixture",endpoint:"http://127.0.0.1:8000",project:"project-id"};
  assert.ok((await send({...message,automatic:true})).error);
  assert.ok((await send(message,{tab:{id:2},url:"https://claude.ai/chat/visible"})).error);
  assert.equal(requests.length,0);
  assert.ok((await send()).status);
  assert.equal(requests.length,1);
  assert.equal(requests[0].options.headers.Authorization,"Bearer ctm_capture_only_fixture");
  assert.equal(JSON.parse(requests[0].options.body).project_id,"project-id");
  await send();
  assert.equal(requests.length,1);
  const status = await send({type:"status",provider:"chatgpt"});
  assert.deepEqual(status,{active:true,auto:false});
  state.paused=true;
  assert.ok((await send()).error);
  state.paused=false; offline=true;
  const changed={...message,messages:[{role:"user",content:"We decided to use a private SQLite database for this project."}]};
  await send(changed);
  assert.equal(state.queue.length,1);
  assert.equal(state.queue[0].attempts,1);
  assert.ok(state.queue[0].next > Date.now());
  const persisted=structuredClone(state);
  assert.equal(persisted.queue[0].project,"project-id");
  assert.ok(!JSON.stringify(state.history).includes("ctm_"));
  offline=false;state.queue[0].next=0;
  await send(changed);
  assert.equal(state.queue.length,0);
  assert.equal(requests.length,3);
  state.consent=false;
  assert.ok((await send()).error);
  assert.equal(requests.length,3);
});
