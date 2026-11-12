// Caixinha de impressão Xis da Gaúcha — versão 1.2.0
// Escuta a fila "impressoes" no Firebase e manda as etiquetas para a impressora pelo USB ou pela rede.
// Aceita ZPL (Zebra) e TSPL (Tomate, Elgin e genéricas). Roda no Raspberry (Linux) ou num computador Windows.
// Atualiza-se sozinha a partir do site do app.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, query, where, onSnapshot, doc, runTransaction, updateDoc, setDoc } from "firebase/firestore";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { spawnSync, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSAO = "1.2.0";
const BASE = "https://xisdagaucha.github.io/validades/ponte";
const WIN = process.platform === "win32";
const CFG_PATH = process.env.PONTE_CONFIG || (WIN ? path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json") : "/etc/ponte-xis.json");
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
const ID = cfg.id || os.hostname();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const app = initializeApp(cfg.firebase);
const auth = getAuth(app);
const db = getFirestore(app);
let ultimoErro = "";

function dispositivoUSB() {
  const pref = cfg.impressora || "/dev/usb/lp0";
  if (fs.existsSync(pref)) return pref;
  for (let i = 0; i < 4; i++) { const d = "/dev/usb/lp" + i; if (fs.existsSync(d)) return d; }
  return pref;
}
function enviarUSB(dados) {
  const dev = dispositivoUSB();
  return new Promise((ok, falha) => {
    fs.open(dev, "w", (e, fd) => {
      if (e) return falha(new Error(e.code === "ENOENT" ? "Impressora não encontrada no USB (cabo ou impressora desligada)" : e.message));
      fs.write(fd, dados, (e2) => { fs.close(fd, () => {}); e2 ? falha(e2) : ok(); });
    });
  });
}
function enviarRede(dados) {
  const [host, porta] = cfg.impressora.replace("tcp://", "").split(":");
  return new Promise((ok, falha) => {
    const s = net.createConnection({ host, port: Number(porta || 9100), timeout: 8000 }, () => s.end(dados, ok));
    s.on("timeout", () => { s.destroy(); falha(new Error("Impressora não respondeu na rede (" + host + ")")); });
    s.on("error", falha);
  });
}
// Windows: manda os bytes "crus" (RAW) para a impressora instalada no Windows, pelo spooler.
const PS_RAW = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class RawPrnXis {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Send(string printer, byte[] data){
    IntPtr h; if(!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Impressora nao encontrada no Windows: " + printer);
    try{
      DOCINFO di = new DOCINFO(); di.pDocName = "Etiqueta Xis"; di.pDataType = "RAW";
      if(StartDocPrinter(h, 1, di) == 0) throw new Exception("Falha ao iniciar a impressao (" + Marshal.GetLastWin32Error() + ")");
      StartPagePrinter(h); int w; bool ok = WritePrinter(h, data, data.Length, out w); EndPagePrinter(h); EndDocPrinter(h);
      if(!ok || w != data.Length) throw new Exception("Falha ao enviar para a impressora (" + Marshal.GetLastWin32Error() + ")");
    } finally { ClosePrinter(h); }
  }
}
"@
[RawPrnXis]::Send($env:XIS_IMPRESSORA, [IO.File]::ReadAllBytes($env:XIS_ARQUIVO))
`;
function enviarWindows(dados) {
  const nome = String(cfg.impressora).slice(4);
  const arq = path.join(os.tmpdir(), "xis-etiqueta-" + Date.now() + ".prn");
  fs.writeFileSync(arq, dados);
  const cmd = Buffer.from(PS_RAW, "utf16le").toString("base64");
  return new Promise((ok, falha) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", cmd],
      { env: { ...process.env, XIS_IMPRESSORA: nome, XIS_ARQUIVO: arq }, windowsHide: true, timeout: 60000 },
      (e, out, err) => {
        fs.rm(arq, { force: true }, () => {});
        if (e) { const m = String(err || e.message).split(/\r?\n/).find(l => /Impressora|Falha|Exception/i.test(l)) || e.message; return falha(new Error(m.replace(/^.*Exception[^:]*:\s*/, "").replace(/"/g, "").trim())); }
        ok();
      });
  });
}
const imprimir = (job) => {
  const dados = job.dados ? Buffer.from(job.dados, "base64") : Buffer.from(job.zpl || "", "utf8");
  if (!dados.length) return Promise.reject(new Error("Etiqueta vazia: atualize o app"));
  const imp = String(cfg.impressora || "");
  if (imp.startsWith("win:")) return enviarWindows(dados);
  return imp.startsWith("tcp://") ? enviarRede(dados) : enviarUSB(dados);
};

async function processar(ref) {
  // "pega" o trabalho para não imprimir duas vezes
  let job = null;
  try {
    job = await runTransaction(db, async (t) => {
      const s = await t.get(ref);
      if (!s.exists() || s.data().status !== "pendente") return null;
      t.update(ref, { status: "imprimindo", ponte: ID, pegoEm: new Date().toISOString() });
      return s.data();
    });
  } catch (e) { log("Erro ao pegar trabalho", e.message); return; }
  if (!job) return;
  try {
    await imprimir(job);
    await updateDoc(ref, { status: "impresso", impressoEm: new Date().toISOString() });
    ultimoErro = "";
    log("Impresso:", job.formato || "zpl", job.produto, job.lote, "x" + (job.copias || 1));
  } catch (e) {
    ultimoErro = e.message;
    await updateDoc(ref, { status: "erro", erro: e.message, erroEm: new Date().toISOString() }).catch(() => {});
    log("ERRO ao imprimir:", e.message);
  }
}

async function sinal() {
  await setDoc(doc(db, "pontes", ID), {
    unidades: cfg.unidades, impressora: cfg.impressora || "/dev/usb/lp0", usb: WIN ? "" : dispositivoUSB(), sistema: WIN ? "Windows" : "Raspberry",
    visto: new Date().toISOString(), versao: VERSAO, ultimoErro
  }, { merge: true }).catch((e) => log("Sinal falhou:", e.message));
}

// Atualização automática: baixa a versão nova do site do app, confere e reinicia.
async function autoAtualizar() {
  try {
    const r = await fetch(BASE + "/ponte.mjs?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const novo = await r.text();
    const atual = fileURLToPath(import.meta.url);
    if (!novo.includes("// FIM-PONTE-XIS") || novo === fs.readFileSync(atual, "utf8")) return;
    const tmp = atual + ".novo";
    fs.writeFileSync(tmp, novo);
    const chk = spawnSync(process.execPath, ["--check", tmp]);
    if (chk.status !== 0) { fs.rmSync(tmp, { force: true }); log("Atualização ignorada: arquivo com erro"); return; }
    fs.copyFileSync(atual, atual + ".anterior");
    fs.renameSync(tmp, atual);
    log("Caixinha atualizada. Reiniciando...");
    process.exit(0);
  } catch (e) { log("Não consegui verificar atualização:", e.message); }
}

async function iniciar() {
  for (;;) {
    try { await signInWithEmailAndPassword(auth, cfg.email, cfg.senha); break; }
    catch (e) { log("Login falhou:", e.code || e.message, "- tentando de novo em 30s"); await new Promise(r => setTimeout(r, 30000)); }
  }
  log("Caixinha", ID, "v" + VERSAO, "ligada. Unidades:", cfg.unidades.join(", "), "| Impressora:", WIN ? cfg.impressora : dispositivoUSB());
  await sinal(); setInterval(sinal, 60000);
  setTimeout(autoAtualizar, 2 * 60000); setInterval(autoAtualizar, 6 * 3600000);
  const fila = query(collection(db, "impressoes"), where("status", "==", "pendente"));
  onSnapshot(fila, (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type === "removed") return;
      const d = ch.doc.data();
      if (cfg.unidades.includes(d.unidade)) processar(ch.doc.ref);
    });
  }, (e) => { log("Fila caiu:", e.message, "- reiniciando"); process.exit(1); });
}
process.on("unhandledRejection", (e) => log("Erro:", e && e.message));
iniciar();
// FIM-PONTE-XIS
