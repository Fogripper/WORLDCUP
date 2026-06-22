const FLAGS = {
  "Bosnia and Herzegovina":"🇧🇦","Bosnia-Herzegovina":"🇧🇦","Canada":"🇨🇦","United States":"🇺🇸","Paraguay":"🇵🇾",
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
  "Iraq":"🇮🇶","Ukraine":"🇺🇦","Romania":"🇷🇴","Slovakia":"🇸🇰","Austria":"🇦🇹","Norway":"🇳🇴","Cape Verde":"🇨🇻","Cape Verde Islands":"🇨🇻","Congo DR":"🇨🇬","Uzbekistan":"🇺🇿","Czech Republic":"🇨🇿","Czechia":"🇨🇿","Jordan":"🇯🇴",
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

    // --- API: stav (čtení) s automatickou kontrolou integrity ---
    if (url.pathname === "/api/state" && request.method === "GET") {
      const value = await env.TIPPING_KV.get("ms2026_state");
      if (!value) return new Response("{}", { headers: { ...cors, "Content-Type": "application/json" } });
      
      const state = JSON.parse(value);
      let changed = false;
      
      // Automatická kontrola — pokud hráč má v backupu více tipů, obnov
      for (const user in (state.users || {})) {
        const backupRaw = await env.TIPPING_KV.get("user_backup:" + user);
        if (!backupRaw) continue;
        const backup = JSON.parse(backupRaw);
        const currentCount = Object.keys((state.tips && state.tips[user]) || {}).length;
        const backupCount = Object.keys(backup.tips || {}).length;
        
        if (backupCount > currentCount) {
          if (!state.tips) state.tips = {};
          if (!state.tips[user]) state.tips[user] = {};
          if (!state.lockedTips) state.lockedTips = {};
          if (!state.lockedTips[user]) state.lockedTips[user] = {};
          for (const mid in backup.tips) {
            if (!state.tips[user][mid]) state.tips[user][mid] = backup.tips[mid];
          }
          for (const mid in backup.lockedTips) {
            if (!state.lockedTips[user][mid]) state.lockedTips[user][mid] = backup.lockedTips[mid];
          }
          changed = true;
        }
      }
      
      if (changed) {
        const merged = JSON.stringify(state);
        await env.TIPPING_KV.put("ms2026_state", merged);
        await env.TIPPING_KV.put("ms2026_backup", merged);
        return new Response(merged, { headers: { ...cors, "Content-Type": "application/json" } });
      }
      
      return new Response(value, { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // --- API: stav (zápis) ---
    if (url.pathname === "/api/state" && request.method === "POST") {
      const body = await request.text();
      try {
        const incoming = JSON.parse(body);
        const incomingUsers = Object.keys(incoming.users || {}).length;

        // Tip-level merge — nikdy nezapiš méně tipů než je v KV
        const existing = await env.TIPPING_KV.get("ms2026_state");
        if (existing) {
          const kv = JSON.parse(existing);
          
          // 1. Zachovej uživatele kteří chybí v příchozím stavu
          for (const u in (kv.users || {})) {
            if (!incoming.users[u]) {
              incoming.users[u] = kv.users[u];
            }
          }
          
          // 2. Tip-level merge — pro každého hráče zachovej každý tip který existuje v KV
          for (const u in (kv.tips || {})) {
            if (!incoming.tips) incoming.tips = {};
            if (!incoming.tips[u]) incoming.tips[u] = {};
            for (const mid in kv.tips[u]) {
              // Zachovej tip z KV pokud příchozí stav ho nemá
              if (!incoming.tips[u][mid]) {
                incoming.tips[u][mid] = kv.tips[u][mid];
              }
            }
          }
          
          // 3. Zachovej lockedTips z KV — uzamčený tip nelze oduzamknout
          for (const u in (kv.lockedTips || {})) {
            if (!incoming.lockedTips) incoming.lockedTips = {};
            if (!incoming.lockedTips[u]) incoming.lockedTips[u] = {};
            for (const mid in kv.lockedTips[u]) {
              if (!incoming.lockedTips[u][mid]) {
                incoming.lockedTips[u][mid] = kv.lockedTips[u][mid];
              }
            }
          }
          
          // 4. Zachovej šampióny z KV
          for (const u in (kv.champion || {})) {
            if (!incoming.champion) incoming.champion = {};
            if (!incoming.champion[u] && kv.champion[u]) {
              incoming.champion[u] = kv.champion[u];
            }
          }
        }

        const merged = JSON.stringify(incoming);
        await env.TIPPING_KV.put("ms2026_state", merged);
        // Záloha celého stavu
        await env.TIPPING_KV.put("ms2026_backup", merged);
        // Per-user backup tipů — ukládáme snapshot každého hráče zvlášť
        if (incoming.tips) {
          for (const user in incoming.tips) {
            const userSnapshot = {
              tips: incoming.tips[user] || {},
              lockedTips: (incoming.lockedTips && incoming.lockedTips[user]) || {},
              champion: incoming.champion && incoming.champion[user] || null,
              savedAt: new Date().toISOString()
            };
            await env.TIPPING_KV.put("user_backup:" + user, JSON.stringify(userSnapshot));
          }
        }
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

    // --- API: log čtení ---
    if (url.pathname === "/api/log" && request.method === "GET") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.ADMIN_SECRET) return new Response("forbidden", { status: 403 });
      const log = await env.TIPPING_KV.get("ms2026_log");
      return new Response(log || "[]", { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // --- API: log zápis ---
    if (url.pathname === "/api/log" && request.method === "POST") {
      const body = await request.text();
      try {
        const entries = JSON.parse(body);
        // Načti existující log a přidej nové záznamy
        const existing = await env.TIPPING_KV.get("ms2026_log");
        let log = existing ? JSON.parse(existing) : [];
        log = entries.concat(log);
        if (log.length > 5000) log = log.slice(0, 5000);
        await env.TIPPING_KV.put("ms2026_log", JSON.stringify(log));
        return new Response('{"ok":true}', { headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response('{"error":"invalid json"}', { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // --- API: automatická obnova chybějících tipů ---
    if (url.pathname === "/api/restore" && request.method === "POST") {
      const body = await request.json();
      if (body.secret !== env.ADMIN_SECRET) return new Response('{"error":"forbidden"}', { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      
      const stateRaw = await env.TIPPING_KV.get("ms2026_state");
      if (!stateRaw) return new Response('{"error":"no state"}', { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
      const state = JSON.parse(stateRaw);
      
      let restored = [];
      let changed = false;
      
      // Pro každého hráče zkontroluj jeho backup
      for (const user in state.users) {
        const backupRaw = await env.TIPPING_KV.get("user_backup:" + user);
        if (!backupRaw) continue;
        const backup = JSON.parse(backupRaw);
        
        const currentTipCount = Object.keys((state.tips && state.tips[user]) || {}).length;
        const backupTipCount = Object.keys(backup.tips || {}).length;
        
        if (backupTipCount > currentTipCount) {
          // Hráč má v backupu více tipů — obnov chybějící
          if (!state.tips) state.tips = {};
          if (!state.tips[user]) state.tips[user] = {};
          if (!state.lockedTips) state.lockedTips = {};
          if (!state.lockedTips[user]) state.lockedTips[user] = {};
          
          let restoredCount = 0;
          for (const mid in backup.tips) {
            if (!state.tips[user][mid]) {
              state.tips[user][mid] = backup.tips[mid];
              restoredCount++;
            }
          }
          for (const mid in backup.lockedTips) {
            if (!state.lockedTips[user][mid]) {
              state.lockedTips[user][mid] = backup.lockedTips[mid];
            }
          }
          
          restored.push({ user, restoredCount, backupTipCount, currentTipCount, backupSavedAt: backup.savedAt });
          changed = true;
        }
      }
      
      if (changed) {
        const merged = JSON.stringify(state);
        await env.TIPPING_KV.put("ms2026_state", merged);
        await env.TIPPING_KV.put("ms2026_backup", merged);
      }
      
      return new Response(JSON.stringify({ ok: true, changed, restored }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // --- API: stav per-user backupů ---
    if (url.pathname === "/api/backup-status" && request.method === "GET") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.ADMIN_SECRET) return new Response("forbidden", { status: 403 });
      
      const stateRaw = await env.TIPPING_KV.get("ms2026_state");
      const state = stateRaw ? JSON.parse(stateRaw) : { users: {} };
      
      const status = [];
      for (const user in state.users) {
        const backupRaw = await env.TIPPING_KV.get("user_backup:" + user);
        const backup = backupRaw ? JSON.parse(backupRaw) : null;
        status.push({
          user,
          currentTips: Object.keys((state.tips && state.tips[user]) || {}).length,
          backupTips: backup ? Object.keys(backup.tips || {}).length : 0,
          backupSavedAt: backup ? backup.savedAt : null,
          needsRestore: backup ? Object.keys(backup.tips||{}).length > Object.keys((state.tips&&state.tips[user])||{}).length : false
        });
      }
      return new Response(JSON.stringify(status, null, 2), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // --- Vše ostatní: 404 (frontend je na Pages) ---
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    try {
      const resp = await fetch("https://api.football-data.org/v4/competitions/2000/matches?stage=GROUP_STAGE", {
        headers: { "X-Auth-Token": env.FOOTBALL_API_TOKEN },
      });
      if (!resp.ok) return;
      const data = await resp.json();

      // Načti existující state — nikdy ho nepřepiš, jen přidej výsledky
      const current = await env.TIPPING_KV.get("ms2026_state");
      if (!current) return; // Pokud KV je prázdné, nic neděláme
      const state = JSON.parse(current);
      if (!state.results) state.results = {};
      if (!state.users || Object.keys(state.users).length === 0) return; // Ochrana

      (data.matches || []).forEach(m => {
        if (["FINISHED","IN_PLAY","PAUSED"].includes(m.status)) {
          const sc = m.score && m.score.fullTime;
          state.results["m" + m.id] = {
            home: sc ? sc.home : 0,
            away: sc ? sc.away : 0,
            status: m.status,
            minute: m.minute || null,
          };
        }
      });

      state.lastSync = new Date().toISOString();
      const merged = JSON.stringify(state);
      await env.TIPPING_KV.put("ms2026_state", merged);
      await env.TIPPING_KV.put("ms2026_backup", merged);
    } catch(e) {
      console.error("scheduled sync failed:", e);
    }
  },
};
