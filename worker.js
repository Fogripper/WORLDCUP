const FLAGS = {
  "Bosnia and Herzegovina":"🇧🇦","Canada":"🇨🇦","United States":"🇺🇸","Paraguay":"🇵🇾",
  "Qatar":"🇶🇦","Switzerland":"🇨🇭","Brazil":"🇧🇷","Morocco":"🇲🇦","Haiti":"🇭🇹",
  "Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","Australia":"🇦🇺","Turkey":"🇹🇷","Germany":"🇩🇪","Curaçao":"🇨🇼",
  "Netherlands":"🇳🇱","Japan":"🇯🇵","Ivory Coast":"🇨🇮","Ecuador":"🇪🇨","Sweden":"🇸🇪",
  "Tunisia":"🇹🇳","Argentina":"🇦🇷","England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","France":"🇫🇷","Spain":"🇪🇸",
  "Portugal":"🇵🇹","Belgium":"🇧🇪","Mexico":"🇲🇽","Uruguay":"🇺🇾","Colombia":"🇨🇴",
  "South Korea":"🇰🇷","Nigeria":"🇳🇬","Senegal":"🇸🇳","Denmark":"🇩🇰","Croatia":"🇭🇷",
  "Poland":"🇵🇱","Serbia":"🇷🇸","Iran":"🇮🇷","South Africa":"🇿🇦","New Zealand":"🇳🇿",
  "Saudi Arabia":"🇸🇦","Costa Rica":"🇨🇷","Panama":"🇵🇦","Honduras":"🇭🇳","Jamaica":"🇯🇲",
  "Venezuela":"🇻🇪","Peru":"🇵🇪","Chile":"🇨🇱","Algeria":"🇩🇿","Egypt":"🇪🇬",
  "Mali":"🇲🇱","Ghana":"🇬🇭","Cameroon":"🇨🇲","China":"🇨🇳","Indonesia":"🇮🇩",
  "Iraq":"🇮🇶","Ukraine":"🇺🇦","Romania":"🇷🇴","Slovakia":"🇸🇰","Austria":"🇦🇹","Norway":"🇳🇴","Cape Verde":"🇨🇻","Congo":"🇨🇬","Uzbekistan":"🇺🇿","Czech Republic":"🇨🇿","Czechia":"🇨🇿",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // --- API: zápasy ---
    if (url.pathname === "/api/matches") {
      const resp = await fetch("https://api.football-data.org/v4/competitions/2000/matches?stage=GROUP_STAGE", {
        headers: { "X-Auth-Token": env.FOOTBALL_API_TOKEN },
      });
      if (!resp.ok) return new Response(JSON.stringify({ error: "API error" }), { status: resp.status, headers: { ...cors, "Content-Type": "application/json" } });
      const data = await resp.json();
      const matches = (data.matches || []).map(m => {
        const h = m.homeTeam.name || "?", a = m.awayTeam.name || "?";
        const d = new Date(m.utcDate);
        const sc = m.score && m.score.fullTime;
        return {
          id: "m" + m.id, home: h, away: a,
          homeFlag: FLAGS[h] || "🏳️", awayFlag: FLAGS[a] || "🏳️",
          group: (m.group || "").replace("GROUP_", ""),
          date: d.toLocaleDateString("cs", { day: "numeric", month: "numeric", timeZone: "Europe/Prague" }),
          time: d.toLocaleTimeString("cs", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" }),
          status: m.status,
          score: ["FINISHED","IN_PLAY","PAUSED"].includes(m.status)
            ? { home: sc ? sc.home : 0, away: sc ? sc.away : 0, minute: m.minute || null }
            : null,
        };
      });
      return new Response(JSON.stringify({ matches }), {
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=120" }
      });
    }

    // --- API: stav (čtení) ---
    if (url.pathname === "/api/state" && request.method === "GET") {
      const value = await env.TIPPING_KV.get("ms2026_state");
      return new Response(value || "{}", { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // --- API: stav (zápis) ---
    if (url.pathname === "/api/state" && request.method === "POST") {
      const body = await request.text();
      try {
        JSON.parse(body);
        await env.TIPPING_KV.put("ms2026_state", body);
        return new Response('{"ok":true}', { headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response('{"error":"invalid json"}', { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // --- API: smazání uživatele ---
    if (url.pathname === "/api/delete-user" && request.method === "POST") {
      const body = await request.json();
      if (body.secret !== env.ADMIN_SECRET) return new Response('{"error":"forbidden"}', { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const value = await env.TIPPING_KV.get("ms2026_state");
      if (value) {
        const st = JSON.parse(value);
        const n = body.name;
        delete st.users[n]; delete st.tips[n]; delete st.champion[n];
        if (st.championLocked) delete st.championLocked[n];
        if (st.lockedTips) delete st.lockedTips[n];
        await env.TIPPING_KV.put("ms2026_state", JSON.stringify(st));
      }
      return new Response('{"ok":true}', { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // --- Vše ostatní: 404 (frontend je na Pages) ---
    return new Response("Not found", { status: 404 });
  },
};
