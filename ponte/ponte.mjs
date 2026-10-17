// Caixinha de impressão Xis da Gaúcha
// Escuta a fila "impressoes" no Firebase e manda as etiquetas (ZPL) para a Zebra pelo USB ou pela rede.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, query, where, onSnapshot, doc, runTransaction, updateDoc, setDoc } from "firebase/firestore";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";

const CFG_PATH = process.env.PONTE_CONFIG || "/etc/ponte-xis.json";
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
const ID = cfg.id || os.hostname();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const app = initializeApp(cfg.firebase);
const auth = getAuth(app);
const db = getFirestore(app);
let ultimoErro = "";

function enviarUSB(dados) {
  const dev = cfg.impressora || "/dev/usb/lp0";
  return new Promise((ok, falha) => {
    fs.open(dev, "w", (e, fd) => {
      if (e) return falha(new Error(e.code === "ENOENT" ? "Zebra não encontrada no USB (cabo ou impressora desligada)" : e.message));
      fs.write(fd, dados, (e2) => { fs.close(fd, () => {}); e2 ? falha(e2) : ok(); });
    });
  });
}
function enviarRede(dados) {
  const [host, porta] = cfg.impressora.replace("tcp://", "").split(":");
  return new Promise((ok, falha) => {
    const s = net.createConnection({ host, port: Number(porta || 9100), timeout: 8000 }, () => s.end(dados, ok));
    s.on("timeout", () => { s.destroy(); falha(new Error("Zebra não respondeu na rede (" + host + ")")); });
    s.on("error", falha);
  });
}
const imprimir = (zpl) => {
  const dados = Buffer.from(zpl, "utf8");
  return String(cfg.impressora || "").startsWith("tcp://") ? enviarRede(dados) : enviarUSB(dados);
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
    await imprimir(job.zpl);
    await updateDoc(ref, { status: "impresso", impressoEm: new Date().toISOString() });
    ultimoErro = "";
    log("Impresso:", job.produto, job.lote, "x" + (job.copias || 1));
  } catch (e) {
    ultimoErro = e.message;
    await updateDoc(ref, { status: "erro", erro: e.message, erroEm: new Date().toISOString() }).catch(() => {});
    log("ERRO ao imprimir:", e.message);
  }
}

async function sinal() {
  await setDoc(doc(db, "pontes", ID), {
    unidades: cfg.unidades, impressora: cfg.impressora || "/dev/usb/lp0",
    visto: new Date().toISOString(), versao: "1.0.0", ultimoErro
  }, { merge: true }).catch((e) => log("Sinal falhou:", e.message));
}

async function iniciar() {
  for (;;) {
    try { await signInWithEmailAndPassword(auth, cfg.email, cfg.senha); break; }
    catch (e) { log("Login falhou:", e.code || e.message, "- tentando de novo em 30s"); await new Promise(r => setTimeout(r, 30000)); }
  }
  log("Caixinha", ID, "ligada. Unidades:", cfg.unidades.join(", "), "| Impressora:", cfg.impressora || "/dev/usb/lp0");
  await sinal(); setInterval(sinal, 60000);
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
