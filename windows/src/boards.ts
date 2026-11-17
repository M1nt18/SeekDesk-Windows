import { Code2, Coffee, Compass, Image, Leaf, LockKeyhole, Megaphone, Monitor, Radio, ShieldCheck, ShoppingBag, Tag, Terminal, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const boards: {id:string;name:string;icon:LucideIcon}[] = [
  {id:'',name:'最新帖子',icon:Compass}, {id:'daily',name:'日常',icon:Coffee}, {id:'tech',name:'技术',icon:Code2},
  {id:'info',name:'情报',icon:Radio}, {id:'review',name:'测评',icon:Monitor}, {id:'trade',name:'交易',icon:Tag},
  {id:'carpool',name:'拼车',icon:Users}, {id:'dev',name:'Dev',icon:Terminal}, {id:'photo-share',name:'贴图',icon:Image},
  {id:'promotion',name:'推广',icon:Megaphone}, {id:'life',name:'生活',icon:Leaf}, {id:'inside',name:'内版',icon:LockKeyhole},
  {id:'sandbox',name:'沙盒',icon:ShoppingBag}, {id:'expose',name:'曝光',icon:ShieldCheck},
];

export const boardName = (id:string) => id==='award'?'精品区':boards.find(board=>board.id===id)?.name || id || '社区';
