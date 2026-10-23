// Rollout policy for this diagnostic candidate. Model suggestions are not staff approvals.
export function createReviewFirstClassifier(classify){
  if(typeof classify!=='function')throw TypeError('Classifier callback required');
  return async input=>{
    const result=await classify(input);
    if(result?.decision!=='jewelry')return result;
    return {...result,decision:'uncertain',reason:'AI已建议品类和款式标签，须由管理者核对图片后确认收入图库。'};
  };
}
