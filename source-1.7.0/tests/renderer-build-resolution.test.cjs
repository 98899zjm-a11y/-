'use strict';
// Build-only regression using the sealed, data-free portable QA dependencies.
// No application renderer, Electron, business EXE, database or device is run.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');

test('renderer build initializes chart and validation dependencies through browser module resolution',async()=>{
 const {dependenciesRoot:dependencies,viteEntry,configFile}=require('./renderer-build-tool-loader.cjs').loadRendererBuildTool();
 const before=process.env.XJY_BUILD_DEPENDENCIES_ROOT;
 process.env.XJY_BUILD_DEPENDENCIES_ROOT=dependencies;
 try{
  const vite=await import(pathToFileURL(viteEntry).href),entry=path.join(__dirname,'__xjy_in_memory_build_entry__.js'),virtual='\0xjy-synthetic-browser-build';
  const loaded=await vite.loadConfigFromFile({command:'build',mode:'production'},configFile,root,'silent',undefined,'runner');
  const result=await vite.build({...loaded.config,configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[{
   name:'xjy-synthetic-browser-entry',resolveId(id){return path.resolve(id)===entry?virtual:null;},load(id){return id===virtual?'import React from "react";import {BarChart,ResponsiveContainer} from "recharts";import {z} from "zod";export const chart=React.isValidElement(React.createElement(BarChart,{data:[]}));export const container=React.isValidElement(React.createElement(ResponsiveContainer,{}));export const parsed=z.object({label:z.string()}).parse({label:"synthetic build fixture"}).label;':null;}
  },...loaded.config.plugins],build:{write:false,minify:true,lib:{entry,formats:['es']},rolldownOptions:{input:entry}}});
  const output=Array.isArray(result)?result.flatMap(value=>value.output):result.output,chunks=output.filter(value=>value.type==='chunk');
  assert.equal(chunks.length,1,'The pure fixture must be a self-contained module');
  let evaluated;
  try{const built=await import('data:text/javascript;base64,'+Buffer.from(chunks[0].code).toString('base64'));evaluated={chart:built.chart,container:built.container,parsed:built.parsed};}
  catch(error){evaluated={error:error.name+': '+error.message};} // Keep data-URL stacks out of diagnostics.
  assert.deepEqual(evaluated,{chart:true,container:true,parsed:'synthetic build fixture'});
 }finally{if(before===undefined)delete process.env.XJY_BUILD_DEPENDENCIES_ROOT;else process.env.XJY_BUILD_DEPENDENCIES_ROOT=before;}
});
