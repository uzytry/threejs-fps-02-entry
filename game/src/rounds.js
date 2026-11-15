// Rounds, money and the bomb. One state machine drives the match: BUY (12 s,
// frozen, shop open) -> LIVE (100 s) -> END (4 s banner) -> next round, first to
// five. The bomb is carried by the player, drops where its carrier dies, gets picked
// up by the nearest living attacker bot, plants in 3.5 s at the Reactor pad and
// burns a 40-second fuse a defender can cut in 5 s. Every transition comes back as
// an event; main.js turns events into HUD, sound and light.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, GRENADE_PRICE, ARMOUR_PRICE } from './weapons.js';

const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const END_SECONDS = 4;
const PLANT_SECONDS = 3.5;
const DEFUSE_SECONDS = 5;
const FUSE_SECONDS = 40;
const ROUNDS_TO_WIN = 5;
const START_MONEY = 800;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1400;

export function createRounds(world, scene) {
  // The bomb prop: a dark case with an amber stripe and a red lamp that blinks
  // faster as the fuse burns down. Hidden while carried.
  const prop = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.4 }),
  );
  caseMesh.position.y = 0.1;
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.05, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  stripe.position.y = 0.12;
  const lamp = new THREE.PointLight(new THREE.Color(PALETTE.danger), 0, 8);
  lamp.position.y = 0.4;
  const lampMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) }),
  );
  lampMesh.position.y = 0.26;
  prop.add(caseMesh, stripe, lamp, lampMesh);
  prop.visible = false;
  scene.add(prop);

  const state = {
    phase: 'buy',
    round: 1,
    scores: { ember: 0, ash: 0 },
    money: START_MONEY,
    timer: BUY_SECONDS,
    bomb: {
      state: 'carried', // carried | dropped | planted | exploded | defused
      carrier: 'player', // 'player' | bot | null
      pos: new THREE.Vector3(0, 0, 21.5),
      plantProgress: 0,
      defuseProgress: 0,
      fuse: FUSE_SECONDS,
      planter: null,
      defuser: null,
    },
  };
  let clock = 0;
  let lastBeep = 0;

  function inSite(x, z) {
    const s = world.site;
    return x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ;
  }

  function resetBomb() {
    const b = state.bomb;
    b.state = 'carried';
    b.carrier = 'player';
    b.plantProgress = 0;
    b.defuseProgress = 0;
    b.fuse = FUSE_SECONDS;
    b.planter = null;
    b.defuser = null;
    prop.visible = false;
    lamp.intensity = 0;
  }

  function endRound(events, winner, reason) {
    state.scores[winner] += 1;
    state.money += winner === 'ember' ? WIN_REWARD : LOSS_REWARD;
    state.phase = 'end';
    state.timer = END_SECONDS;
    events.push({ type: 'roundEnd', winner, reason, round: state.round });
  }

  function plantAt(events, pos, by) {
    const b = state.bomb;
    b.state = 'planted';
    b.pos.copy(pos);
    b.pos.y = 0;
    b.fuse = FUSE_SECONDS;
    b.plantProgress = 0;
    b.planter = null;
    b.carrier = null;
    prop.visible = true;
    prop.position.copy(b.pos);
    lastBeep = 0;
    events.push({ type: 'planted', by });
  }

  return {
    state,
    inSite,
    startMatch() {
      state.round = 1;
      state.scores.ember = 0;
      state.scores.ash = 0;
      state.money = START_MONEY;
      this.startRound();
    },
    startRound() {
      state.phase = 'buy';
      state.timer = BUY_SECONDS;
      resetBomb();
    },
    addKillReward() {
      state.money += KILL_REWARD;
    },
    buy(id, weapons, player) {
      if (state.phase !== 'buy') return { ok: false, reason: 'Shop is closed' };
      if (id === 'grenade') {
        if (state.money < GRENADE_PRICE) return { ok: false, reason: 'Not enough money' };
        if (!weapons.addGrenade()) return { ok: false, reason: 'Carrying two already' };
        state.money -= GRENADE_PRICE;
        return { ok: true };
      }
      if (id === 'armour') {
        if (player.state.armour >= 100) return { ok: false, reason: 'Armour is full' };
        if (state.money < ARMOUR_PRICE) return { ok: false, reason: 'Not enough money' };
        player.state.armour = 100;
        state.money -= ARMOUR_PRICE;
        return { ok: true };
      }
      const def = WEAPONS[id];
      if (!def) return { ok: false, reason: 'No such item' };
      if (weapons.state.owned[id]) return { ok: false, reason: 'Already owned' };
      if (state.money < def.price) return { ok: false, reason: 'Not enough money' };
      state.money -= def.price;
      weapons.acquire(id);
      return { ok: true };
    },
    dropBomb(pos) {
      const b = state.bomb;
      if (b.state !== 'carried') return;
      b.state = 'dropped';
      b.carrier = null;
      b.pos.copy(pos);
      b.pos.y = 0;
      b.plantProgress = 0;
      b.planter = null;
      prop.visible = true;
      prop.position.copy(b.pos);
    },
    pickupBomb(bot) {
      const b = state.bomb;
      if (b.state !== 'dropped') return;
      b.state = 'carried';
      b.carrier = bot;
      prop.visible = false;
    },
    // The player holds E in the site; moving cancels the channel.
    playerPlantTick(dt, playerPos, moving, events) {
      const b = state.bomb;
      if (b.state !== 'carried' || b.carrier !== 'player' || state.phase !== 'live') return 0;
      if (!inSite(playerPos.x, playerPos.z) || moving) {
        b.plantProgress = Math.max(0, b.plantProgress - dt / 1.5);
        return b.plantProgress;
      }
      b.plantProgress += dt / PLANT_SECONDS;
      if (b.plantProgress >= 1) plantAt(events, playerPos, 'player');
      return b.plantProgress;
    },
    botPlantTick(bot, dt, events) {
      const b = state.bomb;
      if (b.state !== 'carried' || b.carrier !== bot || state.phase !== 'live') return 0;
      const p = bot.group.position;
      if (!inSite(p.x, p.z)) return 0;
      b.plantProgress += dt / PLANT_SECONDS;
      if (b.plantProgress >= 1) plantAt(events, p, bot.name);
      return b.plantProgress;
    },
    botDefuseTick(bot, dt, events) {
      const b = state.bomb;
      if (b.state !== 'planted' || state.phase !== 'live') return 0;
      if (b.defuser && b.defuser !== bot) return b.defuseProgress;
      b.defuser = bot;
      b.defuseProgress += dt / DEFUSE_SECONDS;
      if (b.defuseProgress >= 1) {
        b.state = 'defused';
        b.defuseProgress = 0;
        prop.visible = false;
        lamp.intensity = 0;
        events.push({ type: 'defused', by: bot.name });
        endRound(events, 'ash', 'defused');
      }
      return b.defuseProgress;
    },
    update(dt, counts) {
      const events = [];
      clock += dt;
      const b = state.bomb;

      // A dead defuser drops the cut; the next defender starts over.
      if (b.defuser && !b.defuser.alive) {
        b.defuser = null;
        b.defuseProgress = 0;
      }

      if (state.phase === 'buy') {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.phase = 'live';
          state.timer = ROUND_SECONDS;
          events.push({ type: 'live', round: state.round });
        }
        return events;
      }

      if (state.phase === 'end') {
        state.timer -= dt;
        if (state.timer <= 0) {
          if (state.scores.ember >= ROUNDS_TO_WIN || state.scores.ash >= ROUNDS_TO_WIN) {
            state.phase = 'match';
            events.push({ type: 'matchEnd', winner: state.scores.ember >= ROUNDS_TO_WIN ? 'ember' : 'ash' });
          } else {
            state.round += 1;
            this.startRound();
            events.push({ type: 'roundStart', round: state.round });
          }
        }
        return events;
      }

      if (state.phase !== 'live') return events;

      if (b.state === 'planted') {
        b.fuse -= dt;
        // The beep quickens as the fuse burns: every second, then every half.
        const gap = b.fuse > 10 ? 1 : 0.5;
        if (clock - lastBeep >= gap) {
          lastBeep = clock;
          events.push({ type: 'beep', urgent: b.fuse <= 10 });
        }
        const blink = Math.sin(clock * (b.fuse > 10 ? 10 : 22)) > 0;
        lamp.intensity = blink ? 10 : 0.5;
        if (b.fuse <= 0) {
          b.state = 'exploded';
          prop.visible = false;
          lamp.intensity = 0;
          events.push({ type: 'exploded' });
          endRound(events, 'ember', 'bomb');
          return events;
        }
      } else {
        state.timer -= dt;
      }

      const emberAlive = counts.emberAlive + (counts.playerAlive ? 1 : 0);
      if (counts.ashAlive === 0) {
        endRound(events, 'ember', b.state === 'planted' ? 'defence-wiped' : 'elimination');
      } else if (emberAlive === 0) {
        if (b.state !== 'planted') endRound(events, 'ash', 'elimination');
        // Planted with no attacker left: the fuse still decides it.
      } else if (state.timer <= 0 && b.state !== 'planted') {
        endRound(events, 'ash', 'time');
      }
      return events;
    },
  };
}
