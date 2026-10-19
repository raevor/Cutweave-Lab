// Offline shader syntax/type validation only. Never creates a GPU or loads media.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'.cache/wgsl-validator');
function declarations(file,names){
  const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);
  const printer=ts.createPrinter();
  const selected=source.statements.filter(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>names.includes(d.name.getText(source))));
  if(selected.length!==names.length)throw new Error('Missing shader declaration');
  return ts.transpileModule(selected.map(s=>printer.printNode(ts.EmitHint.Unspecified,s,source)).join('\n'),
    {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const finishing=declarations('src/lib/video-enhancer/gpu-finishing.ts',['parameters','common','pack']);
const shaders=new Function(finishing+';return {common,pack};')();
const reconstruction=declarations('src/lib/video-enhancer/rgb-restoration-gpu.ts',['preprocessShader','postprocessShader','presentShader']);
Object.assign(shaders,new Function(reconstruction+`;return {
  pre32:preprocessShader(false),post32:postprocessShader(false),
  pre16:preprocessShader(true),post16:postprocessShader(true),presentShader};`)());
for(const [name,shader] of Object.entries(shaders)){
  const target=path.join(directory,name+'.wgsl');fs.writeFileSync(target,shader);
  const result=spawnSync(process.execPath,[path.join(directory,'package/bin/naga.mjs'),'.cache/wgsl-validator/'+name+'.wgsl'],{encoding:'utf8',cwd:root});
  if(result.status!==0)throw new Error(name+': '+result.stdout+result.stderr);
  console.log(name+': WGSL validation passed');
}
