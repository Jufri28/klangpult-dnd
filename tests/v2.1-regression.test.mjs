import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Browser-Bundle speichert das gewählte Hauptregister", async () => {
  const bundle = await readFile(
    path.join(projectDir, "dist/client/assets/page-DgGL8wLX.js"),
    "utf8",
  );
  assert.match(bundle, /localStorage\.getItem\(`klangpult-workspace`\)/);
  assert.match(bundle, /localStorage\.setItem\(`klangpult-workspace`,`heroes`\)/);
  assert.match(bundle, /localStorage\.setItem\(`klangpult-workspace`,`audio`\)/);
});

test("Echtzeit-Timer mit einer Minute bleibt nach dem ersten Sekundentakt aktiv", async (t) => {
  const temporaryDir = await mkdtemp(path.join(tmpdir(), "klangpult-v21-"));
  const audioDir = path.join(temporaryDir, "audio");
  const dataDir = path.join(temporaryDir, "data");
  const backgroundsDir = path.join(temporaryDir, "backgrounds");
  await Promise.all([mkdir(audioDir), mkdir(dataDir), mkdir(backgroundsDir)]);

  const server = spawn(process.execPath, [path.join(projectDir, "local-server.mjs")], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: "0",
      AUDIO_DIR: audioDir,
      DATA_DIR: dataDir,
      BACKGROUNDS_DIR: backgroundsDir,
      PUBLIC_DIR: path.join(projectDir, "dist/client"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(async () => {
    server.kill("SIGTERM");
    await rm(temporaryDir, { recursive: true, force: true });
  });

  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Testserver startete nicht")), 5000);
    server.once("error", reject);
    server.stdout.on("data", (chunk) => {
      const match = /Port (\d+)/.exec(String(chunk));
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
  });

  const post = async (body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  const created = await post({
    action: "addHero",
    hero: { name: "Timer-Test", hpCurrent: 10, hpMax: 10 },
  });
  const heroId = created.heroes[0].id;
  const withEffect = await post({
    action: "addEffect",
    heroId,
    effect: {
      name: "Eine Minute",
      timerMode: "realtime",
      durationSeconds: 60,
      target: "none",
      recurringAmount: 0,
      recurringEverySeconds: 60,
      sound: false,
    },
  });

  const startedEffect = withEffect.heroes[0].effects[0];
  assert.equal(startedEffect.endsAt - startedEffect.createdAt, 60_000);

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const activeEffect = state.heroes[0].effects[0];
  assert.equal(activeEffect.status, "active");
  const remainingSeconds = Math.ceil((activeEffect.endsAt - Date.now()) / 1000);
  assert.ok(remainingSeconds >= 57 && remainingSeconds <= 59, `Restzeit: ${remainingSeconds}`);
});
