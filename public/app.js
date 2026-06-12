var MATCHES = [];
var state = {users:{},tips:{},results:{},champion:{},championLocked:{},lockedTips:{},tournamentWinner:null,lastSync:null};
var currentUser = null;

var ALL_TEAMS = [
  ["Algeria","🇩🇿"],["Argentina","🇦🇷"],["Australia","🇦🇺"],["Austria","🇦🇹"],
  ["Belgium","🇧🇪"],["Bosnia-Herzegovina","🇧🇦"],["Brazil","🇧🇷"],["Cameroon","🇨🇲"],
  ["Canada","🇨🇦"],["Cape Verde Islands","🇨🇻"],["Chile","🇨🇱"],["China","🇨🇳"],
  ["Colombia","🇨🇴"],["Congo DR","🇨🇬"],["Costa Rica","🇨🇷"],["Croatia","🇭🇷"],
  ["Curaçao","🇨🇼"],["Czechia","🇨🇿"],["Denmark","🇩🇰"],["Ecuador","🇪🇨"],
  ["Egypt","🇪🇬"],["England","🏴󠁧󠁢󠁥󠁮󠁧󠁿"],["France","🇫🇷"],["Germany","🇩🇪"],
  ["Ghana","🇬🇭"],["Haiti","🇭🇹"],["Honduras","🇭🇳"],["Indonesia","🇮🇩"],
  ["Iran","🇮🇷"],["Iraq","🇮🇶"],["Ivory Coast","🇨🇮"],["Jamaica","🇯🇲"],
  ["Japan","🇯🇵"],["Mali","🇲🇱"],["Mexico","🇲🇽"],["Morocco","🇲🇦"],
  ["Netherlands","🇳🇱"],["New Zealand","🇳🇿"],["Nigeria","🇳🇬"],["Norway","🇳🇴"],
  ["Panama","🇵🇦"],["Paraguay","🇵🇾"],["Peru","🇵🇪"],["Poland","🇵🇱"],
  ["Portugal","🇵🇹"],["Qatar","🇶🇦"],["Romania","🇷🇴"],["Saudi Arabia","🇸🇦"],
  ["Scotland","🏴󠁧󠁢󠁳󠁣󠁴󠁿"],["Senegal","🇸🇳"],["Serbia","🇷🇸"],["Slovakia","🇸🇰"],
  ["South Africa","🇿🇦"],["South Korea","🇰🇷"],["Spain","🇪🇸"],["Sweden","🇸🇪"],
  ["Switzerland","🇨🇭"],["Tunisia","🇹🇳"],["Turkey","🇹🇷"],["Ukraine","🇺🇦"],
  ["United States","🇺🇸"],["Uruguay","🇺🇾"],["Uzbekistan","🇺🇿"],["Venezuela","🇻🇪"]
];
 
function toast(msg, dur) {
  dur = dur || 2500;
  var e = document.getElementById("toast");
  e.textContent = msg;
  e.classList.add("show");
  setTimeout(function(){ e.classList.remove("show"); }, dur);
}
 
function initials(n) {
  return n.split(" ").map(function(w){ return w[0]; }).join("").toUpperCase().slice(0,2);
}
 
function winner(h, a) { return h > a ? "H" : h < a ? "A" : "D"; }
 
function flagFor(name) {
  for (var i = 0; i < MATCHES.length; i++) {
    if (MATCHES[i].home === name) return MATCHES[i].homeFlag;
    if (MATCHES[i].away === name) return MATCHES[i].awayFlag;
  }
  for (var j = 0; j < ALL_TEAMS.length; j++) {
    if (ALL_TEAMS[j][0] === name) return ALL_TEAMS[j][1];
  }
  return "🏳️";
}
 
function calcPoints(uid) {
  var pts = 0, exact = 0, winHit = 0;
  var tips = state.tips[uid] || {};
  for (var i = 0; i < MATCHES.length; i++) {
    var m = MATCHES[i], t = tips[m.id], r = state.results[m.id];
    if (!t || !r || t.home === "" || t.away === "") continue;
    var th = +t.home, ta = +t.away, rh = +r.home, ra = +r.away;
    if (isNaN(th)||isNaN(ta)||isNaN(rh)||isNaN(ra)) continue;
    if (winner(th,ta) === winner(rh,ra)) { pts += 2; winHit++; }
    if (th === rh && ta === ra) { pts += 3; exact++; }
  }
  if (state.champion[uid] && state.tournamentWinner && state.champion[uid] === state.tournamentWinner) pts += 20;
  return { pts: pts, exact: exact, winHit: winHit };
}
 
async function loadState() {
  try {
    var r = await fetch("/api/state");
    if (r.ok) {
      var text = await r.text();
      if (text && text.trim() !== "") {
        var parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          state = Object.assign({users:{},tips:{},results:{},champion:{},championLocked:{},lockedTips:{},tournamentWinner:null,lastSync:null}, parsed);
        }
      }
    }
  } catch(e) { console.error("loadState failed", e); }
}
 
async function loadMatches(updateResults) {
  try {
    var r = await fetch("/api/matches");
    if (r.ok) {
      var data = await r.json();
      if (data.matches && data.matches.length > 0) {
        MATCHES = data.matches;
        // Výsledky aktualizuj jen při explicitním syncu (tlačítko Aktualizovat)
        if (updateResults) {
          for (var i = 0; i < MATCHES.length; i++) {
            var m = MATCHES[i];
            if (m.score) {
              state.results[m.id] = { home: m.score.home, away: m.score.away, status: m.status, minute: m.score.minute };
            }
          }
        } else {
          // Při načtení stránky nastav status zápasu (zamknutí tipování)
          // ale zachovej existující výsledky z KV
          for (var i = 0; i < MATCHES.length; i++) {
            var m = MATCHES[i];
            if (m.score && !state.results[m.id]) {
              // Výsledek ještě není v KV — přidej ho
              state.results[m.id] = { home: m.score.home, away: m.score.away, status: m.status, minute: m.score.minute };
            } else if (m.score && state.results[m.id]) {
              // Zachovej skóre z KV, ale aktualizuj status
              state.results[m.id].status = m.status;
            }
          }
        }
        return true;
      }
    }
  } catch(e) { console.error("loadMatches failed", e); }
  return false;
}
 
async function saveState() {
  try {
    // Pojistka: nikdy neuložit prázdný nebo menší state než je v KV
    var userCount = Object.keys(state.users || {}).length;
    if (userCount === 0) {
      console.warn("saveState blocked: no users in state");
      return;
    }
    // Před uložením zkontroluj co je v KV
    var check = await fetch("/api/state");
    if (check.ok) {
      var text = await check.text();
      if (text && text.trim() !== "" && text.trim() !== "{}") {
        var existing = JSON.parse(text);
        var existingCount = Object.keys(existing.users || {}).length;
        if (existingCount > userCount) {
          // KV má více uživatelů — merge, nezapisuj méně
          console.warn("saveState: merging, KV has more users (" + existingCount + " vs " + userCount + ")");
          // Přidej uživatele z KV kteří chybí v aktuálním state
          for (var u in existing.users) {
            if (!state.users[u]) {
              state.users[u] = existing.users[u];
              if (existing.tips[u]) state.tips[u] = existing.tips[u];
              if (existing.champion[u]) state.champion[u] = existing.champion[u];
              if (existing.championLocked && existing.championLocked[u]) {
                if (!state.championLocked) state.championLocked = {};
                state.championLocked[u] = existing.championLocked[u];
              }
              if (existing.lockedTips && existing.lockedTips[u]) {
                if (!state.lockedTips) state.lockedTips = {};
                state.lockedTips[u] = existing.lockedTips[u];
              }
            }
          }
        }
      }
    }
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
  } catch(e) { console.error("saveState failed", e); }
}
 
function enterApp(n) {
  var isNew = !state.users[n];
  if (isNew) state.users[n] = { name: n };
  currentUser = n;
  try { localStorage.setItem("ms2026_user", n); } catch(e) {}
  if (isNew) saveState(); // Ukládej jen když je nový uživatel
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("main-screen").style.display = "block";
  document.getElementById("u-name").textContent = n;
  document.getElementById("u-avatar").textContent = initials(n);
  if (state.lastSync) document.getElementById("sync-info").textContent = "Naposledy: " + state.lastSync;
  refreshPts();
  renderTips();
}
 
function login() {
  var n = document.getElementById("name-input").value.trim();
  if (!n) return;
  if (!state.users[n]) {
    if (!confirm('Uživatel "' + n + '" neexistuje. Chceš se zaregistrovat?')) return;
  }
  enterApp(n);
}
 
function logout() {
  currentUser = null;
  try { localStorage.removeItem("ms2026_user"); } catch(e) {}
  document.getElementById("login-screen").style.display = "block";
  document.getElementById("main-screen").style.display = "none";
  document.getElementById("name-input").value = "";
}
 
function refreshPts() {
  if (!currentUser) return;
  document.getElementById("u-pts").textContent = calcPoints(currentUser).pts + " bodů";
}
 
function showTab(t, btn) {
  document.querySelectorAll(".tab").forEach(function(x) { x.classList.remove("active"); });
  document.querySelectorAll(".nav-btn").forEach(function(x) { x.classList.remove("active"); });
  document.getElementById("tab-" + t).classList.add("active");
  btn.classList.add("active");
  if (t === "tips") renderTips();
  if (t === "mytips") renderMyTips();
  if (t === "lb") renderLb();
}
 
function isTipLocked(mid) {
  if (state.lockedTips && state.lockedTips[currentUser] && state.lockedTips[currentUser][mid]) return true;
  var r = state.results[mid];
  return r && ["FINISHED","IN_PLAY","PAUSED"].indexOf(r.status) >= 0;
}
 
function renderChampionPicker() {
  var wrap = document.getElementById("champion-picker-wrap");
  var locked = state.championLocked && state.championLocked[currentUser];
  var chosen = state.champion[currentUser];
  var tw = state.tournamentWinner;
 
  if (locked && chosen) {
    var extra = tw
      ? (chosen === tw ? '<span class="badge gold" style="margin-left:10px">+20b 🎉</span>' : '<span class="badge miss" style="margin-left:10px">0b</span>')
      : '<span style="font-size:11px;color:var(--text3);margin-left:10px">🔒 Uzamčeno</span>';
    wrap.innerHTML = '<div class="champion-chosen"><span style="font-size:24px">' + flagFor(chosen) + '</span><span>' + chosen + '</span>' + extra + '</div>';
  } else {
    var opts = '<option value="">— Vyber šampióna —</option>';
    for (var i = 0; i < ALL_TEAMS.length; i++) {
      var tf = ALL_TEAMS[i];
      opts += '<option value="' + tf[0] + '"' + (tf[0] === chosen ? ' selected' : '') + '>' + tf[1] + ' ' + tf[0] + '</option>';
    }
    var confirmBtn = chosen ? '<button class="btn-primary" style="margin-top:10px;font-size:13px;padding:8px" onclick="lockChampion()">🔒 Potvrdit a uzamknout tip</button>' : '';
    wrap.innerHTML = '<select class="champion-select" onchange="previewChampion(this.value)">' + opts + '</select>' + confirmBtn;
  }
}
 
function previewChampion(val) {
  if (!val) return;
  state.champion[currentUser] = val;
  renderChampionPicker();
}
 
function lockChampion() {
  var val = state.champion[currentUser];
  if (!val) return;
  if (!confirm('Opravdu uzamknout tip na šampióna "' + val + '"? Toto nelze změnit.')) return;
  if (!state.championLocked) state.championLocked = {};
  state.championLocked[currentUser] = true;
  saveState(); renderChampionPicker(); refreshPts();
  toast("🏆 Tip uzamčen: " + val);
}
 
function renderTips() {
  if (!currentUser) return;
  renderChampionPicker();
  if (!MATCHES.length) {
    document.getElementById("tips-container").innerHTML = '<div class="loading">⏳ Načítám zápasy...</div>';
    return;
  }
  var tips = state.tips[currentUser] || {};
  // Seřaď zápasy podle data a času
  var sorted = MATCHES.slice().sort(function(a, b) {
    var da = a.date + " " + a.time, db = b.date + " " + b.time;
    return da < db ? -1 : da > db ? 1 : 0;
  });
  // Seskup podle dne
  var days = [], dayMap = {};
  for (var i = 0; i < sorted.length; i++) {
    var d = sorted[i].date;
    if (days.indexOf(d) < 0) { days.push(d); dayMap[d] = []; }
    dayMap[d].push(sorted[i]);
  }
  var html = "";
  for (var gi = 0; gi < days.length; gi++) {
    var day = days[gi];
    html += '<p class="section-label">' + day + '</p><div class="match-card">';
    for (var i = 0; i < dayMap[day].length; i++) {
      var m = dayMap[day][i];
      if (false) continue; // dummy
      var t = tips[m.id] || { home: "", away: "" };
      var r = state.results[m.id];
      var started = r && ["FINISHED","IN_PLAY","PAUSED"].indexOf(r.status) >= 0;
      var locked = isTipLocked(m.id);
 
      html += '<div class="match-row">';
      html += '<div class="team-side home"><span class="team-name">' + m.home + '</span><span class="flag">' + m.homeFlag + '</span></div>';
      html += '<div class="center-cell">';
 
      if (started) {
        html += '<div class="live-result">' + r.home + ' : ' + r.away + '</div>';
        var statusLabel = '';
        if (r.status === 'IN_PLAY') {
          statusLabel = '<span><span class="live-dot"></span>ŽIVĚ</span>';
        } else if (r.status === 'FINISHED') {
          var tt = state.tips[currentUser] && state.tips[currentUser][m.id];
          if (tt && tt.home !== '' && tt.away !== '') {
            var th = +tt.home, ta = +tt.away, rh = +r.home, ra = +r.away;
            if (th === rh && ta === ra) statusLabel = '<span class="finished-label">🎯 Přesný tip!</span>';
            else if (winner(th,ta) === winner(rh,ra)) statusLabel = '<span style="font-size:11px;color:var(--blue);font-weight:600">✓ Správný vítěz</span>';
            else statusLabel = '<span style="font-size:11px;color:var(--red);font-weight:600">✗ Špatný tip</span>';
          } else {
            statusLabel = '<span class="finished-label">✓ Konec</span>';
          }
        } else {
          statusLabel = '<span class="finished-label">✓ Konec</span>';
        }
        html += '<div class="match-meta">' + statusLabel + '</div>';
      } else if (locked) {
        html += '<div class="score-wrap"><span style="font-size:20px;font-weight:800">' + t.home + '</span><span class="score-sep">:</span><span style="font-size:20px;font-weight:800">' + t.away + '</span></div>';
        html += '<div class="match-meta">🔒 Uzamčeno · ' + m.date + ' ' + m.time + '</div>';
      } else {
        html += '<div class="score-wrap">';
        html += '<input class="score-input" type="number" min="0" max="20" value="' + t.home + '" placeholder="0" onchange="saveTip(this,\'' + m.id + '\',\'home\')" />';
        html += '<span class="score-sep">:</span>';
        html += '<input class="score-input" type="number" min="0" max="20" value="' + t.away + '" placeholder="0" onchange="saveTip(this,\'' + m.id + '\',\'away\')" />';
        html += '</div>';
        html += '<div class="match-meta">' + m.date + ' ' + m.time + '</div>';
        html += '<button class="btn-sm" style="margin-top:6px;font-size:11px" onclick="lockTip(\'' + m.id + '\')">🔒 Potvrdit tip</button>';
      }
 
      html += '</div>';
      html += '<div class="team-side away"><span class="flag">' + m.awayFlag + '</span><span class="team-name">' + m.away + '</span></div>';
      html += '</div>';
    }
    html += '</div>';
  }
  document.getElementById("tips-container").innerHTML = html;
}
 
function saveTip(el, mid, side) {
  if (!currentUser || isTipLocked(mid)) return;
  if (!state.tips[currentUser]) state.tips[currentUser] = {};
  if (!state.tips[currentUser][mid]) state.tips[currentUser][mid] = { home: "", away: "" };
  state.tips[currentUser][mid][side] = el.value;
  saveState();
}
 
function lockTip(mid) {
  var t = state.tips[currentUser] && state.tips[currentUser][mid];
  if (!t || t.home === "" || t.away === "") { toast("Nejdřív zadej obě skóre!"); return; }
  if (!confirm("Uzamknout tip " + t.home + ":" + t.away + "? Toto nelze změnit.")) return;
  if (!state.lockedTips) state.lockedTips = {};
  if (!state.lockedTips[currentUser]) state.lockedTips[currentUser] = {};
  state.lockedTips[currentUser][mid] = true;
  saveState(); renderTips();
  toast("🔒 Tip uzamčen!");
}
 
function renderMyTips() {
  if (!currentUser) return;
  var p = calcPoints(currentUser);
  var tips = state.tips[currentUser] || {};
  var champ = state.champion[currentUser];
  var tw = state.tournamentWinner;
  var champSection = "";
  if (champ) {
    var cb = tw
      ? (champ === tw ? '<span class="badge gold">+20b 🎉</span>' : '<span class="badge miss">0b</span>')
      : '<span style="font-size:12px;color:var(--text3)">Čeká se</span>';
    champSection = '<div class="champion-card" style="margin-bottom:16px"><h3>🏆 Tip na šampióna</h3><div style="display:flex;align-items:center;gap:10px;margin-top:8px"><span style="font-size:28px">' + flagFor(champ) + '</span><span style="font-size:16px;font-weight:700">' + champ + '</span>' + cb + '</div></div>';
  }
  var html = '<div class="metrics"><div class="metric"><div class="metric-val">' + p.pts + '</div><div class="metric-lbl">Celkem bodů</div></div><div class="metric"><div class="metric-val">' + p.winHit + '</div><div class="metric-lbl">Správný vítěz</div></div><div class="metric"><div class="metric-val">' + p.exact + '</div><div class="metric-lbl">Přesný výsledek</div></div></div>' + champSection;
  var sorted2 = MATCHES.slice().sort(function(a, b) {
    var da = a.date + " " + a.time, db = b.date + " " + b.time;
    return da < db ? -1 : da > db ? 1 : 0;
  });
  var days2 = [], dayMap2 = {};
  for (var i = 0; i < sorted2.length; i++) {
    var d = sorted2[i].date;
    if (days2.indexOf(d) < 0) { days2.push(d); dayMap2[d] = []; }
    dayMap2[d].push(sorted2[i]);
  }
  for (var gi = 0; gi < days2.length; gi++) {
    var day2 = days2[gi];
    html += '<p class="section-label">' + day2 + '</p><div class="match-card">';
    for (var i = 0; i < dayMap2[day2].length; i++) {
      var m = dayMap2[day2][i];
      if (false) continue;
      var t = tips[m.id], r = state.results[m.id];
      var badge = "", tipHTML = '<span style="font-size:12px;color:var(--text3);font-style:italic">Netipováno</span>';
      if (t && (t.home !== "" || t.away !== "")) tipHTML = '<span class="tip-score">' + (t.home||"?") + ":" + (t.away||"?") + '</span>';
      if (t && r && t.home !== "" && t.away !== "" && r.status === "FINISHED") {
        var th = +t.home, ta = +t.away, rh = +r.home, ra = +r.away;
        if (th===rh && ta===ra) badge = '<span class="badge exact">+5b přesně!</span>';
        else if (winner(th,ta) === winner(rh,ra)) badge = '<span class="badge win">+2b vítěz</span>';
        else badge = '<span class="badge miss">0b</span>';
      }
      html += '<div class="tip-result-row"><div class="team-side home"><span class="team-name" style="font-size:12px">' + m.home + '</span><span class="flag" style="font-size:18px">' + m.homeFlag + '</span></div><div class="tip-center">' + tipHTML + (r ? '<div class="real-score">Výsledek: ' + r.home + ':' + r.away + '</div>' : '<div class="real-score">Čeká se</div>') + badge + '</div><div class="team-side away"><span class="flag" style="font-size:18px">' + m.awayFlag + '</span><span class="team-name" style="font-size:12px">' + m.away + '</span></div></div>';
    }
    html += '</div>';
  }
  document.getElementById("mytips-container").innerHTML = html;
  refreshPts();
}
 
function renderLb() {
  var users = Object.keys(state.users);
  var ranked = users.map(function(u) { var p = calcPoints(u); return { name: u, pts: p.pts }; });
  ranked.sort(function(a,b) { return b.pts - a.pts; });
  var medals = ["🥇","🥈","🥉"];
  var html = '<p class="section-label">' + users.length + ' hráčů</p><div class="lb-card">';
  if (!ranked.length) html += '<p style="font-size:13px;color:var(--text2);text-align:center;padding:20px">Zatím nikdo.</p>';
  for (var i = 0; i < ranked.length; i++) {
    var p = ranked[i], champ = state.champion[p.name];
    html += '<div class="lb-row"><div class="lb-rank">' + (i < 3 ? medals[i] : i+1) + '</div><div class="avatar" style="width:34px;height:34px;font-size:12px">' + initials(p.name) + '</div><div style="flex:1;min-width:0"><div class="lb-name">' + p.name + '</div>' + (champ ? '<div class="lb-champion">🏆 ' + flagFor(champ) + ' ' + champ + '</div>' : '') + '</div><div style="text-align:right"><div class="lb-pts">' + p.pts + '</div><div class="lb-pts-lbl">bodů</div></div></div>';
  }
  html += '</div>';
  document.getElementById("lb-container").innerHTML = html;
}
 
async function syncResults() {
  var icon = document.getElementById("sync-icon"), info = document.getElementById("sync-info");
  icon.classList.add("spinning"); info.textContent = "Načítám...";
  try {
    await loadMatches(true);
    var now = new Date().toLocaleTimeString("cs", { hour: "2-digit", minute: "2-digit" });
    state.lastSync = now; await saveState();
    info.textContent = "Aktualizováno " + now;
    renderTips(); refreshPts();
    var fin = 0;
    for (var k in state.results) { if (state.results[k] && state.results[k].status === "FINISHED") fin++; }
    toast("✓ Načteno " + MATCHES.length + " zápasů, " + fin + " odehráno");
  } catch(e) {
    info.textContent = "Chyba: " + e.message;
    toast("Chyba: " + e.message, 4000);
  } finally {
    icon.classList.remove("spinning");
  }
}
 
(async function() {
  await loadState();
  await loadMatches(false);
  document.getElementById("name-input").addEventListener("keydown", function(e) {
    if (e.key === "Enter") login();
  });
  try {
    var saved = localStorage.getItem("ms2026_user");
    if (saved && state.users[saved]) { enterApp(saved); return; }
  } catch(e) {}
})();
 
