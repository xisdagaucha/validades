/* Conexão do app Validades Xis da Gaúcha com o Firebase (banco de dados + login do aparelho).
   Substitui o ambiente do Claude: o app chama window.claude.use("db" | "downloads" | "user"). */
(function () {
  "use strict";
  var LS_CFG = "xg-fbcfg";
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- estilos das telas de acesso ---------- */
  var css = document.createElement("style");
  css.textContent =
    ".xg-gate{position:fixed;inset:0;z-index:50;background:#111110;display:flex;align-items:center;justify-content:center;padding:24px 16px;overflow:auto}" +
    ".xg-box{background:var(--surface,#fff);color:var(--ink,#1f1f1c);border-radius:18px;max-width:420px;width:100%;padding:26px 22px;display:flex;flex-direction:column;gap:14px;box-shadow:0 10px 40px rgba(0,0,0,.45);border-top:6px solid #03BC32}" +
    ".xg-box img{height:70px;width:auto;align-self:center}" +
    ".xg-box h1{font-family:'Archivo Black','Arial Black',sans-serif;font-weight:400;font-size:20px;text-align:center;margin:0;text-transform:uppercase;letter-spacing:.02em}" +
    ".xg-box p{margin:0;color:var(--muted,#5f645c);font-size:14px;text-align:center}" +
    ".xg-box label{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5f645c);display:flex;flex-direction:column;gap:5px}" +
    ".xg-box input,.xg-box textarea{font:inherit;font-size:16px;padding:12px;border:1.5px solid var(--line,#dce2da);border-radius:10px;background:var(--surface,#fff);color:inherit;text-transform:none;letter-spacing:0;font-weight:400}" +
    ".xg-box textarea{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;min-height:150px}" +
    ".xg-box button{font:inherit;font-weight:800;font-size:16px;min-height:50px;border:0;border-radius:12px;background:#03BC32;color:#0A1C0E;cursor:pointer}" +
    ".xg-box button:disabled{opacity:.6}" +
    ".xg-err{color:#D32F2F;font-weight:700;font-size:14px;text-align:center;min-height:18px}" +
    ".xg-sair{margin-top:6px}";
  document.head.appendChild(css);

  function logoSrc() {
    var i = document.querySelector(".brand .lg-l");
    return i ? i.getAttribute("src") : "icon-192.png";
  }
  function gate(html) {
    var g = document.getElementById("xg-gate");
    if (!g) { g = document.createElement("div"); g.id = "xg-gate"; g.className = "xg-gate"; document.body.appendChild(g); }
    g.innerHTML = '<div class="xg-box"><img alt="Xis da Gaúcha" src="' + logoSrc() + '">' + html + "</div>";
    g.hidden = false;
    return g;
  }
  function fecharGate() { var g = document.getElementById("xg-gate"); if (g) g.remove(); }

  /* ---------- configuração do Firebase ---------- */
  function lerConfigTexto(t) {
    var m = String(t || "").match(/\{[\s\S]*\}/); if (!m) return null;
    var o = {};
    ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"].forEach(function (k) {
      var r = new RegExp("[\"']?" + k + "[\"']?\\s*:\\s*[\"']([^\"']+)[\"']").exec(m[0]);
      if (r) o[k] = r[1];
    });
    return o.apiKey && o.projectId ? o : null;
  }
  function configAtual() {
    try { var s = JSON.parse(lsGet(LS_CFG) || "null"); if (s && s.apiKey) return s; } catch (e) {}
    var c = window.FIREBASE_CONFIG;
    if (c && c.apiKey && c.apiKey !== "COLE_AQUI") return c;
    return null;
  }

  var pronto, prontoOk;
  pronto = new Promise(function (r) { prontoOk = r; });
  var fs = null;

  function telaConfig() {
    var g = gate('<h1>Configurar banco de dados</h1><p>Cole abaixo o <b>firebaseConfig</b> do seu projeto no Firebase (Configurações do projeto → App da Web).</p>' +
      '<textarea id="xgCfg" placeholder="const firebaseConfig = {\n  apiKey: &quot;...&quot;,\n  ...\n};"></textarea><div class="xg-err" id="xgCfgErr"></div><button type="button" id="xgCfgOk">Salvar e continuar</button>');
    g.querySelector("#xgCfgOk").onclick = function () {
      var c = lerConfigTexto(g.querySelector("#xgCfg").value);
      if (!c) { g.querySelector("#xgCfgErr").textContent = "Não reconheci a configuração. Cole o bloco inteiro, com apiKey e projectId."; return; }
      lsSet(LS_CFG, JSON.stringify(c)); location.reload();
    };
  }

  function telaLogin(msg) {
    var g = gate('<h1>Validades</h1><p>Entre com a conta do aparelho da loja. Isso é feito uma vez só em cada celular ou computador.</p>' +
      '<form id="xgLogin" autocomplete="on" style="display:flex;flex-direction:column;gap:12px">' +
      '<label>E-mail<input type="email" id="xgEmail" autocomplete="username" required></label>' +
      '<label>Senha<input type="password" id="xgSenha" autocomplete="current-password" required></label>' +
      '<div class="xg-err" id="xgErr">' + (msg || "") + '</div><button type="submit" id="xgEntrar">Entrar</button></form>');
    var last = lsGet("xg-email"); if (last) g.querySelector("#xgEmail").value = last;
    g.querySelector("#xgLogin").onsubmit = function (ev) {
      ev.preventDefault();
      var em = g.querySelector("#xgEmail").value.trim(), se = g.querySelector("#xgSenha").value, b = g.querySelector("#xgEntrar");
      b.disabled = true; b.textContent = "Entrando…";
      firebase.auth().signInWithEmailAndPassword(em, se).then(function () { lsSet("xg-email", em); })
        .catch(function (e) {
          b.disabled = false; b.textContent = "Entrar";
          var c = e && e.code || "";
          g.querySelector("#xgErr").textContent =
            /invalid|wrong-password|user-not-found/.test(c) ? "E-mail ou senha incorretos." :
            /network/.test(c) ? "Sem internet. Confira a conexão e tente de novo." :
            /too-many/.test(c) ? "Muitas tentativas. Aguarde alguns minutos." :
            /api-key|invalid-api|app-not-authorized|unauthorized-domain/.test(c) ? "Configuração do Firebase incorreta ou domínio não autorizado (" + c + ")." : "Não foi possível entrar (" + c + ").";
          if (/api-key|invalid-api/.test(c)) { var bt = document.createElement("button"); bt.type = "button"; bt.textContent = "Corrigir configuração"; bt.style.background = "#444"; bt.style.color = "#fff"; bt.onclick = telaConfig; g.querySelector("#xgLogin").appendChild(bt); }
        });
    };
  }

  async function importarSeVazio() {
    var g = await fs.doc("config/geral").get();
    if (g.exists) return;
    var r = await fetch("dados-iniciais.json", { cache: "no-store" }); if (!r.ok) return;
    var d = await r.json(), ops = [];
    Object.keys(d).forEach(function (col) { Object.keys(d[col]).forEach(function (id) { ops.push([col + "/" + id, d[col][id]]); }); });
    for (var i = 0; i < ops.length; i += 400) {
      var b = fs.batch();
      ops.slice(i, i + 400).forEach(function (o) { b.set(fs.doc(o[0]), o[1]); });
      await b.commit();
    }
  }

  function botaoSair() {
    var aj = document.getElementById("p-ajustes"); if (!aj || document.getElementById("xgSairCard")) return;
    var c = document.createElement("div"); c.className = "card"; c.id = "xgSairCard";
    var u = firebase.auth().currentUser;
    c.innerHTML = '<h3>Conta do aparelho</h3><p class="muted" style="margin:0;font-size:14px">Este aparelho está conectado como <b>' + (u ? u.email : "") +
      '</b>. Use “Sair” só se for trocar a conta ou entregar o aparelho.</p><div class="row"><button type="button" class="btn danger xg-sair" id="xgSair">Sair da conta neste aparelho</button></div>';
    aj.appendChild(c);
    c.querySelector("#xgSair").onclick = function () { firebase.auth().signOut().then(function () { location.reload(); }); };
  }

  function iniciar() {
    var cfg = configAtual();
    if (!cfg) { telaConfig(); return; }
    try { firebase.initializeApp(cfg); } catch (e) { telaConfig(); return; }
    fs = firebase.firestore();
    try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) {}
    try { fs.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
    var jaPronto = false;
    firebase.auth().onAuthStateChanged(async function (user) {
      if (!user) { telaLogin(); return; }
      if (jaPronto) return; jaPronto = true;
      gate('<h1>Carregando…</h1><p>Conectando ao banco de dados.</p>');
      try { await importarSeVazio(); } catch (e) { console.warn("Importação inicial:", e); }
      fecharGate(); botaoSair(); prontoOk(fs);
    });
  }

  /* ---------- downloads: PDF abre para imprimir, planilha baixa ---------- */
  var downloads = {
    save: function (req) {
      return new Promise(function (resolve) {
        var blob = req.data instanceof Blob ? req.data : new Blob([req.data], { type: /\.csv$/i.test(req.filename) ? "text/csv;charset=utf-8" : "application/octet-stream" });
        var url = URL.createObjectURL(blob);
        if (/\.pdf$/i.test(req.filename)) {
          var w = window.open(url, "_blank");
          if (w) { setTimeout(function () { URL.revokeObjectURL(url); }, 120000); resolve({ status: "saved" }); return; }
        }
        var a = document.createElement("a"); a.href = url; a.download = req.filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        resolve({ status: "saved" });
      });
    }
  };
  var user = {
    isOwner: function () { return true; },
    canEdit: function () { return Promise.resolve(true); },
    can: function () { return Promise.resolve(true); },
    id: function () { var u = firebase.auth().currentUser; return Promise.resolve(u ? u.uid : null); }
  };

  window.claude = {
    use: function (nome) {
      if (nome === "db") return pronto;
      if (nome === "downloads") return Promise.resolve(downloads);
      if (nome === "user") return pronto.then(function () { return user; });
      return Promise.resolve(null);
    }
  };

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
  iniciar();
})();
