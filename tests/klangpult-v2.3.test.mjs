import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let child;
let baseUrl;
let temporaryRoot;
let temporaryAudioDir;
let temporaryDataDir;
let temporaryBackgroundsDir;
let testHeroId;

const action = async (payload) => {
  const response = await fetch(`${baseUrl}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body;
};

before(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "klangpult-v2-test-"));
  temporaryAudioDir = path.join(temporaryRoot, "audio");
  temporaryDataDir = path.join(temporaryRoot, "data");
  temporaryBackgroundsDir = path.join(temporaryRoot, "backgrounds");
  await Promise.all([
    mkdir(path.join(temporaryAudioDir, "Marktplatz", "hintergrund"), { recursive: true }),
    mkdir(path.join(temporaryAudioDir, "Marktplatz", "dialog"), { recursive: true }),
    mkdir(path.join(temporaryAudioDir, "Taverne", "dialog"), { recursive: true }),
    mkdir(temporaryDataDir, { recursive: true }),
    mkdir(temporaryBackgroundsDir, { recursive: true }),
  ]);
  await Promise.all([
    copyFile(path.join(root, "dist", "client", "demo-audio", "Test_Marktplatz.wav"), path.join(temporaryAudioDir, "Marktplatz", "hintergrund", "Test_Marktplatz.wav")),
    copyFile(path.join(root, "dist", "client", "demo-audio", "Test_Erzaehler.wav"), path.join(temporaryAudioDir, "Marktplatz", "dialog", "Test_Erzaehler.wav")),
  ]);
  child = spawn(process.execPath, [path.join(root, "local-server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "0",
      AUDIO_DIR: temporaryAudioDir,
      DATA_DIR: temporaryDataDir,
      BACKGROUNDS_DIR: temporaryBackgroundsDir,
      PUBLIC_DIR: path.join(root, "dist", "client"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  baseUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Serverstart dauerte zu lange")), 5000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server wurde mit Code ${code} beendet`));
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/Klangpult v2\.3 läuft auf Port (\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
  });
});

after(async () => {
  child?.kill("SIGTERM");
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("liefert Status, Dashboard und Audiobibliothek", async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const libraryResponse = await fetch(`${baseUrl}/api/tracks`);
  const library = await libraryResponse.json();
  assert.equal(library.title, "Klangpult – Die Träne des Märtyrers");
  assert.equal(library.fadeSeconds, 3);
  assert.equal(library.tracks.length, 2);

  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /^text\/html/);
  assert.match(await page.text(), /DnD Meisterkontrolle/);
});

test("liefert neuen Browsercode ohne alten Piepton und mit Cache-Trennung", async () => {
  const index = await readFile(path.join(root, "dist", "client", "index.html"), "utf8");
  const pageAsset = /\/assets\/(page-[^"']+\.js)/.exec(index)?.[1];
  assert.ok(pageAsset, "Browserpaket wurde nicht in index.html gefunden");
  const bundle = await readFile(path.join(root, "dist", "client", "assets", pageAsset), "utf8");
  assert.match(bundle, /146\.83/);
  assert.match(bundle, /klangpult-workspace/);
  assert.doesNotMatch(bundle, /frequency\.setValueAtTime\(740/);
});

test("erkennt neue Audiodateien ohne Neustart und unterstützt Safari-Bereiche", async () => {
  await copyFile(
    path.join(temporaryAudioDir, "Marktplatz", "dialog", "Test_Erzaehler.wav"),
    path.join(temporaryAudioDir, "Taverne", "dialog", "Automatisch_erkannt.wav"),
  );
  const library = await (await fetch(`${baseUrl}/api/tracks?refresh=1`)).json();
  assert.ok(library.tracks.some((track) => track.scene === "Taverne" && track.title === "Automatisch erkannt"));

  const response = await fetch(`${baseUrl}/audio/Marktplatz/hintergrund/Test_Marktplatz.wav`, { headers: { Range: "bytes=0-99" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-length"), "100");
  assert.equal((await response.arrayBuffer()).byteLength, 100);
});

test("speichert Helden und wendet Rundeneffekte global an", async () => {
  let state = await action({
    action: "addHero",
    hero: {
      name: "Graubart", playerName: "Dirk", className: "Schurke", level: 4,
      initiative: 17, hpCurrent: 20, hpMax: 20, tempHp: 0, armorClass: 14, speed: 9,
      color: "#8f6b34", avatar: "", conditions: ["Vergiftet"], notes: "Testheld",
      stats: { strength: 11, dexterity: 16, constitution: 13, intelligence: 12, wisdom: 10, charisma: 9 },
    },
  });
  assert.equal(state.heroes.length, 1);
  testHeroId = state.heroes[0].id;

  state = await action({
    action: "addEffect", heroId: testHeroId,
    effect: {
      name: "Starkes Gift", timerMode: "rounds", rounds: 2,
      target: "armorClass", modifier: -2, stacking: "add",
      recurringAmount: -3, recurringEveryRounds: 1, sound: false,
    },
  });
  assert.equal(state.heroes[0].effects.length, 1);
  state = await action({ action: "nextRound" });
  assert.equal(state.round, 2);
  assert.equal(state.heroes[0].hpCurrent, 17);
  assert.equal(state.heroes[0].effects[0].remainingRounds, 1);
  state = await action({ action: "nextRound" });
  assert.equal(state.heroes[0].hpCurrent, 14);
  assert.equal(state.heroes[0].effects[0].status, "expired");
  assert.ok(state.activityLog.some((entry) => entry.type === "round" && entry.round === 3));
  assert.ok(state.activityLog.some((entry) => entry.type === "effect" && entry.title.includes("abgelaufen")));
  assert.ok(state.activityLog.some((entry) => entry.type === "hp" && entry.title.includes("Schaden")));

  const stored = JSON.parse(await readFile(path.join(temporaryDataDir, "state.json"), "utf8"));
  assert.equal(stored.heroes[0].name, "Graubart");
});

test("führt Würfelkombinationen, Vorteil und direkte LP-Änderung aus", async () => {
  let state = await action({ action: "rollDice", heroId: testHeroId, expression: "2W8+3", label: "Schaden", mode: "normal" });
  assert.equal(state.diceHistory[0].rolls.length, 2);
  assert.equal(state.diceHistory[0].heroId, testHeroId);
  assert.equal(state.diceHistory[0].heroName, "Graubart");
  assert.ok(state.diceHistory[0].total >= 5 && state.diceHistory[0].total <= 19);
  assert.deepEqual(state.activityLog[0].roll, state.diceHistory[0]);
  assert.match(state.activityLog[0].details, /\[[0-9]+, [0-9]+\]/);
  state = await action({ action: "rollDice", heroId: testHeroId, expression: "1W20+4", label: "Probe", mode: "advantage" });
  assert.equal(state.diceHistory[0].rolls.length, 2);
  assert.equal(state.diceHistory[0].keptRoll, Math.max(...state.diceHistory[0].rolls));
  state = await action({ action: "adjustHp", heroId: testHeroId, delta: -4 });
  assert.equal(state.heroes[0].hpCurrent, 10);
  assert.equal(state.activityLog[0].type, "hp");
  assert.equal(state.activityLog[0].heroId, testHeroId);
});

test("lässt Echtzeit-Timer serverseitig weiterlaufen", async () => {
  let state = await action({
    action: "addEffect", heroId: testHeroId,
    effect: { name: "Kurzer Test", timerMode: "realtime", durationSeconds: 1, target: "none", modifier: 0, recurringAmount: 0, sound: true },
  });
  assert.equal(state.heroes[0].effects.at(-1).status, "active");
  await new Promise((resolve) => setTimeout(resolve, 2300));
  state = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(state.heroes[0].effects.at(-1).status, "expired");
});

test("liest und speichert ein Abenteuer-Hintergrundbild", async () => {
  await writeFile(path.join(temporaryBackgroundsDir, "Grauenfurt.png"), Buffer.from([137, 80, 78, 71]));
  const list = await (await fetch(`${baseUrl}/api/backgrounds`)).json();
  assert.deepEqual(list.backgrounds, ["Grauenfurt.png"]);
  const state = await action({ action: "setAdventure", adventure: { title: "Grauenfurt", background: "Grauenfurt.png" } });
  assert.equal(state.adventure.background, "Grauenfurt.png");
  assert.equal((await fetch(`${baseUrl}/backgrounds/Grauenfurt.png`)).status, 200);
});

test("speichert das Gesamtprotokoll dauerhaft bis zum bestätigten Löschbefehl", async () => {
  const stored = JSON.parse(await readFile(path.join(temporaryDataDir, "state.json"), "utf8"));
  assert.ok(stored.activityLog.length >= 8);
  assert.ok(stored.activityLog.every((entry) => entry.createdAt && entry.round));
  const cleared = await action({ action: "clearActivityLog" });
  assert.deepEqual(cleared.activityLog, []);
  assert.deepEqual(cleared.diceHistory, []);
});
