import { createReadStream } from "node:fs";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.resolve(process.env.AUDIO_DIR || path.join(projectDir, "audio"));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectDir, "data"));
const backgroundsDir = path.resolve(process.env.BACKGROUNDS_DIR || path.join(projectDir, "backgrounds"));
const publicDir = path.resolve(process.env.PUBLIC_DIR || path.join(projectDir, "dist", "client"));
const stateFile = path.join(dataDir, "state.json");
const portArgumentIndex = process.argv.indexOf("--port");
const commandLinePort = portArgumentIndex >= 0 ? process.argv[portArgumentIndex + 1] : "";
const port = Number.parseInt(process.env.PORT || commandLinePort || "8095", 10);

const supportedAudio = new Map([
  [".mp3", "audio/mpeg"], [".wav", "audio/wav"], [".m4a", "audio/mp4"],
  [".aac", "audio/aac"], [".ogg", "audio/ogg"], [".flac", "audio/flac"],
]);
const supportedImages = new Map([
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"],
]);
const staticMimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"], [".svg", "image/svg+xml"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"], [".woff2", "font/woff2"],
]);
const kindAliases = new Map([
  ["hintergrund", "background"], ["background", "background"], ["loop", "background"],
  ["musik", "background"], ["dialog", "dialogue"], ["dialoge", "dialogue"],
  ["dialogue", "dialogue"], ["einmal", "dialogue"], ["erzaehler", "dialogue"], ["erzähler", "dialogue"],
]);
const effectTargets = new Set([
  "none", "hpMax", "armorClass", "speed", "strength", "dexterity",
  "constitution", "intelligence", "wisdom", "charisma",
]);

const defaultState = () => ({
  version: 3,
  adventure: { title: "Die Träne des Märtyrers", background: "" },
  round: 1,
  heroes: [],
  diceHistory: [],
  activityLog: [],
  updatedAt: Date.now(),
});

const sendJson = (response, statusCode, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
};

const cleanString = (value, fallback = "", maximum = 500) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : fallback;
const finite = (value, fallback = 0, minimum = -100000, maximum = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
};
const integer = (value, fallback = 0, minimum = -100000, maximum = 100000) =>
  Math.round(finite(value, fallback, minimum, maximum));
const safeReadDirectory = async (directory) => {
  try { return await readdir(directory, { withFileTypes: true }); } catch { return []; }
};
const isInside = (candidate, root) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

const normalizeEffect = (effect) => ({
  id: cleanString(effect?.id, randomUUID(), 80),
  name: cleanString(effect?.name, "Unbenannter Effekt", 80),
  timerMode: effect?.timerMode === "realtime" ? "realtime" : "rounds",
  status: ["active", "paused", "expired"].includes(effect?.status) ? effect.status : "active",
  createdAt: finite(effect?.createdAt, Date.now(), 0),
  endsAt: effect?.endsAt == null ? null : finite(effect.endsAt, null, 0),
  pausedAt: effect?.pausedAt == null ? null : finite(effect.pausedAt, null, 0),
  pausedRemainingSeconds: integer(effect?.pausedRemainingSeconds, 0, 0, 604800),
  remainingRounds: integer(effect?.remainingRounds, 1, 0, 9999),
  target: effectTargets.has(effect?.target) ? effect.target : "none",
  modifier: integer(effect?.modifier, 0, -999, 999),
  stacking: effect?.stacking === "strongest" ? "strongest" : "add",
  recurringAmount: integer(effect?.recurringAmount, 0, -9999, 9999),
  recurringEverySeconds: integer(effect?.recurringEverySeconds, 60, 1, 604800),
  recurringEveryRounds: integer(effect?.recurringEveryRounds, 1, 1, 999),
  nextTickAt: effect?.nextTickAt == null ? null : finite(effect.nextTickAt, null, 0),
  tickRemainingSeconds: integer(effect?.tickRemainingSeconds, 0, 0, 604800),
  roundsUntilTick: integer(effect?.roundsUntilTick, 1, 1, 999),
  sound: effect?.sound !== false,
  expiredAt: effect?.expiredAt == null ? null : finite(effect.expiredAt, null, 0),
});

const cleanAvatar = (value) => {
  if (typeof value !== "string" || value.length > 1_500_000) return "";
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : "";
};

const sanitizeHero = (input, existing = null) => {
  const stats = input?.stats || {};
  const hpMax = integer(input?.hpMax, existing?.hpMax ?? 10, 1, 99999);
  return {
    id: existing?.id || randomUUID(),
    name: cleanString(input?.name, existing?.name || "Neuer Held", 80),
    playerName: cleanString(input?.playerName, existing?.playerName || "", 80),
    className: cleanString(input?.className, existing?.className || "", 80),
    level: integer(input?.level, existing?.level ?? 1, 1, 30),
    avatar: cleanAvatar(input?.avatar) || existing?.avatar || "",
    color: /^#[0-9a-f]{6}$/i.test(input?.color || "") ? input.color : existing?.color || "#9a7135",
    initiative: integer(input?.initiative, existing?.initiative ?? 0, -99, 999),
    hpCurrent: integer(input?.hpCurrent, existing?.hpCurrent ?? hpMax, 0, 99999),
    hpMax,
    tempHp: integer(input?.tempHp, existing?.tempHp ?? 0, 0, 99999),
    armorClass: integer(input?.armorClass, existing?.armorClass ?? 10, 0, 999),
    speed: integer(input?.speed, existing?.speed ?? 9, 0, 999),
    stats: {
      strength: integer(stats.strength, existing?.stats?.strength ?? 10, 0, 99),
      dexterity: integer(stats.dexterity, existing?.stats?.dexterity ?? 10, 0, 99),
      constitution: integer(stats.constitution, existing?.stats?.constitution ?? 10, 0, 99),
      intelligence: integer(stats.intelligence, existing?.stats?.intelligence ?? 10, 0, 99),
      wisdom: integer(stats.wisdom, existing?.stats?.wisdom ?? 10, 0, 99),
      charisma: integer(stats.charisma, existing?.stats?.charisma ?? 10, 0, 99),
    },
    conditions: Array.isArray(input?.conditions)
      ? input.conditions.map((value) => cleanString(value, "", 60)).filter(Boolean).slice(0, 20)
      : existing?.conditions || [],
    notes: cleanString(input?.notes, existing?.notes || "", 2000),
    effects: existing?.effects || [],
  };
};

const normalizeDiceRoll = (roll) => ({
  id: cleanString(roll?.id, randomUUID(), 80),
  heroId: roll?.heroId == null ? null : cleanString(roll.heroId, "", 80) || null,
  heroName: cleanString(roll?.heroName, "", 80),
  label: cleanString(roll?.label, "", 80),
  expression: cleanString(roll?.expression, "1W20", 40),
  mode: ["advantage", "disadvantage"].includes(roll?.mode) ? roll.mode : "normal",
  rolls: Array.isArray(roll?.rolls) ? roll.rolls.slice(0, 20).map((value) => integer(value, 1, 1, 100)) : [],
  keptRoll: roll?.keptRoll == null ? null : integer(roll.keptRoll, 1, 1, 100),
  modifier: integer(roll?.modifier, 0, -999, 999),
  total: integer(roll?.total, 0, -99999, 99999),
  createdAt: finite(roll?.createdAt, Date.now(), 0),
});

const normalizeActivity = (entry) => ({
  id: cleanString(entry?.id, randomUUID(), 80),
  type: ["dice", "hp", "effect", "round"].includes(entry?.type) ? entry.type : "effect",
  heroId: entry?.heroId == null ? null : cleanString(entry.heroId, "", 80) || null,
  heroName: cleanString(entry?.heroName, "", 80),
  title: cleanString(entry?.title, "Ereignis", 120),
  details: cleanString(entry?.details, "", 500),
  round: integer(entry?.round, 1, 1, 999999),
  createdAt: finite(entry?.createdAt, Date.now(), 0),
  roll: entry?.roll ? normalizeDiceRoll(entry.roll) : null,
});

const normalizeState = (input) => {
  const state = defaultState();
  if (!input || typeof input !== "object") return state;
  state.adventure.title = cleanString(input.adventure?.title, state.adventure.title, 120);
  state.adventure.background = cleanString(input.adventure?.background, "", 200);
  state.round = integer(input.round, 1, 1, 999999);
  state.heroes = Array.isArray(input.heroes)
    ? input.heroes.slice(0, 30).map((hero) => {
        const normalized = sanitizeHero(hero);
        normalized.id = cleanString(hero?.id, randomUUID(), 80);
        normalized.effects = Array.isArray(hero?.effects) ? hero.effects.slice(0, 20).map(normalizeEffect) : [];
        return normalized;
      })
    : [];
  state.diceHistory = Array.isArray(input.diceHistory) ? input.diceHistory.slice(0, 50).map(normalizeDiceRoll) : [];
  state.activityLog = Array.isArray(input.activityLog) ? input.activityLog.map(normalizeActivity) : [];
  state.updatedAt = finite(input.updatedAt, Date.now(), 0);
  return state;
};

function recordActivity(state, { type, hero = null, title, details = "", roll = null }) {
  state.activityLog.unshift(normalizeActivity({
    id: randomUUID(),
    type,
    heroId: hero?.id || null,
    heroName: hero?.name || "",
    title,
    details,
    round: state.round,
    createdAt: Date.now(),
    roll,
  }));
}

let gameState = defaultState();
let mutationQueue = Promise.resolve();

async function persistState() {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${stateFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify(gameState, null, 2)}\n`, "utf8");
  await rename(temporary, stateFile);
}

async function loadState() {
  await mkdir(dataDir, { recursive: true });
  try { gameState = normalizeState(JSON.parse(await readFile(stateFile, "utf8"))); }
  catch { gameState = defaultState(); }
  const now = Date.now();
  for (const hero of gameState.heroes) {
    for (const effect of hero.effects) {
      if (effect.timerMode !== "realtime" || effect.status !== "active") continue;
      if (effect.endsAt && effect.endsAt <= now) {
        effect.status = "expired";
        effect.expiredAt = now;
        recordActivity(gameState, {
          type: "effect",
          hero,
          title: `${effect.name} abgelaufen`,
          details: "Echtzeittimer lief während eines Neustarts ab",
        });
      } else if (effect.nextTickAt && effect.nextTickAt < now) {
        effect.nextTickAt = now + effect.recurringEverySeconds * 1000;
      }
    }
    clampHeroHp(hero);
  }
  await persistState();
}

async function mutateState(mutator) {
  const task = mutationQueue.catch(() => {}).then(async () => {
    const changed = await mutator(gameState);
    if (changed !== false) {
      gameState.updatedAt = Date.now();
      await persistState();
    }
    return structuredClone(gameState);
  });
  mutationQueue = task.catch(() => {});
  return task;
}

function activeModifier(hero, target) {
  const relevant = hero.effects.filter(
    (effect) => effect.status !== "expired" && effect.target === target && effect.modifier !== 0,
  );
  const additive = relevant.filter((effect) => effect.stacking === "add").reduce((sum, effect) => sum + effect.modifier, 0);
  const strongest = relevant.filter((effect) => effect.stacking === "strongest")
    .sort((a, b) => Math.abs(b.modifier) - Math.abs(a.modifier))[0];
  return additive + (strongest?.modifier || 0);
}

function adjustHeroHp(hero, delta) {
  const effectiveMaximum = Math.max(1, hero.hpMax + activeModifier(hero, "hpMax"));
  const before = hero.hpCurrent;
  const requestedDelta = integer(delta, 0, -99999, 99999);
  hero.hpCurrent = Math.max(0, Math.min(effectiveMaximum, hero.hpCurrent + requestedDelta));
  return { before, after: hero.hpCurrent, appliedDelta: hero.hpCurrent - before, requestedDelta };
}

function clampHeroHp(hero) {
  const effectiveMaximum = Math.max(1, hero.hpMax + activeModifier(hero, "hpMax"));
  hero.hpCurrent = Math.max(0, Math.min(effectiveMaximum, hero.hpCurrent));
}

function expireEffect(effect, now) {
  effect.status = "expired";
  effect.expiredAt = now;
  effect.endsAt = null;
  effect.pausedAt = null;
}

async function processRealtimeEffects() {
  const now = Date.now();
  await mutateState((state) => {
    let changed = false;
    for (const hero of state.heroes) {
      for (const effect of hero.effects) {
        if (effect.timerMode !== "realtime" || effect.status !== "active") continue;
        const finalTickTime = effect.endsAt ? Math.min(now, effect.endsAt) : now;
        let safety = 0;
        while (effect.recurringAmount !== 0 && effect.nextTickAt && effect.nextTickAt <= finalTickTime && safety < 100) {
          const hpChange = adjustHeroHp(hero, effect.recurringAmount);
          recordActivity(state, {
            type: "hp",
            hero,
            title: hpChange.appliedDelta < 0 ? "Wiederkehrender Schaden" : "Wiederkehrende Heilung",
            details: `${effect.name}: ${hpChange.before} → ${hpChange.after} LP (${hpChange.appliedDelta > 0 ? "+" : ""}${hpChange.appliedDelta})`,
          });
          effect.nextTickAt += effect.recurringEverySeconds * 1000;
          changed = true;
          safety += 1;
        }
        if (effect.endsAt && effect.endsAt <= now) {
          expireEffect(effect, now);
          clampHeroHp(hero);
          recordActivity(state, {
            type: "effect",
            hero,
            title: `${effect.name} abgelaufen`,
            details: "Echtzeittimer regulär beendet",
          });
          changed = true;
        }
      }
    }
    return changed;
  });
}

const readConfiguration = async () => {
  try { return JSON.parse(await readFile(path.join(audioDir, "config.json"), "utf8")); }
  catch { return {}; }
};
const naturalTitle = (filename) => path.basename(filename, path.extname(filename)).replaceAll("_", " ").replace(/\s+/g, " ").trim();
const encodeUrlPath = (relativePath) => relativePath.split(path.sep).map(encodeURIComponent).join("/");

async function scanAudioLibrary() {
  const config = await readConfiguration();
  const sceneEntries = (await safeReadDirectory(audioDir)).filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const detectedScenes = sceneEntries.map((entry) => entry.name);
  const preferredScenes = Array.isArray(config.sceneOrder) ? config.sceneOrder : [];
  const scenes = [
    ...preferredScenes.filter((scene) => detectedScenes.includes(scene)),
    ...detectedScenes.filter((scene) => !preferredScenes.includes(scene)).sort((a, b) => a.localeCompare(b, "de")),
  ];
  const tracks = [];
  for (const scene of scenes) {
    const typeEntries = (await safeReadDirectory(path.join(audioDir, scene))).filter(
      (entry) => entry.isDirectory() && kindAliases.has(entry.name.toLocaleLowerCase("de")),
    );
    for (const typeEntry of typeEntries) {
      const kind = kindAliases.get(typeEntry.name.toLocaleLowerCase("de"));
      const files = (await safeReadDirectory(path.join(audioDir, scene, typeEntry.name))).filter(
        (entry) => entry.isFile() && supportedAudio.has(path.extname(entry.name).toLowerCase()),
      );
      for (const file of files) {
        const relativePath = path.join(scene, typeEntry.name, file.name);
        const key = relativePath.split(path.sep).join("/");
        const override = config.tracks?.[key] || {};
        if (override.hidden === true) continue;
        tracks.push({
          id: key, scene, kind, title: override.title || naturalTitle(file.name),
          url: `/audio/${encodeUrlPath(relativePath)}`,
          order: Number.isFinite(override.order) ? override.order : 999,
          volume: Number.isFinite(override.volume) ? override.volume : 1,
        });
      }
    }
  }
  tracks.sort((a, b) => scenes.indexOf(a.scene) - scenes.indexOf(b.scene) || a.kind.localeCompare(b.kind) || a.order - b.order || a.title.localeCompare(b.title, "de"));
  return { title: config.title || "Klangpult – Die Träne des Märtyrers", fadeSeconds: Number.isFinite(config.fadeSeconds) ? config.fadeSeconds : 3, scenes, tracks };
}

async function scanBackgrounds() {
  return (await safeReadDirectory(backgroundsDir))
    .filter((entry) => entry.isFile() && supportedImages.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "de"));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_500_000) throw new Error("Anfrage ist zu groß");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new Error("Ungültige JSON-Anfrage"); }
}

function findHero(state, heroId) {
  const hero = state.heroes.find((item) => item.id === heroId);
  if (!hero) throw new Error("Held wurde nicht gefunden");
  return hero;
}

function parseDice(expression, mode) {
  const match = /^\s*(\d{0,2})\s*[wd]\s*(4|6|8|10|12|20|100)\s*([+-]\s*\d+)?\s*$/i.exec(String(expression || ""));
  if (!match) throw new Error("Würfelformel ungültig – Beispiel: 3W6+2");
  const count = match[1] ? integer(match[1], 1, 1, 20) : 1;
  const sides = integer(match[2], 20);
  const modifier = match[3] ? integer(match[3].replace(/\s/g, ""), 0, -999, 999) : 0;
  if (mode !== "normal" && (sides !== 20 || count !== 1)) throw new Error("Vorteil und Nachteil funktionieren nur mit 1W20");
  const rollCount = mode === "normal" ? count : 2;
  const rolls = Array.from({ length: rollCount }, () => randomInt(1, sides + 1));
  const keptRoll = mode === "advantage" ? Math.max(...rolls) : mode === "disadvantage" ? Math.min(...rolls) : null;
  const total = (keptRoll ?? rolls.reduce((sum, value) => sum + value, 0)) + modifier;
  return { expression: `${count}W${sides}${modifier ? `${modifier > 0 ? "+" : ""}${modifier}` : ""}`, rolls, keptRoll, modifier, total };
}

async function handleAction(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Aktion fehlt");
  return mutateState(async (state) => {
    switch (payload.action) {
      case "addHero": {
        const hero = sanitizeHero(payload.hero);
        hero.hpCurrent = Math.min(hero.hpCurrent, hero.hpMax);
        state.heroes.push(hero);
        break;
      }
      case "updateHero": {
        const index = state.heroes.findIndex((hero) => hero.id === payload.heroId);
        if (index < 0) throw new Error("Held wurde nicht gefunden");
        const previousHp = state.heroes[index].hpCurrent;
        state.heroes[index] = sanitizeHero(payload.hero, state.heroes[index]);
        clampHeroHp(state.heroes[index]);
        const hero = state.heroes[index];
        if (hero.hpCurrent !== previousHp) {
          const delta = hero.hpCurrent - previousHp;
          recordActivity(state, {
            type: "hp",
            hero,
            title: delta < 0 ? "Lebenspunkte reduziert" : "Lebenspunkte erhöht",
            details: `${previousHp} → ${hero.hpCurrent} LP (${delta > 0 ? "+" : ""}${delta})`,
          });
        }
        break;
      }
      case "deleteHero": {
        const index = state.heroes.findIndex((hero) => hero.id === payload.heroId);
        if (index < 0) throw new Error("Held wurde nicht gefunden");
        state.heroes.splice(index, 1);
        break;
      }
      case "adjustHp": {
        const hero = findHero(state, payload.heroId);
        const change = adjustHeroHp(hero, payload.delta);
        recordActivity(state, {
          type: "hp",
          hero,
          title: change.appliedDelta < 0 ? "Schaden" : change.appliedDelta > 0 ? "Heilung" : "LP unverändert",
          details: `${change.before} → ${change.after} LP (${change.appliedDelta > 0 ? "+" : ""}${change.appliedDelta})`,
        });
        break;
      }
      case "addEffect": {
        const hero = findHero(state, payload.heroId);
        if (hero.effects.filter((effect) => effect.status !== "expired").length >= 5) throw new Error("Dieser Held hat bereits fünf aktive Effekte");
        const input = payload.effect || {};
        const now = Date.now();
        const timerMode = input.timerMode === "realtime" ? "realtime" : "rounds";
        const durationSeconds = integer(input.durationSeconds, 60, 1, 604800);
        const remainingRounds = integer(input.rounds, 1, 1, 9999);
        const recurringEverySeconds = integer(input.recurringEverySeconds, 60, 1, 604800);
        const recurringEveryRounds = integer(input.recurringEveryRounds, 1, 1, 999);
        const effect = normalizeEffect({
          id: randomUUID(), name: cleanString(input.name, "Unbenannter Effekt", 80), timerMode,
          status: "active", createdAt: now,
          endsAt: timerMode === "realtime" ? now + durationSeconds * 1000 : null,
          pausedAt: null, pausedRemainingSeconds: 0, remainingRounds,
          target: effectTargets.has(input.target) ? input.target : "none",
          modifier: integer(input.modifier, 0, -999, 999),
          stacking: input.stacking === "strongest" ? "strongest" : "add",
          recurringAmount: integer(input.recurringAmount, 0, -9999, 9999),
          recurringEverySeconds, recurringEveryRounds,
          nextTickAt: timerMode === "realtime" && input.recurringAmount ? now + recurringEverySeconds * 1000 : null,
          tickRemainingSeconds: recurringEverySeconds, roundsUntilTick: recurringEveryRounds,
          sound: input.sound !== false, expiredAt: null,
        });
        hero.effects.push(effect);
        recordActivity(state, {
          type: "effect",
          hero,
          title: `${effect.name} gestartet`,
          details: effect.timerMode === "realtime"
            ? `Echtzeittimer: ${durationSeconds} Sekunden`
            : `Rundentimer: ${remainingRounds} Runde${remainingRounds === 1 ? "" : "n"}`,
        });
        break;
      }
      case "updateEffect": {
        const hero = findHero(state, payload.heroId);
        const effectIndex = hero.effects.findIndex((effect) => effect.id === payload.effectId);
        if (effectIndex < 0) throw new Error("Effekt wurde nicht gefunden");
        const effect = hero.effects[effectIndex];
        const now = Date.now();
        if (payload.operation === "dismiss") {
          recordActivity(state, { type: "effect", hero, title: `${effect.name} entfernt`, details: "Abgelaufenen Effekt aus der Heldenkarte entfernt" });
          hero.effects.splice(effectIndex, 1);
          clampHeroHp(hero);
        } else if (payload.operation === "end") {
          expireEffect(effect, now);
          clampHeroHp(hero);
          recordActivity(state, { type: "effect", hero, title: `${effect.name} vorzeitig beendet`, details: "Timer manuell beendet" });
        } else if (payload.operation === "pause" && effect.status === "active") {
          effect.status = "paused";
          effect.pausedAt = now;
          if (effect.timerMode === "realtime") {
            effect.pausedRemainingSeconds = Math.max(0, Math.ceil(((effect.endsAt || now) - now) / 1000));
            effect.tickRemainingSeconds = effect.nextTickAt ? Math.max(1, Math.ceil((effect.nextTickAt - now) / 1000)) : effect.recurringEverySeconds;
            effect.endsAt = null;
            effect.nextTickAt = null;
          }
          recordActivity(state, { type: "effect", hero, title: `${effect.name} pausiert`, details: "Timer angehalten" });
        } else if (payload.operation === "resume" && effect.status === "paused") {
          effect.status = "active";
          if (effect.timerMode === "realtime") {
            effect.endsAt = now + Math.max(1, effect.pausedRemainingSeconds) * 1000;
            effect.nextTickAt = effect.recurringAmount ? now + Math.max(1, effect.tickRemainingSeconds) * 1000 : null;
          }
          effect.pausedAt = null;
          recordActivity(state, { type: "effect", hero, title: `${effect.name} fortgesetzt`, details: "Timer wieder gestartet" });
        } else if (payload.operation === "extend" && effect.status !== "expired") {
          const amount = integer(payload.amount, effect.timerMode === "rounds" ? 1 : 60, 1, 604800);
          if (effect.timerMode === "rounds") effect.remainingRounds += amount;
          else if (effect.status === "paused") effect.pausedRemainingSeconds += amount;
          else effect.endsAt = (effect.endsAt || now) + amount * 1000;
          recordActivity(state, {
            type: "effect",
            hero,
            title: `${effect.name} verlängert`,
            details: effect.timerMode === "rounds" ? `+${amount} Runde${amount === 1 ? "" : "n"}` : `+${amount} Sekunden`,
          });
        }
        break;
      }
      case "nextRound": {
        const previousRound = state.round;
        state.round += 1;
        recordActivity(state, { type: "round", title: `Runde ${state.round} begonnen`, details: `Rundenwechsel ${previousRound} → ${state.round}` });
        const now = Date.now();
        for (const hero of state.heroes) {
          for (const effect of hero.effects) {
            if (effect.timerMode !== "rounds" || effect.status !== "active") continue;
            effect.roundsUntilTick -= 1;
            if (effect.recurringAmount !== 0 && effect.roundsUntilTick <= 0) {
              const change = adjustHeroHp(hero, effect.recurringAmount);
              recordActivity(state, {
                type: "hp",
                hero,
                title: change.appliedDelta < 0 ? "Wiederkehrender Schaden" : "Wiederkehrende Heilung",
                details: `${effect.name}: ${change.before} → ${change.after} LP (${change.appliedDelta > 0 ? "+" : ""}${change.appliedDelta})`,
              });
              effect.roundsUntilTick = effect.recurringEveryRounds;
            }
            effect.remainingRounds -= 1;
            if (effect.remainingRounds <= 0) {
              expireEffect(effect, now);
              clampHeroHp(hero);
              recordActivity(state, { type: "effect", hero, title: `${effect.name} abgelaufen`, details: `Rundentimer in Runde ${state.round} beendet` });
            }
          }
        }
        break;
      }
      case "rollDice": {
        const mode = ["advantage", "disadvantage"].includes(payload.mode) ? payload.mode : "normal";
        const roll = parseDice(payload.expression, mode);
        const hero = payload.heroId ? findHero(state, payload.heroId) : null;
        const diceRoll = normalizeDiceRoll({
          id: randomUUID(),
          heroId: hero?.id || null,
          heroName: hero?.name || "",
          label: cleanString(payload.label, "", 80),
          mode,
          ...roll,
          createdAt: Date.now(),
        });
        state.diceHistory.unshift(diceRoll);
        state.diceHistory = state.diceHistory.slice(0, 50);
        const keptText = diceRoll.keptRoll == null ? "" : `; gewertet: ${diceRoll.keptRoll}`;
        recordActivity(state, {
          type: "dice",
          hero,
          title: diceRoll.label || `${hero?.name || "Meister"}: ${diceRoll.expression}`,
          details: `${diceRoll.expression} → [${diceRoll.rolls.join(", ")}]${keptText}${diceRoll.modifier ? `; Modifikator ${diceRoll.modifier > 0 ? "+" : ""}${diceRoll.modifier}` : ""}; Ergebnis ${diceRoll.total}`,
          roll: diceRoll,
        });
        break;
      }
      case "clearDiceHistory": state.diceHistory = []; break;
      case "clearActivityLog": {
        state.activityLog = [];
        state.diceHistory = [];
        break;
      }
      case "setAdventure": {
        const available = await scanBackgrounds();
        const requested = cleanString(payload.adventure?.background, "", 200);
        if (requested && !available.includes(requested)) throw new Error("Das ausgewählte Hintergrundbild wurde nicht gefunden");
        state.adventure.title = cleanString(payload.adventure?.title, "Die Träne des Märtyrers", 120);
        state.adventure.background = requested;
        break;
      }
      default: throw new Error("Unbekannte Aktion");
    }
  });
}

async function serveFile(request, response, filePath, contentType, cacheControl = "public, max-age=3600", allowRange = false) {
  let fileInfo;
  try { fileInfo = await stat(filePath); if (!fileInfo.isFile()) throw new Error("not a file"); }
  catch { sendJson(response, 404, { error: "Datei nicht gefunden" }); return; }
  const range = allowRange ? request.headers.range : null;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { response.writeHead(416, { "Content-Range": `bytes */${fileInfo.size}` }); response.end(); return; }
    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(Number.parseInt(match[2], 10), fileInfo.size - 1) : fileInfo.size - 1;
    if (start > end || start >= fileInfo.size) { response.writeHead(416, { "Content-Range": `bytes */${fileInfo.size}` }); response.end(); return; }
    response.writeHead(206, { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${fileInfo.size}`, "Content-Length": end - start + 1, "Content-Type": contentType, "Cache-Control": cacheControl });
    if (request.method === "HEAD") response.end(); else createReadStream(filePath, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { "Accept-Ranges": allowRange ? "bytes" : "none", "Content-Length": fileInfo.size, "Content-Type": contentType, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" });
  if (request.method === "HEAD") response.end(); else createReadStream(filePath).pipe(response);
}

async function serveMedia(request, response, pathname, prefix, root, mimeMap, allowRange = false) {
  let decoded;
  try { decoded = decodeURIComponent(pathname.slice(prefix.length)); }
  catch { sendJson(response, 400, { error: "Ungültiger Dateipfad" }); return; }
  const filePath = path.resolve(root, decoded);
  const contentType = mimeMap.get(path.extname(filePath).toLowerCase());
  if (!isInside(filePath, root) || !contentType) { sendJson(response, 403, { error: "Zugriff verweigert" }); return; }
  await serveFile(request, response, filePath, contentType, "public, max-age=3600", allowRange);
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(publicDir, requested);
  if (!isInside(filePath, publicDir)) { sendJson(response, 403, { error: "Zugriff verweigert" }); return; }
  try { await access(filePath); if (!(await stat(filePath)).isFile()) throw new Error("not a file"); }
  catch {
    filePath = path.join(publicDir, "index.html");
    try { await access(filePath); } catch { sendJson(response, 503, { error: "Dashboard wurde noch nicht gebaut" }); return; }
  }
  await serveFile(request, response, filePath, staticMimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream", path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=3600");
}

await loadState();
await mkdir(backgroundsDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "POST" && url.pathname === "/api/action") {
      sendJson(response, 200, await handleAction(await readJson(request)));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") { sendJson(response, 405, { error: "Methode nicht erlaubt" }); return; }
    if (url.pathname === "/api/health") { sendJson(response, 200, { status: "ok" }); return; }
    if (url.pathname === "/api/tracks") { sendJson(response, 200, await scanAudioLibrary()); return; }
    if (url.pathname === "/api/state") { sendJson(response, 200, structuredClone(gameState)); return; }
    if (url.pathname === "/api/backgrounds") { sendJson(response, 200, { backgrounds: await scanBackgrounds() }); return; }
    if (url.pathname.startsWith("/audio/")) { await serveMedia(request, response, url.pathname, "/audio/", audioDir, supportedAudio, true); return; }
    if (url.pathname.startsWith("/backgrounds/")) { await serveMedia(request, response, url.pathname, "/backgrounds/", backgroundsDir, supportedImages); return; }
    await serveStatic(request, response, url.pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 400, { error: error instanceof Error ? error.message : "Interner Serverfehler" });
    else response.end();
  }
});

const effectTimer = setInterval(() => void processRealtimeEffects().catch(console.error), 1000);
effectTimer.unref();

server.listen(port, "0.0.0.0", () => {
  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : port;
  console.log(`Klangpult v2.3 läuft auf Port ${activePort}`);
  console.log(`Audioordner: ${audioDir}`);
  console.log(`Datenordner: ${dataDir}`);
});
