import {randomUUID} from 'node:crypto';

export function createSearchJobs(search, environment = process.env) {
  const jobs = new Map();
  const snapshot = job => ({id:job.id,revision:job.revision,status:job.status,result:job.result,error:job.error});
  return {
    start(input) {
      for (const [id,job] of jobs) if(Date.now()-job.created>180_000) {
        job.controller.abort(); jobs.delete(id);
      }
      if(jobs.size>=16) {
        const old=[...jobs.values()].find(job=>job.status!=='running');
        if(old)jobs.delete(old.id);
        else throw new Error('Too many active searches. Cancel an earlier search first.');
      }
      const job={id:randomUUID(),created:Date.now(),revision:0,status:'running',result:null,error:'',controller:new AbortController()};
      jobs.set(job.id,job);
      setTimeout(()=>{job.controller.abort();jobs.delete(job.id);},180_000).unref();
      Promise.resolve().then(()=>search(input,environment,{signal:job.controller.signal,onProgress:result=>{
        if(job.status!=='running')return;
        job.result=structuredClone(result);job.revision++;
      }})).then(result=>{
        if(job.status!=='running')return;
        job.result={...result,pending:false,stage:'complete'};job.status='complete';job.revision++;
      },error=>{
        if(job.status!=='running')return;
        job.status='failed';job.error=error.message;job.revision++;
      });
      return snapshot(job);
    },
    get(id) {const job=jobs.get(id);return job?snapshot(job):null;},
    cancel(id) {
      const job=jobs.get(id);
      if(!job)return null;
      if(job.status==='running'){job.status='cancelled';job.controller.abort();job.revision++;}
      return snapshot(job);
    },
  };
}
