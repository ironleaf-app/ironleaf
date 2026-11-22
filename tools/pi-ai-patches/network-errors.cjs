// A model call that never reached its provider says why, in plain words (1.9, company networks). The model SDKs wrap
// every network failure as "Connection error." and pi-ai shows that message: behind a company proxy, with secure traffic
// checked by the organisation's own certificate, or with a wrong proxy address, the person saw "Connection error." and
// nothing to act on. The reason is in the error's cause chain (ECONNREFUSED, SELF_SIGNED_CERT_IN_CHAIN, a 407 from the
// proxy…): pi-ai's normalizeProviderError now reads it when no HTTP status came back, and names what to do and where
// (Settings › Network, src/network.cjs, whose advice() says the same).
const fs=require('node:fs/promises'),path=require('node:path');
const COPIES=['app/native-runtime/node_modules/@earendil-works/pi-ai/dist/utils/error-body.js','app/node_modules/@earendil-works/pi-ai/dist/utils/error-body.js'];
const BEFORE='export function normalizeProviderError(error) {\n    if (!(error instanceof Error)) {\n        return { message: safeJsonStringify(error), messageCarriesBody: false };\n    }\n    const sdkError = error;\n    const status = extractStatus(sdkError);';
const AFTER='export function normalizeProviderError(error) {\n    if (!(error instanceof Error)) {\n        return { message: safeJsonStringify(error), messageCarriesBody: false };\n    }\n    const sdkError = error;\n    const status = extractStatus(sdkError);\n    // Ironleaf: a call that never reached the provider says why (network-errors.cjs).\n    const network = status === undefined ? networkReasonFromCause(error) : null;\n    if (network) return { message: network, messageCarriesBody: true };';
const HELPER=`
// Ironleaf: the reason a connection failed, from the error's cause chain.
function networkReasonFromCause(error) {
    let text = "", node = error;
    for (let depth = 0; node && depth < 6; depth++, node = node.cause) text += " " + String(node.code || "") + " " + String(node.message || "");
    const where = " Check Settings \\u203a Network.";
    if (/UNABLE_TO_GET_ISSUER_CERT|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED|UNABLE_TO_VERIFY_LEAF|CERT_UNTRUSTED/.test(text)) return "Could not connect to the model provider: your network checks secure connections with its own certificate, which Ironleaf does not trust yet. Turn on \\u201cTrust certificates installed in Windows\\u201d, or add your organisation\\u2019s certificate file." + where;
    if (/CERT_HAS_EXPIRED/.test(text)) return "Could not connect to the model provider: the secure certificate on this network has expired. Ask your IT team to check it.";
    if (/\\b407\\b|Proxy Authentication/i.test(text)) return "Could not connect to the model provider: the proxy asks Ironleaf to sign in. Put the user name and password in the proxy address, or ask your IT team to let Ironleaf\\u2019s model services through." + where;
    if (/ECONNREFUSED/.test(text)) return "Could not connect to the model provider: nothing answered at the proxy or server address." + where;
    if (/ENOTFOUND|EAI_AGAIN/.test(text)) return "Could not connect to the model provider: its address could not be found. Check that this PC is online, or the proxy address." + where;
    if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|ECONNRESET/.test(text)) return "Could not connect to the model provider: the connection timed out or was cut. The network may be blocking it." + where;
    return null;
}
`;
// What any earlier version of this patch put in (its comment named NeuralSpark, NeuralVault or Ironleaf, its helper
// neuralSparkNetworkReason or networkReasonFromCause). A copy patched under the old name and then again under the new
// one held both, declared `network` twice and failed to load, so every model call failed: such a copy is taken back to
// pi-ai's own code first, then patched once.
const OLD_CALL=/\n    \/\/ (?:NeuralSpark|NeuralVault|Ironleaf)\b[^\n]*\n    const network = status === undefined \? (?:neuralSparkNetworkReason|networkReasonFromCause)\(error\) : null;\n    if \(network\) return \{ message: network, messageCarriesBody: true \};/g;
const OLD_HELPER=/\n*\/\/ (?:NeuralSpark|NeuralVault|Ironleaf)\b[^\n]*\nfunction (?:neuralSparkNetworkReason|networkReasonFromCause)\(error\) \{\n[\s\S]*?\n    return null;\n\}\n/g;
function unpatch(source){
 return source.replace(OLD_CALL,'').replace(OLD_HELPER,'\n');
}
function patch(source){
 const calls=(source.match(/const network = status === undefined/g)||[]).length;
 const helpers=(source.match(/\nfunction (?:neuralSparkNetworkReason|networkReasonFromCause)\(/g)||[]).length;
 if(calls===1&&helpers===1&&source.includes('networkReasonFromCause(error)')&&!source.includes('neuralSparkNetworkReason'))return source;
 const plain=calls||helpers?unpatch(source):source;
 if(plain.split(BEFORE).length!==2||plain.includes('const network = status'))throw Error('pi-ai normalizeProviderError changed: check the network error wording before packaging.');
 return plain.replace(BEFORE,()=>AFTER).replace(/\n*$/,'\n')+HELPER;
}
async function apply(resources){
 for(const rel of COPIES){
  const name=path.join(resources,rel);let source;try{source=await fs.readFile(name,'utf8')}catch{continue}
  const next=patch(source);if(next!==source)await fs.writeFile(name,next);
 }
}
module.exports={patch,unpatch,apply,BEFORE};
