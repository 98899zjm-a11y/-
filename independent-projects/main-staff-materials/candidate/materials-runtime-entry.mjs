// Trusted host composition only. Importing this module opens no profile or listener.
import {openProfileLibrary} from './materials/lib/storage-profile.mjs';
import {createMountedMaterials} from './mounted-materials.mjs';
import {createMaterialSessionTransport} from './materials-session-transport.mjs';
import {createClassifier} from './materials/lib/classifier.mjs';
import {createReviewFirstClassifier} from './materials/lib/review-first.mjs';
import {validateOrigin} from './materials/auth/lib/access-adapter.mjs';

export async function createMaterialRuntimeSuite({origin,dataRoot,classify}={}){
 validateOrigin(origin);
 const rawClassifier=classify??createClassifier({model:'qwen3-vl:4b-instruct'});
 const library=await openProfileLibrary({dataRoot,classify:createReviewFirstClassifier(rawClassifier)});
 let closed=false,closing;
 const ownedContext=context=>({...context,isLive:()=>!closed&&typeof context?.isLive==='function'&&context.isLive()===true});
 try{
  const mounted=createMountedMaterials({library,origin}),transport=createMaterialSessionTransport({library,origin});
  return Object.freeze({
   handle:(req,res,context)=>mounted(req,res,ownedContext(context)),
   sessionRequest:(input,context)=>transport(input,ownedContext(context)),
   close(){if(!closing){closed=true;closing=library.close();}return closing;},
  });
 }catch(error){closed=true;try{await library.close();}catch(cleanup){error.cleanupError=cleanup.message;}throw error;}
}
