import {Component,lazy,Suspense,useRef,type ComponentType,type ReactNode} from 'react';
import {Loading,Modal} from './shared-ui';
class PanelLoadBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}>{
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}
export function deferPanel<P extends object>(load:()=>Promise<{default:ComponentType<P>}>,modalTitle?:string,peek?:()=>ComponentType<P>|undefined){
  const Panel=lazy(load) as ComponentType<P>;
  return function DeferredPanel(props:P){
    // Choose once per mount: switching a lazy type to its resolved function
    // during editing could otherwise remount the editor and reset its state.
    const Ready=useRef(peek?.()||Panel).current;
    const navigation=props as {onClose?:()=>void;onBack?:()=>void},back=navigation.onClose||navigation.onBack;
    const fallback=(failed=false)=>{const body=<>{failed?<p role="alert">页面暂未能打开，请返回阅读；若仍失败，请重新启动客户端。</p>:<Loading label="正在打开…"/>}{!modalTitle&&back&&<button className="secondary-button" onClick={back}>返回论坛</button>}</>;return modalTitle?<Modal title={modalTitle} onClose={()=>back?.()}>{body}</Modal>:<div className="deferred-panel">{body}</div>;};
    return <PanelLoadBoundary fallback={fallback(true)}><Suspense fallback={fallback()}><Ready {...props}/></Suspense></PanelLoadBoundary>;
  };
}
