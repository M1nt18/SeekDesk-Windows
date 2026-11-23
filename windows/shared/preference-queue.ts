/** Optimistic display, serialized patches, and a separate durable snapshot. */
export class PreferenceQueue<T extends object>{
  private committed:T;private requested:T;private version=0;private generation=0;private queue:Promise<unknown>=Promise.resolve();
  constructor(initial:T,private persist:(value:T)=>Promise<T>,private display:(value:T)=>void){this.committed={...initial};this.requested={...initial};}
  replace(value:T){this.generation++;this.committed={...value};this.requested={...value};this.version++;this.display({...value});}
  submitValue(value:T){const patch:Partial<T>={};for(const key of Object.keys(value) as (keyof T)[])if(!Object.is(value[key],this.requested[key]))patch[key]=value[key];return this.submit(patch);}
  submit(patch:Partial<T>):Promise<T>{
    const change={...patch},version=++this.version,generation=this.generation;this.requested={...this.requested,...change};this.display({...this.requested});
    const task=this.queue.catch(()=>{}).then(async()=>{
      if(generation!==this.generation)return {...this.committed};
      const saved=await this.persist({...this.committed,...change});
      if(generation===this.generation)this.committed={...saved};
      return saved;
    });
    this.queue=task;
    return task.then(saved=>{if(version===this.version){this.requested={...saved};this.display({...saved});}return saved;},error=>{if(version===this.version){this.requested={...this.committed};this.display({...this.committed});}throw error;});
  }
}
