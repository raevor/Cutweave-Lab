/** Yield to cancellation/messages without the nested setTimeout 4 ms clamp.
 * This module is used only in the dedicated media worker. */
let channel:MessageChannel|null=null;
let pending:Array<()=>void>=[];
export function yieldToWorker():Promise<void>{
  const scheduler=(globalThis as typeof globalThis & {scheduler?:{yield:()=>Promise<void>}}).scheduler;
  if(scheduler?.yield)return scheduler.yield();
  if(!channel){
    channel=new MessageChannel();
    channel.port1.onmessage=()=>{const callbacks=pending;pending=[];for(const resolve of callbacks)resolve();};
  }
  return new Promise(resolve=>{pending.push(resolve);channel!.port2.postMessage(null);});
}
