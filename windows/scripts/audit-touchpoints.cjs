// Static binding inventory. This is a review index, not an execution-coverage claim.
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const project=path.resolve(__dirname,'..');
const files=[];
function collect(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(directory,entry.name);if(entry.isDirectory())collect(file);else if(entry.isFile()&&entry.name.endsWith('.tsx'))files.push(file);}}
collect(path.join(project,'src'));
const events=[],listeners=[];
function owner(node){for(let parent=node.parent;parent;parent=parent.parent){if((ts.isFunctionDeclaration(parent)||ts.isFunctionExpression(parent))&&parent.name)return parent.name.getText();if(ts.isArrowFunction(parent)&&ts.isVariableDeclaration(parent.parent))return parent.parent.name.getText();}return 'module/inline';}
for(const file of files){
  const relative=path.relative(project,file).replaceAll('\\','/'),source=ts.createSourceFile(relative,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function walk(node){
    const line=()=>source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
    if(ts.isJsxAttribute(node)&&/^on[A-Z]/.test(node.name.getText(source))){const tag=node.parent.parent.tagName?.getText(source)||'';events.push({file:relative,line:line(),component:owner(node),tag,event:node.name.getText(source),kind:/^[a-z]/.test(tag)?'DOM':'component callback',handler:node.initializer?.getText(source).slice(0,180)});}
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='addEventListener')listeners.push({file:relative,line:line(),component:owner(node),event:node.arguments[0]?.getText(source)});
    ts.forEachChild(node,walk);
  }
  walk(source);
}
const report={generatedAt:new Date().toISOString(),files:files.length,events,listeners,note:'Static binding inventory; counts are not end-to-end coverage.'};
const output=path.join(project,'verification','audit-2026-11-17');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'touchpoints.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({files:report.files,eventBindings:events.length,DOMBindings:events.filter(event=>event.kind==='DOM').length,globalListeners:listeners.length}));
