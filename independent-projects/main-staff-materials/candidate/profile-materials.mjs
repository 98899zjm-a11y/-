import {createMountedMaterials} from './mounted-materials.mjs';
import {openProfileLibrary} from './materials/lib/storage-profile.mjs';
import {createClassifier} from './materials/lib/classifier.mjs';
import {createReviewFirstClassifier} from './materials/lib/review-first.mjs';

function validOrigin(origin){
 if(typeof origin!=='string')return false;
 const prefix='http://127.0.0.1:';
 if(!origin.startsWith(prefix))return false;
 const value=origin.slice(prefix.length);
 if(!/^[1-9][0-9]{0,4}$/.test(value))return false;
 const port=Number(value);
 if(!Number.isSafeInteger(port)||port<1||port>65535)return false;
 return origin===prefix+port;
}

function trustedClassifier(classify){
 if(classify!==undefined&&typeof classify!=='function')throw new TypeError('classify 必须为可信函数');
 if(classify!==undefined)return classify;
 return createReviewFirstClassifier(createClassifier({model:'qwen3-vl:4b-instruct'}));
}

export async function createProfileMaterialsService({origin,dataRoot,classify}={}){
 if(!validOrigin(origin))throw new TypeError('素材服务只接受 http://127.0.0.1:有效端口');
 const classifier=trustedClassifier(classify);
 const library=await openProfileLibrary({dataRoot,classify:classifier});
 let mounted;
 try{mounted=createMountedMaterials({library,origin});}
 catch(error){await library.close();throw error;}
 let closePromise=null;
 const close=()=>{
  if(closePromise)return closePromise;
  closePromise=(async()=>{await library.close();})();
  return closePromise;
 };
 return Object.freeze({handle:mounted,close});
}
