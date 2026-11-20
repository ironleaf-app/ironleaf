// Prompt caching for Meta's Muse on Chat Completions (1.9, 3 Oct 2026). Spend Guard showed every Muse reply at the full
// input price,. Meta reports cached input in prompt_tokens_details.cached_tokens (priced at US$0.002 a million against
// US$0.10 on Muse Spark 1.3 Contributor), but only for a request carrying prompt_cache_key: three identical 7,600-token
// requests without it were all billed in full; with it, the 2nd and 3rd had 7,537 tokens served from cache (live test,
// Responses and Chat Completions alike). The engine's Chat Completions adapter (pi-ai) sends the key, the conversation's
// id, to api.openai.com only, and the former host app's Muse connections use Chat Completions, so every step paid full
// price for the same ~10K-token instructions and tools. The key now goes to Meta as it goes to OpenAI. Other
// OpenAI-compatible servers keep their request exactly as before (a strict server could refuse a field it does not know).
//
// The key names the request's shared opening (6 Oct 2026): the engine's key was the conversation's id, so the first step
// of every new conversation was stored on its own, though its ~7,000-token opening (the model, the instructions, the
// tools) was the same every time; a third of first steps got no cache at all (the dev app's ledger, 6 Oct: 25 of 80). The
// key is now a hash of the model, the instructions and the tool names: every conversation with the same opening shares
// its cache, and a conversation's later steps still match (the provider caches the longest prefix it has seen under that
// key). pi-ai 0.87.1 (DSH 0.2.0) carries the instructions and tools as the opening system message (its text, sections and
// toolsAdded); older ones as context.systemPrompt/tools.
const fs=require('node:fs/promises'),path=require('node:path');
const BEFORE='prompt_cache_key: (model.baseUrl.includes("api.openai.com") && cacheRetention !== "none") ||';
const AFTER='prompt_cache_key: ((model.baseUrl.includes("api.openai.com") || model.baseUrl.includes("api.meta.ai")) && cacheRetention !== "none") ||';
const KEY_BEFORE='clampOpenAIPromptCacheKey(options?.sessionId)';
const KEY_AFTER='clampOpenAIPromptCacheKey(nsPrefixCacheKey(model, context) ?? options?.sessionId)';
const KEY_FN='\n// Ironleaf: the prompt cache key names the shared opening (model, instructions, tool names), not the conversation.\nimport { shortHash as nsShortHash } from "../utils/hash.js";\nfunction nsPrefixCacheKey(model, context) { try { const text = c => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => typeof b === "string" ? b : b?.text ?? "").join("") : ""; const messages = Array.isArray(context?.messages) ? context.messages : []; const first = messages[0]?.role === "system" ? messages[0] : null; const opening = first ? [text(first.content), ...Object.values(first.sections ?? {}).filter((t) => typeof t === "string")].join("\\n\\n") : String(context?.systemPrompt || ""); const tools = (first?.toolsAdded ?? context?.tools ?? []).map((tool) => String(tool?.name || "")).join(","); return "ns-" + nsShortHash(String(model?.id || "") + "\\n" + opening + "\\n" + tools); } catch { return undefined; } }\n';
const withKey=(source,what)=>{
 if(source.includes(KEY_AFTER))return source;
 if(source.split(KEY_BEFORE).length!==2)throw Error('The '+what+' cache key line changed in pi-ai: check prompt caching before packaging.');
 return source.replace(KEY_BEFORE,()=>KEY_AFTER)+KEY_FN;
};
// Chat Completions (Muse, OpenAI and compatible servers): the key goes to Meta as to OpenAI, and names the opening.
function patch(source){
 if(!source.includes(AFTER)){
  if(source.split(BEFORE).length!==2)throw Error('The Chat Completions cache key line changed in pi-ai: check prompt caching for Meta before packaging.');
  source=source.replace(BEFORE,()=>AFTER);
 }
 return withKey(source,'Chat Completions');
}
// Responses (OpenAI connections set to it): the same key.
const patchResponses=source=>withKey(source,'Responses');
// The app carries two copies of the adapter (native-runtime's and the app's own node_modules); both are patched, as
// usage-display.cjs does for its files. Muse connections now use the Responses API (model-capabilities.cjs), where the
// engine already sends the key and Meta reports cached input; this keeps the key for a connection set to Chat Completions.
async function apply(resources){
 for(const root of ['app/native-runtime/node_modules','app/node_modules']){
  for(const [file,change] of [['openai-completions.js',patch],['openai-responses.js',patchResponses]]){
   const name=path.join(resources,root,'@earendil-works/pi-ai/dist/api',file);
   let source;try{source=await fs.readFile(name,'utf8')}catch{continue}
   const next=change(source);if(next!==source)await fs.writeFile(name,next);
  }
 }
}
module.exports={patch,patchResponses,apply,BEFORE,AFTER,KEY_BEFORE,KEY_AFTER};
