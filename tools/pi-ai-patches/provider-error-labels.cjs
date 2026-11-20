// pi-ai's Responses client labels every failure "OpenAI API error" because the
// request had the OpenAI Responses shape, whichever provider answered: Design
// Studio's own connector (the customer's default model, Muse or DeepSeek) came
// back as "OpenAI API error (422)" and read as the wrong model being used. The
// label follows the provider: OpenAI's own endpoint keeps its name, anything
// else is "Model provider error".
const fs=require('node:fs/promises'),path=require('node:path');
const COPIES=['app/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js','app/native-runtime/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js'];
const OLD_FN='function formatOpenAIResponsesError(error) {\n    return formatProviderError(normalizeProviderError(error), "OpenAI API error");\n}';
const NEW_FN='function formatOpenAIResponsesError(error, model) {\n    // Ironleaf: the label names the provider that answered, not the request shape\n    const openai = !model || model.provider === "openai" || /(^|\\.)openai\\.com$/.test((() => { try { return new URL(model.baseUrl).hostname; } catch { return ""; } })());\n    return formatProviderError(normalizeProviderError(error), openai ? "OpenAI API error" : "Model provider error");\n}';
const OLD_CALL='output.errorMessage = formatOpenAIResponsesError(error);',NEW_CALL='output.errorMessage = formatOpenAIResponsesError(error, model);';
// pi-ai 0.87.1 (DSH 0.2.0) labels by the connection's id instead ("<provider> API error"), and the former host app's
// connection ids are made up (model-1dc56fab-…): the person would read a random id. OpenAI keeps its name; anything else
// is still "Model provider error".
const OLD_087='`${model.provider === "openai" ? "OpenAI" : model.provider} API error`';
const NEW_087='(model.provider === "openai" ? "OpenAI API error" : "Model provider error") /* Ironleaf: never a connection id */';
function patch(text){
 if(text.includes('Model provider error'))return {out:text,changes:0};
 if(text.split(OLD_087).length===2)return {out:text.replace(OLD_087,()=>NEW_087),changes:1};
 if(!text.includes(OLD_FN)||!text.includes(OLD_CALL))throw Error('provider error labels: pi-ai openai-responses.js has changed shape');
 return {out:text.replace(OLD_FN,NEW_FN).replace(OLD_CALL,NEW_CALL),changes:2};
}
async function apply(resources){
 let patched=0;
 for(const rel of COPIES){const file=path.join(resources,rel);const text=await fs.readFile(file,'utf8').catch(()=>null);if(text===null)continue;const {out,changes}=patch(text);if(changes){await fs.writeFile(file,out);patched++;}else patched++;}
 // A tree without the engine (the release review's core; engine-present.cjs) has no pi-ai to patch.
 if(!patched){if(await require('./engine-present.cjs').enginePresent(resources))throw Error('provider error labels: no pi-ai copy found');return {skipped:'no engine in this tree'}}
 console.log('Provider error labels: '+patched+' pi-ai copies');
}
module.exports={apply,patch};
if(require.main===module)apply(path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1});
