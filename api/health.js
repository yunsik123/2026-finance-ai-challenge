import fs from 'fs';
import path from 'path';

function hasApiKey() {
  if (process.env.OPENAI_API_KEY || process.env.SGLLM_API_KEY || process.env.GPT_API_KEY) return true;
  for (const filename of ['.env.gptapi', '.env.local', '.env', '.env.development.local']) {
    try {
      const fullPath = path.resolve(process.cwd(), filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8').trim();
        if (content.startsWith('sk-') || /OPENAI_API_KEY|SGLLM_API_KEY|GPT_API_KEY/.test(content)) return true;
      }
    } catch {}
  }
  return false;
}

export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const chatModel = (process.env.MOA_CHAT_MODEL && !['gpt-5.6-luna', 'luna'].includes(process.env.MOA_CHAT_MODEL))
    ? process.env.MOA_CHAT_MODEL
    : (process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini');
  const ocrModel = (process.env.MOA_OCR_MODEL && !['claude-haiku-4-5-20251001', 'gpt-5.6-luna', 'luna'].includes(process.env.MOA_OCR_MODEL))
    ? process.env.MOA_OCR_MODEL
    : (process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini');

  response.status(200).json({
    ok: true,
    apiConfigured: hasApiKey(),
    supabaseConfigured: Boolean(process.env.VITE_SUPABASE_URL && (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)),
    financialVerificationConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    chatModel,
    ocrModel,
    ocrEngine: 'openai-vision',
    storage: 'supabase'
  });
}
