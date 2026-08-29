export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json({
    ok: true,
    apiConfigured: Boolean(process.env.SGLLM_API_KEY),
    supabaseConfigured: Boolean(process.env.VITE_SUPABASE_URL && (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)),
    chatModel: process.env.MOA_CHAT_MODEL || 'gpt-5.6-luna',
    ocrModel: process.env.MOA_OCR_MODEL || 'claude-haiku-4-5-20251001',
    ocrEngine: 'cloud-fallback',
    storage: 'supabase'
  });
}
