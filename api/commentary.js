// Vercel Function (Web Handler): POST /api/commentary
// 비밀 키는 서버 환경변수 OPENROUTER_API_KEY 에서만 읽습니다. 브라우저로는 절대 나가지 않습니다.

const MODELS = [
  process.env.OPENROUTER_MODEL,
  'google/gemma-4-31b-it:free',
  'poolside/laguna-s-2.1:free',
  'poolside/laguna-xs-2.1:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
].filter(Boolean);

const WINNERS = { black: '흑', white: '백', draw: '무승부' };
const MODES = { pvp: '2인 대전', ai: 'AI 대전' };
const MAX_MOVES = 225; // 15 x 15
const DEADLINE_MS = 18000; // 모든 모델 시도에 쓸 수 있는 전체 시간

export const config = { maxDuration: 25 };

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// 모델이 길게 답해도 첫 문장만 쓰고, 너무 길면 자름
function oneLine(text) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  const first = flat.match(/^.*?[.!?。…](?=\s|$)/)?.[0] ?? flat;
  return first.length > 100 ? first.slice(0, 99) + '…' : first;
}

export async function POST(request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: 'server_not_configured' }, 500);

  // 같은 사이트에서 온 요청만 허용 (다른 사이트가 내 무료 한도를 쓰지 못하게)
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return json({ error: 'forbidden' }, 403);

  let data;
  try { data = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  // 입력은 정해진 값만 받아서 직접 문장을 만듭니다 (사용자가 보낸 글을 프롬프트에 그대로 넣지 않음)
  const winner = WINNERS[data?.winner];
  const mode = MODES[data?.mode] ?? MODES.ai;
  const moves = Number(data?.totalMoves);
  if (!winner || !Number.isInteger(moves) || moves < 1 || moves > MAX_MOVES) {
    return json({ error: 'bad_input' }, 400);
  }

  const resultText = data.winner === 'draw'
    ? `${mode}에서 판이 가득 차 총 ${moves}수 만에 무승부로 끝났다.`
    : `${mode}에서 ${winner}이 총 ${moves}수 만에 승리했다.`;

  const deadline = Date.now() + DEADLINE_MS;
  for (const model of MODELS) {
    const left = deadline - Date.now();
    if (left < 2000) break;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 400, // 생각하는 모델은 답 전에 토큰을 쓰므로 넉넉히
          temperature: 0.8,
          messages: [
            { role: 'system', content: '너는 오목 경기 해설가다. 경기 결과를 보고 재치 있는 해설을 한국어 딱 한 문장(60자 이내)으로만 말한다. 결과를 평가하거나 분석하지 말고, 따옴표, 줄바꿈, 설명은 쓰지 않는다.' },
            { role: 'user', content: resultText },
          ],
        }),
        signal: AbortSignal.timeout(Math.min(8000, left)),
      });
      if (!res.ok) continue; // 429(무료 한도) 등이면 다음 모델로
      const line = oneLine((await res.json())?.choices?.[0]?.message?.content);
      if (line) return json({ comment: line });
    } catch {
      // 시간 초과나 네트워크 오류면 다음 모델로 넘어감
    }
  }
  return json({ error: 'ai_unavailable' }, 502);
}
