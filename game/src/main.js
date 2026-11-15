// CINDERFALL — boot and the one loop. A fixed 60 Hz simulation feeds a render at
// the display's rate; this module owns the shooting raycast, the tracer pool, the
// noise the bots hear, the round-event fan-out and the deterministic ?shot= frames
// the screenshots are taken from. Everything it needs arrives through the modules
// below; the game state itself lives in rounds.js, and this file never duplicates it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createBots } from './bots.js';
import { createWeapons, WEAPONS } from './weapons.js';
import { createPlayer } from './player.js';
import { createRounds } from './rounds.js';
import { createGrenades } from './grenades.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const BASE_FOV = 74;
const AIM_FOV = 58;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Live play seeds from the clock; a ?shot= frame seeds from the URL, so a capture
// is the same frame every time it is taken.
const rng = shot ? mulberry32(seed) : mulberry32((Date.now() % 2147483647) || 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 34, 95);
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const world = createWorld(scene);
const player = createPlayer(scene, world);
const weapons = createWeapons(camera);
const bots = createBots(scene, world, rng);
const grenades = createGrenades(scene, world);
const rounds = createRounds(world, scene);
const audio = createAudio();
const hud = createHud({ persistent: !!shot });
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const shootTargets = world.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const body = player.state;
const markerHoldMs = shot ? 4000 : 90;

// Tracers: a fixed pool of lines, reused round-robin, fading over 70 ms.
const TRACER_POOL = 32;
const tracers = [];
{
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }),
    );
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
}
let tracerNext = 0;
function spawnTracer(from, to) {
  const t = tracers[tracerNext];
  tracerNext = (tracerNext + 1) % TRACER_POOL;
  const attr = t.line.geometry.getAttribute('position');
  attr.setXYZ(0, from.x, from.y, from.z);
  attr.setXYZ(1, to.x, to.y, to.z);
  attr.needsUpdate = true;
  t.line.visible = true;
  t.line.material.opacity = 0.85;
  t.life = 0.07;
}

// The bomb's own blast flash, separate from the grenade's.
const boomMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
);
boomMesh.visible = false;
scene.add(boomMesh);
const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 40);
scene.add(boomLight);
let boomLeft = 0;
let shakeLeft = 0;

const noise = [];
let elapsed = 0;
let started = false;
let frozen = false;
let spectating = null;
let prevFiring = false;
let frameEvents = [];

function addNoise(x, z, radius) {
  noise.push({ x, z, radius, time: elapsed });
  // Compact in place: drop anything older than two seconds.
  let write = 0;
  for (let i = 0; i < noise.length; i += 1) {
    if (elapsed - noise[i].time < 2) noise[write++] = noise[i];
  }
  noise.length = write;
}

function muzzleWorld() {
  muzzle.set(0.27, -0.22, -1.0);
  return camera.localToWorld(muzzle);
}

function shoot(spread) {
  if (!weapons.takeRound()) {
    audio.dryFire();
    return false;
  }
  const def = weapons.def();
  camera.getWorldDirection(direction);
  direction.x += (rng() * 2 - 1) * spread;
  direction.y += (rng() * 2 - 1) * spread;
  direction.z += (rng() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hits = raycaster.intersectObjects(shootTargets, false);
  const from = muzzleWorld();
  let end = null;
  for (const hit of hits) {
    const bot = hit.object.userData.bot;
    if (bot) {
      if (!bot.alive) continue; // corpses do not stop bullets
      const headshot = hit.object.userData.part === 'head';
      const died = bots.damage(bot, headshot ? def.damage * def.headMult : def.damage);
      hud.hitMarker(died, markerHoldMs);
      audio.hit(died);
      if (died) {
        hud.killfeed('YOU', bot.name, headshot);
        rounds.addKillReward();
        if (bot.isCarrier) rounds.dropBomb(bot.group.position);
        if (spectating === bot) spectating = null;
      }
      end = hit.point;
      break;
    }
    end = hit.point;
    break;
  }
  if (!end) end = tmpVec.copy(camera.position).addScaledVector(direction, 60);
  spawnTracer(from, end);
  weapons.pullTrigger();
  player.recoil(def.kick * (0.85 + rng() * 0.3), (rng() * 2 - 1) * def.kick * 0.4);
  addNoise(body.position.x, body.position.z, 30);
  audio.shot(def.id);
  hud.setAmmo(weapons.state.mag[weapons.state.current], weapons.state.reserve[weapons.state.current], def.name);
  return true;
}

function handlePlayerDeath(killerName) {
  if (rounds.state.bomb.carrier === 'player') rounds.dropBomb(body.position);
  hud.killfeed(killerName, 'YOU', false);
  hud.hidePlant();
  hud.hideBuy();
  const allies = bots.list.filter((b) => b.team === 'ember' && b.alive);
  spectating = allies.length > 0 ? allies[Math.floor(rng() * allies.length)] : null;
  hud.showSpectate(spectating ? spectating.name : 'no one');
  input.releaseLock();
}

function damagePlayer(amount, killerName) {
  if (!body.alive) return false;
  const died = player.damage(amount);
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(body.health, body.armour);
  if (died) handlePlayerDeath(killerName);
  return died;
}

function onBotKill(victim, killerName, headshot) {
  hud.killfeed(killerName, victim.name, headshot);
  if (victim.isCarrier) rounds.dropBomb(victim.group.position);
  if (spectating === victim) spectating = null;
}

function blastDamage(pos, radius, maxDamage, minDamage) {
  for (const bot of bots.list) {
    if (!bot.alive || bot.team === 'ember') continue;
    const bp = bot.group.position;
    const d = Math.hypot(bp.x - pos.x, bp.z - pos.z);
    if (d > radius) continue;
    const amount = Math.round(minDamage + (maxDamage - minDamage) * (1 - d / radius));
    const died = bots.damage(bot, amount);
    if (died) {
      hud.killfeed('YOU', `${bot.name} 💥`, false);
      rounds.addKillReward();
      if (bot.isCarrier) rounds.dropBomb(bp);
    }
  }
  const d = Math.hypot(body.position.x - pos.x, body.position.z - pos.z);
  if (body.alive && d < radius) {
    damagePlayer(Math.round(minDamage + (maxDamage - minDamage) * (1 - d / radius)), 'FRAG');
  }
  audio.explosion();
  shakeLeft = 0.4;
}

const botCtx = {
  phase: 'buy',
  time: 0,
  player: body,
  playerHitMeshes: player.hitMeshes,
  bomb: rounds.state.bomb,
  noise,
  spawnTracer,
  botShot(bot) {
    audio.distantShot();
    addNoise(bot.group.position.x, bot.group.position.z, 30);
  },
  damagePlayer,
  onKill: onBotKill,
  onPickup(bot) {
    rounds.pickupBomb(bot);
    hud.toast(`${bot.name} picked up the charge`);
  },
  plantTick(bot, dt) {
    return rounds.botPlantTick(bot, dt, frameEvents);
  },
  defuseTick(bot, dt) {
    return rounds.botDefuseTick(bot, dt, frameEvents);
  },
};

function resetRoundPositions() {
  player.reset(world.spawns.attack[0]);
  bots.reset();
  weapons.refill();
  grenades.reset();
  spectating = null;
  hud.hideSpectate();
  hud.hideBanner();
  hud.hidePlant();
  noise.length = 0;
  for (const t of tracers) {
    t.line.visible = false;
    t.life = 0;
  }
}

function handleEvents(events) {
  for (const event of events) {
    if (event.type === 'live') {
      hud.hideBuy();
      hud.toast(`Round ${event.round} — go`);
    } else if (event.type === 'roundStart') {
      resetRoundPositions();
      hud.showBuy(rounds.state.round);
      hud.setBuyOwned(weapons.state.owned, weapons.state.grenades, body.armour);
      hud.setMoney(rounds.state.money);
      if (!input.state.locked && started) hud.showOverlay('paused');
    } else if (event.type === 'roundEnd') {
      hud.hideBuy();
      hud.hidePlant();
      const won = event.winner === 'ember';
      const reasons = {
        elimination: 'Enemy team eliminated',
        bomb: 'The charge detonated',
        defused: 'The charge was defused',
        time: 'Time expired — the site held',
        'defence-wiped': 'No defender left to cut the fuse',
      };
      hud.banner(won ? 'EMBER WINS' : 'ASH WINS', reasons[event.reason] || '');
      if (won) audio.roundWin();
      else audio.roundLose();
    } else if (event.type === 'planted') {
      hud.toast(event.by === 'player' ? 'Charge planted — defend the pad' : `${event.by} planted the charge`);
      audio.plant();
    } else if (event.type === 'defused') {
      hud.toast(`${event.by} defused the charge`);
    } else if (event.type === 'exploded') {
      const pos = rounds.state.bomb.pos;
      boomMesh.visible = true;
      boomMesh.position.set(pos.x, 1, pos.z);
      boomMesh.scale.setScalar(1);
      boomLight.position.set(pos.x, 2, pos.z);
      boomLight.intensity = 120;
      boomLeft = 0.7;
      shakeLeft = 0.6;
      audio.explosion();
    } else if (event.type === 'beep') {
      audio.beep(event.urgent);
    } else if (event.type === 'matchEnd') {
      const won = event.winner === 'ember';
      const s = rounds.state.scores;
      hud.showOverlay('match', won ? `EMBER takes the match ${s.ember}–${s.ash}. The refinery is yours.` : `ASH takes the match ${s.ash}–${s.ember}. Run it back.`);
      input.releaseLock();
    }
  }
}

function syncCamera() {
  if (!body.alive && spectating) {
    const p = spectating.group.position;
    camera.position.set(p.x, p.y + 1.55, p.z);
    camera.rotation.set(0, spectating.yaw, 0, 'YXZ');
    return;
  }
  let sx = 0;
  let sy = 0;
  if (shakeLeft > 0) {
    sx = (Math.random() * 2 - 1) * 0.02 * shakeLeft;
    sy = (Math.random() * 2 - 1) * 0.02 * shakeLeft;
  }
  camera.position.set(body.position.x + sx, body.position.y + body.eye + sy, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function syncHud() {
  const rs = rounds.state;
  const planted = rs.bomb.state === 'planted';
  hud.setTimer(planted ? rs.bomb.fuse : rs.timer, rs.phase, planted ? rs.bomb.fuse : null);
  hud.setScore(rs.scores.ember, rs.scores.ash, rs.round);
  hud.setMoney(rs.money);
  hud.setHealth(body.health, body.armour);
  hud.setAmmo(weapons.state.mag[weapons.state.current], weapons.state.reserve[weapons.state.current], weapons.def().name);
  const team = [{ name: 'YOU', hp: body.health, alive: body.alive, isPlayer: true }];
  for (const bot of bots.list) {
    if (bot.team === 'ember') team.push({ name: bot.name, hp: bot.health, alive: bot.alive, isPlayer: false });
  }
  hud.setTeamList(team);
  const bomb = rs.bomb;
  if (bomb.state === 'carried' && bomb.carrier === 'player') {
    hud.setBombChip('CARRYING THE CHARGE — HOLD E AT THE REACTOR');
  } else if (bomb.state === 'carried' && bomb.carrier) {
    hud.setBombChip(`${bomb.carrier.name} HAS THE CHARGE`);
  } else if (bomb.state === 'dropped') {
    hud.setBombChip('CHARGE DROPPED — RECOVER IT');
  } else {
    hud.setBombChip(null);
  }
}

function step(dt) {
  elapsed += dt;
  frameEvents = [];
  const rs = rounds.state;
  const frozenPhase = rs.phase !== 'live';
  const aiming = input.state.aiming && body.alive;

  const look = input.takeLook();
  if (body.alive) player.look(look.x, look.y);

  if (body.alive && rs.phase === 'live' && input.state.firing && weapons.ready()) {
    const def = weapons.def();
    if (def.auto || !prevFiring) shoot(weapons.spread(player.groundSpeed(), aiming));
  }
  prevFiring = input.state.firing;
  if (body.alive && input.state.keys.has('KeyR') && weapons.reload()) audio.reload();

  player.step(dt, input.state.keys, frozenPhase || !body.alive, aiming);
  weapons.step(dt);
  grenades.step(dt, blastDamage);

  // Planting: hold E, stand still, stay in the site.
  if (body.alive && rs.phase === 'live' && rs.bomb.state === 'carried' && rs.bomb.carrier === 'player') {
    const moving = player.groundSpeed() > 0.5;
    if (input.state.keys.has('KeyE')) {
      const progress = rounds.playerPlantTick(dt, body.position, moving, frameEvents);
      if (progress > 0) hud.showPlant(progress, 'PLANTING THE CHARGE…');
      else hud.hidePlant();
    } else if (rs.bomb.plantProgress > 0) {
      rounds.playerPlantTick(dt, body.position, true, frameEvents);
      hud.hidePlant();
    }
  }

  botCtx.phase = rs.phase;
  botCtx.time = elapsed;
  bots.stepAll(dt, botCtx, elapsed);

  const counts = {
    emberAlive: bots.aliveCount('ember'),
    ashAlive: bots.aliveCount('ash'),
    playerAlive: body.alive,
  };
  frameEvents.push(...rounds.update(dt, counts));
  handleEvents(frameEvents);

  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) t.line.visible = false;
    }
  }
  if (boomLeft > 0) {
    boomLeft = Math.max(0, boomLeft - dt);
    const t = boomLeft / 0.7;
    boomMesh.scale.setScalar(1 + (1 - t) * 14);
    boomMesh.material.opacity = t * 0.9;
    boomLight.intensity = 120 * t;
    if (boomLeft === 0) boomMesh.visible = false;
  }
  if (shakeLeft > 0) shakeLeft = Math.max(0, shakeLeft - dt);

  const targetFov = aiming ? AIM_FOV : BASE_FOV;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  hud.setCrosshairSpread(weapons.spread(player.groundSpeed(), aiming));
  syncCamera();
  syncHud();
}

let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    // Locking hides the overlay only: the buy menu stays up during the buy phase
    // so its number keys keep working while the pointer is captured.
    hud.hideOverlay();
  } else if (started && body.alive && rounds.state.phase !== 'match') {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (!started || rounds.state.phase === 'match') {
    started = true;
    rounds.startMatch();
    resetRoundPositions();
    hud.showBuy(rounds.state.round);
    hud.setBuyOwned(weapons.state.owned, weapons.state.grenades, body.armour);
  }
  hud.hideOverlay();
  input.requestLock();
});

hud.onBuy((id) => {
  const result = rounds.buy(id, weapons, player);
  if (result.ok) {
    audio.buy();
    hud.setBuyOwned(weapons.state.owned, weapons.state.grenades, body.armour);
    hud.setMoney(rounds.state.money);
    hud.setAmmo(weapons.state.mag[weapons.state.current], weapons.state.reserve[weapons.state.current], weapons.def().name);
  } else {
    hud.toast(result.reason);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.repeat || shot) return;
  const buyOpen = hud.buyOpen();
  if (event.code === 'KeyB' && rounds.state.phase === 'buy' && body.alive) {
    if (buyOpen) {
      hud.hideBuy();
      input.requestLock();
    } else {
      hud.showBuy(rounds.state.round);
      hud.setBuyOwned(weapons.state.owned, weapons.state.grenades, body.armour);
      input.releaseLock();
    }
    return;
  }
  if (event.code === 'KeyM') {
    const muted = audio.toggleMute();
    hud.toast(muted ? 'Sound muted' : 'Sound on');
    return;
  }
  if (event.code === 'KeyG' && body.alive && rounds.state.phase === 'live') {
    if (weapons.state.grenades > 0 && grenades.throw(muzzleWorld(), camera.getWorldDirection(direction), player.groundSpeed())) {
      weapons.state.grenades -= 1;
    } else if (weapons.state.grenades === 0) {
      hud.toast('No grenades — buy one next round (B)');
    }
    return;
  }
  if (buyOpen && rounds.state.phase === 'buy') {
    const buyKeys = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'grenade', Digit4: 'armour' };
    if (buyKeys[event.code]) {
      const result = rounds.buy(buyKeys[event.code], weapons, player);
      if (result.ok) {
        audio.buy();
        hud.setBuyOwned(weapons.state.owned, weapons.state.grenades, body.armour);
        hud.setMoney(rounds.state.money);
      } else {
        hud.toast(result.reason);
      }
    }
    return;
  }
  const switchKeys = { Digit1: 'pistol', Digit2: 'rifle', Digit3: 'smg' };
  if (switchKeys[event.code] && body.alive) {
    if (weapons.switchTo(switchKeys[event.code])) {
      hud.setAmmo(weapons.state.mag[weapons.state.current], weapons.state.reserve[weapons.state.current], weapons.def().name);
    }
  }
});

// --- Deterministic screenshot frames (?shot=name&seed=N) ---------------------
function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function settleShot(steps) {
  for (let i = 0; i < steps; i += 1) {
    player.step(FIXED_STEP, input.state.keys, true, false);
    weapons.step(FIXED_STEP);
  }
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  hud.hideBanner();
  rounds.startMatch();
  resetRoundPositions();
  // The loadout the action shots share: rifle in hand, armour on. The buy shot
  // keeps the starting pistol so the shop shows everything still to buy.
  if (name !== 'buy') {
    weapons.acquire('rifle');
    body.armour = 50;
  }
  const rs = rounds.state;

  if (name === 'combat') {
    rs.phase = 'live';
    rs.timer = 83;
    rs.round = 3;
    rs.scores.ember = 2;
    rs.scores.ash = 1;
    rs.money = 3200;
    body.position.set(0, 0, 4);
    bots.placeForShot([
      { name: 'WREN', x: 2, z: -8, yaw: Math.PI, alive: true },
      { name: 'SABLE', x: -2, z: -11, yaw: Math.PI, alive: true },
      { name: 'JUNO', x: -3.5, z: 0, yaw: 0, alive: true },
      { name: 'KITE', x: 3, z: 0, yaw: 0, alive: true },
      { name: 'MOTH', x: 4.5, z: -3, yaw: Math.PI, alive: false },
    ]);
    settleShot(10);
    // Four aimed rounds drop WREN: kill hitmarker, killfeed, tracer, flash.
    for (let round = 0; round < 4; round += 1) {
      aimAt(new THREE.Vector3(2, 1.1, -8));
      shoot(0);
      settleShot(2);
    }
    // The fall animation runs in the bot step, which shot mode never calls, so lay
    // the body down directly: a standing corpse would give the kill away.
    bots.placeForShot([{ name: 'WREN', x: 2, z: -8, yaw: Math.PI, alive: false }]);
  } else if (name === 'push') {
    rs.phase = 'live';
    rs.timer = 95;
    rs.round = 1;
    rs.money = 800;
    body.position.set(0, 0, 12);
    body.yaw = 0;
    body.pitch = 0;
    bots.placeForShot([
      { name: 'VEX', x: -3, z: 8.5, yaw: 0, alive: true },
      { name: 'JUNO', x: 3.5, z: 4, yaw: 0, alive: true },
      { name: 'KITE', x: 0.5, z: 8, yaw: 0, alive: true },
      { name: 'PIKE', x: 2.5, z: -10.5, yaw: Math.PI, alive: true },
      { name: 'DUNE', x: -1, z: -13, yaw: Math.PI, alive: true },
    ]);
    settleShot(10);
  } else if (name === 'site') {
    rs.phase = 'live';
    rs.timer = 60;
    rs.round = 2;
    rs.scores.ember = 1;
    rs.scores.ash = 1;
    rs.money = 2100;
    // Plant for real through the live mechanic, then step back for the view.
    // The camera sits on the pad centreline south of the site, so the two
    // site crates flank the frame instead of blocking the planted charge.
    body.position.set(0.5, 0, -17);
    const plantEvents = [];
    for (let i = 0; i < 8; i += 1) rounds.playerPlantTick(0.5, body.position, false, plantEvents);
    body.position.set(0, 0, -11);
    aimAt(new THREE.Vector3(0.5, 0.4, -17));
    bots.placeForShot([
      { name: 'SABLE', x: 5, z: -19.5, yaw: Math.PI * 0.8, alive: true },
      { name: 'VEX', x: -5, z: -14, yaw: Math.PI, alive: true },
      { name: 'DUNE', x: 2, z: -15, yaw: Math.PI, alive: false },
    ]);
    settleShot(10);
  } else {
    // buy: the spawn view with the shop open.
    rs.phase = 'buy';
    rs.timer = 9;
    rs.round = 2;
    rs.scores.ember = 1;
    rs.scores.ash = 0;
    rs.money = 4750;
    body.position.set(0, 0, 20);
    body.yaw = 0;
    body.pitch = 0;
    hud.showBuy(rs.round);
    hud.setBuyOwned(weapons.state.owned, weapons.state.grenades, body.armour);
    settleShot(10);
  }
  syncHud();
  hud.setCrosshairSpread(weapons.spread(0, false));
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

resetRoundPositions();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
