// Run in Node 24 with a fresh project key supplied securely in the process.
// This performs one small, billable Responses request. It never prints the key.
const key = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;
const transcription = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';
if (!key || !model) {
  console.error('Set OPENAI_API_KEY securely and choose OPENAI_MODEL before checking live AI access.');
  process.exit(1);
}
async function request(path, options = {}) {
  const response = await fetch('https://api.openai.com/v1/' + path, {
    ...options,
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw Error(`OpenAI ${path.split('/')[0]} check returned HTTP ${response.status}. Check project access and billing.`);
  return response.json();
}
try {
  for (const id of [model, transcription]) await request('models/' + encodeURIComponent(id));
  const result = await request('responses', {
    method: 'POST',
    body: JSON.stringify({
      model, store: false, max_output_tokens: 500,
      ...(model === 'gpt-6-luna' ? {reasoning: {effort: 'low'}} : {}),
      input: 'Return the JSON object with ready set to true.',
      text: {format: {type: 'json_schema', name: 'readiness', strict: true,
        schema: {type: 'object', properties: {ready: {type: 'boolean'}}, required: ['ready'], additionalProperties: false}}},
    }),
  });
  const text = result.output_text || result.output?.flatMap(x => x.content || [])
    .filter(x => x.type === 'output_text').map(x => x.text).join('');
  if (JSON.parse(text).ready !== true) throw Error('Responses did not return the expected structured result.');
  console.log(`Verified a live structured response using ${model}. Transcription model is accessible: ${transcription}.`);
  console.log('Actual voice transcription still requires a browser recording test; this check sends no audio.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
