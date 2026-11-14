import { GoogleGenAI } from '@google/genai';

const ALLOWED_VOICES = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);

interface VercelReq {
  method?: string;
  body?: { word?: unknown; voiceName?: unknown };
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (payload: unknown) => void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawWord = typeof req.body?.word === 'string' ? req.body.word.trim() : '';
  const rawVoice =
    typeof req.body?.voiceName === 'string' ? req.body.voiceName.trim() : 'Kore';
  const voiceName = ALLOWED_VOICES.has(rawVoice) ? rawVoice : 'Kore';

  if (!rawWord || rawWord.length > 60 || !/^[a-zA-Z-]+$/.test(rawWord)) {
    res.status(400).json({ error: 'Invalid word parameter' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    res.status(503).json({ fallback: true, error: 'GEMINI_API_KEY_NOT_CONFIGURED' });
    return;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Say ${rawWord}.`,
              speechMetadata: {
                style:
                  'Clear, articulate spelling bee announcer speaking distinctly at a natural pace',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      res.status(500).json({ fallback: true, error: 'EMPTY_TTS_AUDIO' });
      return;
    }

    res.status(200).json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      provider: 'gemini',
    });
  } catch (err) {
    res.status(500).json({
      fallback: true,
      error: err instanceof Error ? err.message : 'TTS generation failed',
    });
  }
}
