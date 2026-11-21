// Dia Transfer: runs inside the DESTINATION profile.
// Reads other profiles through the native host (read-only) and writes here with chrome.bookmarks.

const HOST = "com.diatransfer.host";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (u) => { try { const x = new URL(u); return (x.host.replace(/^www\./, "") + x.pathname.replace(/\/$/, "") + x.search).toLowerCase(); } catch { return u; } };
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

const state = {
  profiles: [],          // [{folder, name}]
  thisFolder: null,      // profile folder this extension runs in (best guess)
  sources: {},           // key -> {name, roots, extensions}
  srcKey: null,
  nodes: [], selected: new Set(),
  destUrls: new Set(),
};

// ---------- native host ----------
function ask(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST, msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res || !res.ok) return reject(new Error(res?.error || "Sin respuesta"));
      resolve(res);
    });
  });
}

// ---------- this profile ----------
const ROOT_KEYS = { "bookmarks-bar": "bookmark_bar", other: "other", mobile: "synced" };
const ROOT_FALLBACK = { 1: "bookmark_bar", 2: "other", 3: "synced" };

async function destRoots() {
  const [tree] = await chrome.bookmarks.getTree();
  return tree.children.map((n) => ({ node: n, key: ROOT_KEYS[n.folderType] || ROOT_FALLBACK[n.id] || "other" }));
}
function toPlain(n) {
  return n.url ? { title: n.title, url: n.url } : { title: n.title, children: (n.children || []).map(toPlain) };
}
function urlsOf(roots) {
  const set = new Set();
  const walk = (n) => { if (n.url) set.add(norm(n.url)); (n.children || []).forEach(walk); };
  roots.forEach(walk);
  return set;
}
async function refreshDest() {
  const roots = await destRoots();
  state.destUrls = urlsOf(roots.map((r) => r.node));
  return roots;
}

// ---------- loading ----------
async function init() {
  await refreshDest();
  let hostOk = true;
  try {
    // A random token in this profile's extension storage lets the host tell which profile we are.
    let { token } = await chrome.storage.local.get("token");
    if (!token) { token = `dt-${crypto.randomUUID()}`; await chrome.storage.local.set({ token }); }
    const { profiles, current } = await ask({ cmd: "profiles", token });
    state.profiles = profiles;
    // Fallback: guess by overlap of URLs (the browser writes its files with a delay).
    let best = { score: current ? 2 : 0, folder: current };
    for (const p of profiles) {
      const [{ roots }, { extensions }] = await Promise.all([
        ask({ cmd: "bookmarks", folder: p.folder }),
        ask({ cmd: "extensions", folder: p.folder }),
      ]);
      state.sources[p.folder] = { name: p.name, roots, extensions };
      const urls = urlsOf(roots);
      const inter = [...urls].filter((u) => state.destUrls.has(u)).length;
      const union = new Set([...urls, ...state.destUrls]).size || 1;
      const score = urls.size === 0 && state.destUrls.size === 0 ? 1 : inter / union;
      if (score > best.score) best = { score, folder: p.folder };
    }
    if (best.score >= 0.6) state.thisFolder = best.folder;
  } catch (e) {
    hostOk = false;
    $("#hostError").hidden = false;
    $("#hostErrorText").textContent = `(${e.message})`;
  }
  const here = state.sources[state.thisFolder]?.name;
  $("#here").textContent = here ? `${here} (este perfil)` : "Este perfil";
  fillSourceSelect(hostOk);
  await showUndo();
  selectSource($("#src").value);
}

function fillSourceSelect() {
  const sel = $("#src");
  sel.innerHTML = "";
  for (const p of state.profiles) {
    if (p.folder === state.thisFolder) continue;
    sel.add(new Option(p.name, p.folder));
  }
  for (const [k, s] of Object.entries(state.sources)) {
    if (k.startsWith("file:")) sel.add(new Option(`📄 ${s.name}`, k));
  }
  sel.add(new Option("📄 Importar desde archivo…", "__file__"));
  if (state.srcKey && [...sel.options].some((o) => o.value === state.srcKey)) sel.value = state.srcKey;
}

$("#src").addEventListener("change", (e) => {
  if (e.target.value === "__file__") { $("#fileInput").click(); e.target.value = state.srcKey || ""; return; }
  selectSource(e.target.value);
});

function selectSource(key) {
  state.srcKey = key && state.sources[key] ? key : null;
  const S = state.sources[state.srcKey];
  state.nodes = []; state.selected = new Set();
  if (S) {
    const index = (n, parent) => {
      n.id = state.nodes.length; n.parent = parent; state.nodes.push(n);
      if (n.url) { n.dup = state.destUrls.has(norm(n.url)); if (!n.dup) state.selected.add(n.id); }
      (n.children || []).forEach((c) => index(c, n));
    };
    S.roots.forEach((r) => index(r, null));
    $("#folderName").textContent = `(“Desde ${S.name}”)`;
  }
  render(); renderExt();
}

// ---------- bookmarks tree ----------
const leaves = (n) => (n.url ? [n] : (n.children || []).flatMap(leaves));
function visible(n, q, hide) {
  if (n.url) return !(hide && n.dup) && (!q || n.title.toLowerCase().includes(q) || n.url.toLowerCase().includes(q));
  return (n.children || []).some((c) => visible(c, q, hide));
}

function render() {
  const S = state.sources[state.srcKey];
  const q = $("#q").value.trim().toLowerCase(), hide = $("#hideDup").checked;
  if (!S) { $("#tree").innerHTML = `<div class="empty">Elige un perfil de origen.</div>`; updateSum(); return; }
  const html = S.roots.filter((r) => visible(r, q, hide)).map((r) => li(r, q, hide, 0)).join("");
  $("#tree").innerHTML = html ? `<ul>${html}</ul>`
    : `<div class="empty">${hide && !q ? "Ya tienes todos los marcadores de este perfil 🎉" : "Sin resultados"}</div>`;
  document.querySelectorAll("#tree input[data-folder]").forEach((cb) => {
    const L = leaves(state.nodes[cb.dataset.id]).filter((l) => !(hide && l.dup));
    const s = L.filter((l) => state.selected.has(l.id)).length;
    cb.checked = L.length > 0 && s === L.length;
    cb.indeterminate = s > 0 && s < L.length;
  });
  updateSum();
}

function li(n, q, hide, depth) {
  const pad = `style="padding-left:${14 + depth * 20}px"`;
  if (n.url) {
    const h = hostOf(n.url);
    return `<li class="${n.dup ? "dup" : ""}"><label class="row" ${pad}>
      <span class="twist"></span>
      <input type="checkbox" data-id="${n.id}" ${state.selected.has(n.id) ? "checked" : ""}>
      <span class="ico" style="background:hsl(${hue(h)} 55% 52%)">${esc((h[0] || "?").toUpperCase())}</span>
      <span class="name">${esc(n.title || n.url)}</span>
      <span class="host">${esc(h)}</span>
      ${n.dup ? '<span class="badge have">ya lo tienes</span>' : ""}
    </label></li>`;
  }
  const kids = n.children.filter((c) => visible(c, q, hide));
  const open = depth === 0 || q;
  return `<li class="${open ? "" : "closed"}"><div class="row" ${pad}>
      <button class="twist" data-twist aria-label="Abrir o cerrar">▼</button>
      <input type="checkbox" data-folder data-id="${n.id}" aria-label="${esc(n.title)}">
      <span class="ico folder-ico">📁</span>
      <span class="name"><b>${esc(n.title)}</b></span>
      <span class="count">${leaves(n).length}</span>
    </div><ul>${kids.map((c) => li(c, q, hide, depth + 1)).join("")}</ul></li>`;
}

function updateSum() {
  const all = state.nodes.filter((n) => n.url), dups = all.filter((n) => n.dup).length;
  const S = state.sources[state.srcKey];
  $("#sum").innerHTML = S
    ? `<b>${state.selected.size}</b> seleccionados · ${all.length} en ${esc(S.name)} · ${dups} ya los tienes`
    : "";
  $("#go").disabled = state.selected.size === 0;
  $("#bmPill").textContent = S ? String(all.length - dups || "") : "";
}

$("#tree").addEventListener("click", (e) => {
  if (e.target.matches("[data-twist]")) { e.target.closest("li").classList.toggle("closed"); e.preventDefault(); }
});
$("#tree").addEventListener("change", (e) => {
  const cb = e.target, n = state.nodes[cb.dataset.id], hide = $("#hideDup").checked;
  const L = n.url ? [n] : leaves(n).filter((l) => !(hide && l.dup));
  L.forEach((l) => (cb.checked ? state.selected.add(l.id) : state.selected.delete(l.id)));
  render();
});
$("#q").addEventListener("input", render);
$("#hideDup").addEventListener("change", () => {
  if ($("#hideDup").checked) state.nodes.forEach((n) => n.dup && state.selected.delete(n.id));
  render();
});
$("#all").onclick = () => { const hide = $("#hideDup").checked; state.nodes.forEach((n) => n.url && !(hide && n.dup) && state.selected.add(n.id)); render(); };
$("#none").onclick = () => { state.selected.clear(); render(); };

// ---------- copy ----------
const hasSelected = (n) => (n.url ? state.selected.has(n.id) : (n.children || []).some(hasSelected));

async function copySelected() {
  const S = state.sources[state.srcKey];
  const mode = document.querySelector("input[name=mode]:checked").value;
  const roots = await destRoots();
  const rootFor = (key) => (roots.find((r) => r.key === key) || roots[0]).node.id;
  const log = []; // created nodes, in creation order
  let count = 0;

  const create = async (props) => {
    const node = await chrome.bookmarks.create(props);
    log.push({ id: node.id, folder: !props.url });
    return node;
  };
  // Find a folder with the same name in the destination, or create it.
  const folderIn = async (parentId, title, merge) => {
    if (merge) {
      const kids = await chrome.bookmarks.getChildren(parentId);
      const hit = kids.find((k) => !k.url && k.title === title);
      if (hit) return hit.id;
    }
    return (await create({ parentId, title })).id;
  };
  const copyChildren = async (srcNode, parentId, merge) => {
    for (const c of srcNode.children) {
      if (!hasSelected(c)) continue;
      if (c.url) { await create({ parentId, title: c.title, url: c.url }); count++; }
      else await copyChildren(c, await folderIn(parentId, c.title, merge), merge);
    }
  };

  if (mode === "folder") {
    const base = (await create({ parentId: rootFor("bookmark_bar"), title: `Desde ${S.name}` })).id;
    for (const r of S.roots) {
      if (!hasSelected(r)) continue;
      const target = r.root === "bookmark_bar" ? base : await folderIn(base, r.title, false);
      await copyChildren(r, target, false);
    }
  } else {
    for (const r of S.roots) if (hasSelected(r)) await copyChildren(r, rootFor(r.root || "bookmark_bar"), true);
  }
  await chrome.storage.local.set({ lastRun: { log, count, from: S.name, at: Date.now() } });
  return count;
}

$("#go").onclick = async () => {
  const btn = $("#go");
  btn.disabled = true; btn.textContent = "Copiando…";
  try {
    const n = await copySelected();
    toast(`✓ ${n} marcadores copiados a este perfil`);
    await refreshDest();
    selectSource(state.srcKey);
    await showUndo();
  } catch (e) {
    toast(`Error: ${e.message}`);
  } finally {
    btn.textContent = "Copiar a este perfil";
    updateSum();
  }
};

// ---------- undo ----------
async function showUndo() {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  $("#undo").hidden = !lastRun;
  if (lastRun) $("#undo").title = `Quita los ${lastRun.count} marcadores copiados desde ${lastRun.from}`;
}
$("#undo").onclick = async () => {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  if (!lastRun || !confirm(`¿Quitar los ${lastRun.count} marcadores copiados desde ${lastRun.from}?`)) return;
  for (const item of [...lastRun.log].reverse()) {
    try {
      if (item.folder) {
        const kids = await chrome.bookmarks.getChildren(item.id);
        if (kids.length === 0) await chrome.bookmarks.remove(item.id); // never delete things the user added later
      } else await chrome.bookmarks.remove(item.id);
    } catch { /* already gone */ }
  }
  await chrome.storage.local.remove("lastRun");
  toast("Deshecho");
  await refreshDest();
  selectSource(state.srcKey);
  await showUndo();
};

// ---------- extensions ----------
async function renderExt() {
  const S = state.sources[state.srcKey];
  if (!S) { $("#extList").innerHTML = `<div class="empty">Elige un perfil de origen.</div>`; $("#extPill").textContent = ""; return; }
  const mine = await chrome.management.getAll();
  const have = new Set(mine.map((e) => e.id));
  const list = (S.extensions || []).filter((e) => e.id !== chrome.runtime.id);
  const miss = list.filter((e) => !have.has(e.id)), ok = list.filter((e) => have.has(e.id));
  $("#extPill").textContent = miss.length || "";
  const row = (e, m) => `<div class="ext-row"><span class="name">${esc(e.name)}</span>
    ${m ? `<span class="badge miss">falta</span><button class="btn small" data-install="${esc(e.id)}">Instalar</button>`
        : '<span class="badge have">instalada</span>'}</div>`;
  $("#extList").innerHTML =
    (miss.length
      ? `<div class="section-h"><span>Faltan aquí (${miss.length})</span><button class="link" id="installAll">Abrir todas</button></div>${miss.map((e) => row(e, true)).join("")}`
      : `<div class="empty">Tienes todas las extensiones de ${esc(S.name)} 🎉</div>`) +
    (ok.length ? `<div class="section-h"><span>Ya instaladas (${ok.length})</span></div>${ok.map((e) => row(e, false)).join("")}` : "");
  const open = (id, active) => chrome.tabs.create({ url: `https://chromewebstore.google.com/detail/${id}`, active });
  $("#extList").querySelectorAll("[data-install]").forEach((b) => (b.onclick = () => open(b.dataset.install, true)));
  const all = $("#installAll");
  if (all) all.onclick = () => miss.forEach((e, i) => open(e.id, i === 0));
}
chrome.management.onInstalled.addListener(renderExt);
chrome.management.onUninstalled.addListener(renderExt);

// ---------- export / import file ----------
$("#exportBtn").onclick = async () => {
  const roots = (await destRoots()).map((r) => ({ ...toPlain(r.node), root: r.key }));
  const extensions = (await chrome.management.getAll())
    .filter((e) => e.type === "extension" && e.id !== chrome.runtime.id && e.installType === "normal")
    .map((e) => ({ id: e.id, name: e.name }));
  const name = state.sources[state.thisFolder]?.name || "perfil";
  const data = { format: "dia-transfer", version: 1, profile: name, exportedAt: new Date().toISOString(), roots, extensions };
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })),
    download: `dia-transfer-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
  });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Archivo exportado");
};
$("#fileInput").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.format !== "dia-transfer" || !Array.isArray(data.roots)) throw new Error("No es un archivo de Dia Transfer");
    const key = `file:${f.name}`;
    state.sources[key] = { name: `${data.profile} (archivo)`, roots: data.roots, extensions: data.extensions || [] };
    state.srcKey = key;
    fillSourceSelect();
    selectSource(key);
  } catch (err) { toast(`No se pudo leer: ${err.message}`); }
});

// ---------- tabs & toast ----------
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => {
  document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", x === t));
  $("#tab-bm").hidden = t.dataset.tab !== "bm";
  $("#tab-ext").hidden = t.dataset.tab !== "ext";
  $("#bar").hidden = t.dataset.tab !== "bm";
}));
let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

init();
