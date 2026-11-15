// The bots: nine of them, four EMBER attackers beside the player and five ASH
// defenders. Each one is a small state machine — route, hold, engage, investigate,
// pickup, plant, defuse, retreat — walking the waypoint graph, seeing through a
// vision cone and a line-of-sight raycast, hearing gunshots, and shooting in bursts
// with a reaction delay and an aim error that shrinks the longer it tracks a target.
// Thinking is staggered (one bot every ~0.12 s) so nine brains cost one raycast
// batch per frame at most; movement and shooting reuse the world's shared mover.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { findPath, nearestNode } from './world.js';

const BOT_HEIGHT = 1.75;
const BOT_RADIUS = 0.36;
const EYE_HEIGHT = 1.55;
const WALK_SPEED = 4.4;
const STRAFE_SPEED = 2.3;
const SEE_RANGE = 30;
const SEE_RANGE_CROUCHED = 20;
const FOV_HALF = 0.96; // ~55 degrees either side of facing
const HEAR_RANGE = 30;
const BOT_DAMAGE = 27;
const BOT_HEAD_MULT = 4;
const THINK_EVERY = 0.12;

const ALLY_NAMES = ['VEX', 'JUNO', 'KITE', 'ORIN'];
const ALLY_LANES = ['west', 'mid', 'east', 'mid'];
const ENEMY_NAMES = ['MOTH', 'SABLE', 'WREN', 'PIKE', 'DUNE'];

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(bot, targetYaw, maxStep) {
  const d = angleDelta(bot.yaw, targetYaw);
  const step = Math.max(-maxStep, Math.min(maxStep, d));
  bot.yaw += step;
  bot.group.rotation.y = bot.yaw;
}

export function createBots(scene, world, rng) {
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.7, metalness: 0.2 });
  const inkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.05 });
  const visorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.3, metalness: 0.4 });
  const legGeo = new THREE.BoxGeometry(0.16, 0.75, 0.2);
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.BoxGeometry(0.28, 0.26, 0.28);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const ringGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 20);

  const bots = [];
  const hitMeshes = [];
  const shotRay = new THREE.Raycaster();
  shotRay.far = 90;
  const tmpDir = new THREE.Vector3();
  const tmpAim = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  const tmpChest = new THREE.Vector3();

  function buildBot(name, team) {
    const teamColor = team === 'ember' ? PALETTE.accent : PALETTE.rival;
    // The torso material is cloned per bot so a hit can flash it red alone.
    const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.55, metalness: 0.1, emissive: new THREE.Color(0x000000) });
    const group = new THREE.Group();

    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor), transparent: true, opacity: 0.35 }));
    ring.position.y = 0.02;
    group.add(ring);

    const legL = new THREE.Group();
    legL.position.set(-0.12, 0.78, 0);
    const legLMesh = new THREE.Mesh(legGeo, darkMat);
    legLMesh.position.y = -0.37;
    legL.add(legLMesh);
    const legR = new THREE.Group();
    legR.position.set(0.12, 0.78, 0);
    const legRMesh = new THREE.Mesh(legGeo, darkMat);
    legRMesh.position.y = -0.37;
    legR.add(legRMesh);

    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.14;
    const head = new THREE.Mesh(headGeo, inkMat);
    head.position.y = 1.62;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.03), visorMat);
    visor.position.set(0, 1.64, -0.14);
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.12, 1.25, -0.3);
    group.add(legL, legR, torso, head, visor, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);

    const bot = {
      name,
      team,
      group,
      torso,
      head,
      legL,
      legR,
      torsoMat,
      // The shared mover works on `body.position`: point it at the group so the
      // bot collides through the same code path as the player.
      get position() {
        return group.position;
      },
      velocity: new THREE.Vector3(),
      height: BOT_HEIGHT,
      radius: BOT_RADIUS,
      onGround: true,
      yaw: 0,
      health: 100,
      alive: true,
      state: 'route',
      path: [],
      pathIdx: 0,
      lane: null,
      hold: null,
      resumeState: 'route',
      target: null,
      targetPos: new THREE.Vector3(),
      trackTime: 0,
      lastSeenAt: -99,
      reactionAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      strafeDir: 1,
      strafeAt: 0,
      engageAt: 0,
      pushUntil: 0,
      lastX: 0,
      lastZ: 0,
      lastMoveAt: 0,
      unstickUntil: 0,
      unstickDir: 1,
      investigatePos: new THREE.Vector3(),
      investigateUntil: 0,
      thinkAt: rng() * THINK_EVERY,
      walkPhase: 0,
      flash: 0,
      fall: 0,
      isCarrier: false,
      plantOnArrive: false,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    bot.hitMeshes = [torso, head];
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (const name of ALLY_NAMES) buildBot(name, 'ember');
  for (const name of ENEMY_NAMES) buildBot(name, 'ash');

  function posOf(bot) {
    return bot.group.position;
  }

  function setPath(bot, fromNode, toNode) {
    const path = findPath(fromNode, toNode);
    bot.path = path || [];
    bot.pathIdx = 0;
  }

  // The nearest living bot of a team to a point: one helper for the bomb
  // pickup (nearest attacker) and the defuse (nearest defender).
  function nearestLiving(team, x, z) {
    let nearest = null;
    let nearestD = Infinity;
    for (const ally of bots) {
      if (ally.team !== team || !ally.alive) continue;
      const ap = posOf(ally);
      const d = Math.hypot(x - ap.x, z - ap.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = ally;
      }
    }
    return nearest;
  }

  function walkPath(bot, dt, speed, time) {
    if (bot.pathIdx >= bot.path.length) return true;
    const node = world.waypoints.nodes[bot.path[bot.pathIdx]];
    const p = posOf(bot);
    const dx = node[0] - p.x;
    const dz = node[1] - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.8) {
      bot.pathIdx += 1;
      return bot.pathIdx >= bot.path.length;
    }
    // Stuck detection: the first leg of a path runs straight from wherever the
    // bot stands to the next node, and that line can cross a crate or a wall
    // (a bot strafed off the graph in a firefight, or the nearest node sits
    // across a wall). If the bot has barely moved in 1.2 s, sidestep around
    // the obstacle for a moment instead of pushing against it all round.
    if (bot.lastMoveAt === 0) {
      bot.lastX = p.x;
      bot.lastZ = p.z;
      bot.lastMoveAt = time;
    }
    if (Math.hypot(p.x - bot.lastX, p.z - bot.lastZ) > 0.3) {
      bot.lastX = p.x;
      bot.lastZ = p.z;
      bot.lastMoveAt = time;
    }
    let mx = dx / dist;
    let mz = dz / dist;
    if (time < bot.unstickUntil || time - bot.lastMoveAt > 1.2) {
      if (time >= bot.unstickUntil) {
        bot.unstickUntil = time + 0.8;
        bot.unstickDir = rng() < 0.5 ? -1 : 1;
      }
      const px = -mz * bot.unstickDir;
      const pz = mx * bot.unstickDir;
      mx = px;
      mz = pz;
    }
    const targetYaw = Math.atan2(-mx, -mz);
    turnToward(bot, targetYaw, dt * 6);
    bot.velocity.x = mx * speed;
    bot.velocity.z = mz * speed;
    bot.velocity.y -= 20 * dt;
    world.moveBody(bot, dt);
    bot.walkPhase += dt * speed * 1.6;
    return false;
  }

  function standStill(bot, dt) {
    bot.velocity.x = 0;
    bot.velocity.z = 0;
    bot.velocity.y -= 20 * dt;
    world.moveBody(bot, dt);
    bot.walkPhase *= 0.9;
  }

  function canSee(bot, targetPos, range) {
    const p = posOf(bot);
    const dx = targetPos.x - p.x;
    const dz = targetPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range) return false;
    const angle = Math.atan2(-dx, -dz);
    if (Math.abs(angleDelta(bot.yaw, angle)) > FOV_HALF) return false;
    tmpEye.set(p.x, p.y + EYE_HEIGHT, p.z);
    tmpChest.set(targetPos.x, targetPos.y + 1.1, targetPos.z);
    return world.hasLineOfSight(tmpEye, tmpChest);
  }

  function visibleEnemies(bot, ctx) {
    const found = [];
    const p = posOf(bot);
    if (ctx.player.alive) {
      const range = ctx.player.crouching ? SEE_RANGE_CROUCHED : SEE_RANGE;
      const pp = ctx.player.position;
      tmpChest.set(pp.x, pp.y, pp.z);
      if (canSee(bot, tmpChest, range)) {
        found.push({ kind: 'player', dist: Math.hypot(pp.x - p.x, pp.z - p.z), pos: pp });
      }
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const op = posOf(other);
      tmpChest.set(op.x, op.y, op.z);
      if (canSee(bot, tmpChest, SEE_RANGE)) {
        found.push({ kind: 'bot', bot: other, dist: Math.hypot(op.x - p.x, op.z - p.z), pos: op });
      }
    }
    found.sort((a, b) => a.dist - b.dist);
    return found;
  }

  function fireAt(bot, ctx, time) {
    const target = bot.target;
    const tp = target.kind === 'player' ? ctx.player.position : posOf(target.bot);
    // Aim error shrinks the longer the bot tracks, and grows while it strafes.
    const moving = Math.hypot(bot.velocity.x, bot.velocity.z) > 0.5;
    const error = Math.max(0.08, 0.42 - bot.trackTime * 0.15) + (moving ? 0.12 : 0);
    tmpAim.set(
      tp.x + (rng() * 2 - 1) * error,
      tp.y + 1.1 + (rng() * 2 - 1) * error,
      tp.z + (rng() * 2 - 1) * error,
    );
    const p = posOf(bot);
    tmpEye.set(p.x, p.y + EYE_HEIGHT, p.z);
    tmpDir.subVectors(tmpAim, tmpEye).normalize();
    shotRay.set(tmpEye, tmpDir);
    const targets = world.shootables.concat(hitMeshes, ctx.playerHitMeshes);
    const hit = shotRay.intersectObjects(targets, false)[0];
    const end = hit ? hit.point : tmpAim;
    ctx.spawnTracer(tmpEye, end);
    ctx.botShot(bot);
    if (!hit) return;
    const hitBot = hit.object.userData.bot;
    if (hitBot && hitBot.alive) {
      if (hitBot.team === bot.team) return; // no friendly fire
      const died = damage(hitBot, hit.object.userData.part === 'head' ? BOT_DAMAGE * BOT_HEAD_MULT : BOT_DAMAGE);
      if (died) ctx.onKill(hitBot, bot.name, hit.object.userData.part === 'head');
      return;
    }
    if (hit.object.userData.part && ctx.player.alive) {
      // The player's hit proxy carries a part but no bot.
      ctx.damagePlayer(hit.object.userData.part === 'head' ? BOT_DAMAGE * BOT_HEAD_MULT : BOT_DAMAGE, bot.name);
    }
  }

  function think(bot, ctx, time) {
    if (!bot.alive || ctx.phase !== 'live') return;
    const p = posOf(bot);

    // The designated defuser is the nearest living defender to a planted bomb.
    // It commits to the bomb: a visible enemy must not drag it into a
    // firefight, or the fuse burns out while everyone trades shots.
    const isDefuser =
      ctx.bomb.state === 'planted' &&
      bot.team === 'ash' &&
      nearestLiving('ash', ctx.bomb.pos.x, ctx.bomb.pos.z) === bot;

    // The bomb rewrites orders before anything else.
    if (ctx.bomb.state === 'planted') {
      if (bot.team === 'ash') {
        // One defender cuts the fuse — the nearest living one. The rest hold
        // and cover, so the defuser is not alone on the pad.
        if (isDefuser && bot.state !== 'defuse') {
          const bp = ctx.bomb.pos;
          if (Math.hypot(bp.x - p.x, bp.z - p.z) < 1.6) {
            bot.state = 'defuse';
          } else if (bot.state !== 'route' || bot.pathIdx >= bot.path.length) {
            setPath(bot, nearestNode(p.x, p.z), 14);
            bot.state = 'route';
            bot.plantOnArrive = false;
          }
        }
      } else if (bot.state !== 'engage' && bot.state !== 'retreat' && bot.state !== 'hold') {
        const spot = world.postPlantSpots[bots.indexOf(bot) % world.postPlantSpots.length];
        setPath(bot, nearestNode(p.x, p.z), nearestNode(spot.x, spot.z));
        bot.state = 'retreat';
      }
    } else if (ctx.bomb.state === 'dropped' && bot.team === 'ember') {
      // The nearest living attacker goes for the dropped bomb.
      if (nearestLiving('ember', ctx.bomb.pos.x, ctx.bomb.pos.z) === bot && bot.state !== 'pickup' && bot.state !== 'engage') {
        setPath(bot, nearestNode(p.x, p.z), nearestNode(ctx.bomb.pos.x, ctx.bomb.pos.z));
        bot.state = 'pickup';
      }
    }

    // An attacker stuck in a firefight stops pushing the objective: after eight
    // seconds of trading shots with no kill, break contact and advance toward
    // the site for four seconds instead of strafing in place for the round.
    if (bot.state === 'engage' && bot.team === 'ember' && bot.engageAt > 0 && time - bot.engageAt > 8) {
      bot.target = null;
      bot.trackTime = 0;
      bot.engageAt = 0;
      bot.pushUntil = time + 4;
      setPath(bot, nearestNode(p.x, p.z), 14);
      bot.state = 'route';
    }

    // Vision: the nearest visible enemy becomes the target — unless the bot is
    // in a push window, when it keeps its feet moving toward the site, or is
    // the designated defuser, when the bomb outranks the firefight.
    const seen = visibleEnemies(bot, ctx);
    if (seen.length > 0 && time >= bot.pushUntil && !isDefuser) {
      const first = seen[0];
      const isNew = !bot.target || bot.target.kind !== first.kind || (first.kind === 'bot' && bot.target.bot !== first.bot);
      bot.target = first.kind === 'player' ? { kind: 'player' } : { kind: 'bot', bot: first.bot };
      bot.targetPos.copy(first.pos);
      bot.lastSeenAt = time;
      if (isNew) {
        bot.trackTime = 0;
        bot.reactionAt = time + 0.25 + rng() * 0.35;
        bot.burstLeft = 0;
      }
      if (bot.state !== 'plant' && bot.state !== 'defuse') {
        if (bot.state !== 'engage') bot.engageAt = time;
        bot.state = 'engage';
      }
      return;
    }
    // Lost sight: keep hunting the last known spot briefly, then give up.
    if (bot.target && time - bot.lastSeenAt > 2.5) {
      bot.target = null;
      bot.trackTime = 0;
      if (bot.state === 'engage') {
        bot.investigatePos.copy(bot.targetPos);
        bot.investigateUntil = time + 1.5;
        setPath(bot, nearestNode(p.x, p.z), nearestNode(bot.targetPos.x, bot.targetPos.z));
        bot.resumeState = bot.team === 'ash' ? 'hold' : 'route';
        bot.state = 'investigate';
      }
    }

    // Hearing: a fresh gunshot inside range, with nothing in sight, is worth a look.
    if (!bot.target && (bot.state === 'route' || bot.state === 'hold') && time >= bot.pushUntil) {
      for (let i = ctx.noise.length - 1; i >= 0; i -= 1) {
        const n = ctx.noise[i];
        if (time - n.time > 1.2) continue;
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < n.radius) {
          bot.investigatePos.set(n.x, 0, n.z);
          bot.investigateUntil = time + 1.5;
          setPath(bot, nearestNode(p.x, p.z), nearestNode(n.x, n.z));
          bot.resumeState = bot.state;
          bot.state = 'investigate';
          break;
        }
      }
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.flash = 0.12;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.health = 0;
    bot.state = 'dead';
    bot.fall = 0;
    bot.target = null;
    return true;
  }

  function step(bot, ctx, dt, time) {
    if (!bot.alive) {
      // Death: fall over and stay down until the round resets.
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    if (bot.flash > 0) {
      bot.flash = Math.max(0, bot.flash - dt);
      bot.torsoMat.emissive.setRGB(bot.flash > 0 ? 0.55 : 0, 0, 0);
    }
    if (time >= bot.thinkAt) {
      bot.thinkAt = time + THINK_EVERY;
      think(bot, ctx, time);
    }
    if (ctx.phase !== 'live') {
      standStill(bot, dt);
      return;
    }

    const p = posOf(bot);
    switch (bot.state) {
      case 'route': {
        const arrived = walkPath(bot, dt, WALK_SPEED, time);
        if (arrived) {
          if (bot.isCarrier && bot.plantOnArrive) {
            bot.state = 'plant';
          } else if (ctx.bomb.state === 'planted' && bot.team === 'ash' && nearestLiving('ash', ctx.bomb.pos.x, ctx.bomb.pos.z) === bot) {
            bot.state = 'defuse';
          } else if (bot.team === 'ash' && bot.hold) {
            bot.state = 'hold';
          } else {
            bot.state = 'hold';
          }
        }
        break;
      }
      case 'hold': {
        standStill(bot, dt);
        const baseYaw = bot.hold ? bot.hold.yaw : Math.PI;
        const scan = Math.sin(time * 0.5 + bots.indexOf(bot) * 1.7) * 0.45;
        turnToward(bot, baseYaw + scan, dt * 1.5);
        break;
      }
      case 'investigate': {
        const arrived = walkPath(bot, dt, WALK_SPEED, time);
        if (arrived) {
          turnToward(bot, bot.yaw + dt * 1.2, dt * 1.2);
          if (time > bot.investigateUntil) {
            bot.state = bot.resumeState;
            if (bot.state === 'route' && bot.pathIdx >= bot.path.length) {
              // Resume the lane: repath to the site or the hold spot.
              if (bot.team === 'ember') setPath(bot, nearestNode(p.x, p.z), 14);
              else if (bot.hold) setPath(bot, nearestNode(p.x, p.z), bot.hold.node);
            }
          }
        }
        break;
      }
      case 'pickup': {
        const bp = ctx.bomb.pos;
        const d = Math.hypot(bp.x - p.x, bp.z - p.z);
        if (d < 1.2) {
          ctx.onPickup(bot);
          bot.isCarrier = true;
          bot.plantOnArrive = true;
          setPath(bot, nearestNode(p.x, p.z), 14);
          bot.state = 'route';
        } else if (bot.pathIdx >= bot.path.length) {
          // Close the last metres on foot: the bomb may sit between waypoints.
          const targetYaw = Math.atan2(-(bp.x - p.x), -(bp.z - p.z));
          turnToward(bot, targetYaw, dt * 6);
          bot.velocity.x = ((bp.x - p.x) / d) * WALK_SPEED;
          bot.velocity.z = ((bp.z - p.z) / d) * WALK_SPEED;
          bot.velocity.y -= 20 * dt;
          world.moveBody(bot, dt);
          bot.walkPhase += dt * WALK_SPEED * 1.6;
        } else {
          walkPath(bot, dt, WALK_SPEED, time);
        }
        break;
      }
      case 'plant': {
        standStill(bot, dt);
        turnToward(bot, Math.atan2(-(world.site.center.x - p.x), -(world.site.center.z - p.z)), dt * 4);
        ctx.plantTick(bot, dt);
        break;
      }
      case 'defuse': {
        // Close the last metres on foot first; the pad is open ground.
        const bp = ctx.bomb.pos;
        const d = Math.hypot(bp.x - p.x, bp.z - p.z);
        if (d > 1.6) {
          const targetYaw = Math.atan2(-(bp.x - p.x), -(bp.z - p.z));
          turnToward(bot, targetYaw, dt * 6);
          bot.velocity.x = ((bp.x - p.x) / d) * WALK_SPEED;
          bot.velocity.z = ((bp.z - p.z) / d) * WALK_SPEED;
          bot.velocity.y -= 20 * dt;
          world.moveBody(bot, dt);
          bot.walkPhase += dt * WALK_SPEED * 1.6;
        } else {
          standStill(bot, dt);
          ctx.defuseTick(bot, dt);
        }
        break;
      }
      case 'retreat': {
        const arrived = walkPath(bot, dt, WALK_SPEED, time);
        if (arrived) bot.state = 'hold';
        break;
      }
      case 'engage': {
        if (bot.target) {
          const tp = bot.target.kind === 'player' ? ctx.player.position : posOf(bot.target.bot);
          bot.targetPos.copy(tp);
          bot.trackTime += dt;
          turnToward(bot, Math.atan2(-(tp.x - p.x), -(tp.z - p.z)), dt * 7);
          // Strafe: sidestep, switching direction every second or so.
          if (time >= bot.strafeAt) {
            bot.strafeAt = time + 0.7 + rng() * 0.7;
            bot.strafeDir = rng() < 0.5 ? -1 : 1;
          }
          const sin = Math.sin(bot.yaw);
          const cos = Math.cos(bot.yaw);
          bot.velocity.x = cos * bot.strafeDir * STRAFE_SPEED;
          bot.velocity.z = -sin * bot.strafeDir * STRAFE_SPEED;
          bot.velocity.y -= 20 * dt;
          world.moveBody(bot, dt);
          bot.walkPhase += dt * STRAFE_SPEED * 1.6;
          if (time >= bot.reactionAt && time >= bot.nextShotAt) {
            if (bot.burstLeft === 0) {
              bot.burstLeft = 3 + Math.floor(rng() * 3);
            }
            fireAt(bot, ctx, time);
            bot.burstLeft -= 1;
            bot.nextShotAt = time + (bot.burstLeft > 0 ? 0.11 : 0.5 + rng() * 0.5);
          }
        } else {
          standStill(bot, dt);
        }
        break;
      }
      default:
        standStill(bot, dt);
    }

    // Legs swing with the walk cycle; the gun stays level.
    const swing = Math.sin(bot.walkPhase) * 0.5;
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
  }

  return {
    list: bots,
    hitMeshes,
    damage,
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },
    reset() {
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        const spawn = bot.team === 'ember'
          ? world.spawns.attack[i + 1]
          : world.spawns.defend[i - ALLY_NAMES.length];
        const p = posOf(bot);
        p.set(spawn.x, 0, spawn.z);
        bot.group.rotation.set(0, bot.team === 'ember' ? 0 : Math.PI, 0);
        bot.yaw = bot.team === 'ember' ? 0 : Math.PI;
        bot.velocity.set(0, 0, 0);
        bot.health = 100;
        bot.alive = true;
        bot.fall = 0;
        bot.flash = 0;
        bot.torsoMat.emissive.setRGB(0, 0, 0);
        bot.target = null;
        bot.trackTime = 0;
        bot.burstLeft = 0;
        bot.nextShotAt = 0;
        bot.engageAt = 0;
        bot.pushUntil = 0;
        bot.lastX = spawn.x;
        bot.lastZ = spawn.z;
        bot.lastMoveAt = 0;
        bot.unstickUntil = 0;
        bot.isCarrier = false;
        bot.plantOnArrive = false;
        if (bot.team === 'ember') {
          const laneIndex = ALLY_NAMES.indexOf(bot.name);
          bot.lane = ALLY_LANES[laneIndex];
          bot.hold = null;
          bot.path = world.waypoints.lanes[bot.lane].slice();
          bot.pathIdx = 0;
          bot.state = 'route';
        } else {
          const holdIndex = ENEMY_NAMES.indexOf(bot.name);
          bot.hold = world.holdSpots[holdIndex];
          bot.lane = null;
          setPath(bot, nearestNode(spawn.x, spawn.z), bot.hold.node);
          bot.state = 'route';
        }
      }
    },
    stepAll(dt, ctx, time) {
      for (const bot of bots) step(bot, ctx, dt, time);
    },
    placeForShot(placements) {
      for (const place of placements) {
        const bot = bots.find((b) => b.name === place.name);
        if (!bot) continue;
        const p = posOf(bot);
        p.set(place.x, 0, place.z);
        bot.yaw = place.yaw;
        bot.group.rotation.set(0, place.yaw, 0);
        bot.alive = place.alive !== false;
        bot.health = bot.alive ? 100 : 0;
        bot.state = bot.alive ? 'hold' : 'dead';
        if (!bot.alive) {
          bot.fall = 1;
          bot.group.rotation.x = -1.45;
          bot.group.position.y = -0.08;
        }
      }
    },
  };
}
