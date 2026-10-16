// Vercel Function (Web Handler): /api/scores
//   POST : 게임 기록 한 건 저장   { playerName, result, moves }
//   GET  : 최근 기록 10건 조회
// Supabase 비밀 키는 서버 환경변수(SUPABASE_URL, SUPABASE_SECRET_KEY)에서만 읽습니다.
// scores 테이블은 RLS가 켜져 있고 정책이 없어서, 이 함수(Secret key)를 거치지 않으면 읽고 쓸 수 없습니다.

export const config = { maxDuration: 10 };

const RESULTS = ['흑 승리', '백 승리', '무승부'];
const MAX_MOVES = 225; // 15 x 15

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// 같은 사이트에서 온 요청만 허용
function isSameSite(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  return !(origin && host && new URL(origin).host !== host);
}

// Supabase Data API(REST) 호출. 새 방식 Secret key는 apikey 헤더로만 보냅니다.
async function supabase(path, init = {}) {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) return null;
  return fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(8000),
  });
}

export async function POST(request) {
  if (!isSameSite(request)) return json({ error: 'forbidden' }, 403);

  let data;
  try { data = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  // 서버에서 한 번 더 검사 (테이블의 check 조건과 같은 규칙)
  const playerName = typeof data?.playerName === 'string' ? data.playerName.trim() : '';
  const moves = Number(data?.moves);
  if (playerName.length < 1 || playerName.length > 20) return json({ error: 'bad_name' }, 400);
  if (!RESULTS.includes(data?.result)) return json({ error: 'bad_result' }, 400);
  if (!Number.isInteger(moves) || moves < 1 || moves > MAX_MOVES) return json({ error: 'bad_moves' }, 400);

  try {
    const res = await supabase('scores', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ player_name: playerName, result: data.result, moves }),
    });
    if (!res) return json({ error: 'server_not_configured' }, 500);
    if (!res.ok) return json({ error: 'db_error' }, 502);
    return json({ ok: true }, 201);
  } catch {
    return json({ error: 'db_unavailable' }, 502);
  }
}

export async function GET(request) {
  if (!isSameSite(request)) return json({ error: 'forbidden' }, 403);
  try {
    const res = await supabase('scores?select=player_name,result,moves,created_at&order=created_at.desc&limit=10');
    if (!res) return json({ error: 'server_not_configured' }, 500);
    if (!res.ok) return json({ error: 'db_error' }, 502);
    return json({ scores: await res.json() });
  } catch {
    return json({ error: 'db_unavailable' }, 502);
  }
}
