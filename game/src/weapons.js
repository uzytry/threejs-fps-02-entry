// The arsenal: three hitscan guns plus the rules that make accuracy pay. Spread
// grows with movement speed and shrinks to half while aiming, recoil kicks the view,
// and every gun runs dry — a magazine is a commitment. Each gun gets its own boxy
// view model on the camera, so the weapon on screen is the weapon in the hand.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// damage is the torso hit; a head hit multiplies it by headMult. price 0 is the
// starting sidearm. Bots shoot rifle numbers.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 30, headMult: 4,
    mag: 12, reserve: 48, fireGap: 0.22, reloadTime: 1.6,
    spreadStill: 0.0018, spreadMove: 0.02, kick: 0.011, auto: false,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Carbine', price: 2700, damage: 27, headMult: 4,
    mag: 30, reserve: 90, fireGap: 0.096, reloadTime: 2.0,
    spreadStill: 0.0022, spreadMove: 0.028, kick: 0.009, auto: true,
  },
  smg: {
    id: 'smg', name: 'Kestrel-9', price: 1400, damage: 21, headMult: 4,
    mag: 32, reserve: 96, fireGap: 0.07, reloadTime: 1.8,
    spreadStill: 0.004, spreadMove: 0.035, kick: 0.006, auto: true,
  },
};
export const GRENADE_PRICE = 300;
export const ARMOUR_PRICE = 650;
const MUZZLE_TIME = 0.06;
const MOVE_REFERENCE = 5.2;

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });
  const model = new THREE.Group();
  if (def.id === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.26), body);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), dark);
    frame.position.set(0, -0.05, 0.02);
    const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), grip);
    gripMesh.position.set(0, -0.11, 0.09);
    gripMesh.rotation.x = 0.25;
    model.add(slide, frame, gripMesh);
    model.position.set(0.24, -0.25, -0.5);
    model.userData.baseZ = -0.5;
  } else if (def.id === 'rifle') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), dark);
    mag.position.set(0, -0.12, -0.05);
    mag.rotation.x = 0.12;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), dark);
    sight.position.set(0, 0.075, -0.08);
    model.add(receiver, barrel, stock, mag, sight);
    model.position.set(0.27, -0.25, -0.55);
    model.userData.baseZ = -0.55;
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), grip);
    barrel.position.set(0, 0.02, -0.3);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.08), body);
    mag.position.set(0, -0.14, -0.02);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), grip);
    stock.position.set(0, -0.01, 0.26);
    model.add(receiver, barrel, mag, stock);
    model.position.set(0.25, -0.25, -0.52);
    model.userData.baseZ = -0.52;
  }
  // Smaller than life and angled a touch inward: a view model is a prop, not a
  // rifle held at arm's length, and at full scale it eats the bottom of the frame.
  model.scale.setScalar(0.75);
  model.rotation.y = -0.05;
  return model;
}

export function createWeapons(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }
  models.pistol.visible = true;

  // The muzzle flash is a canvas-drawn star, not a plain quad: a bright core with
  // four spikes, additively blended so it reads as light, not cardboard.
  function flashTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255, 240, 200, 1)');
    gradient.addColorStop(0.35, 'rgba(240, 168, 48, 0.9)');
    gradient.addColorStop(1, 'rgba(240, 168, 48, 0)');
    g.fillStyle = gradient;
    g.beginPath();
    g.moveTo(32, 2);
    g.lineTo(37, 27);
    g.lineTo(62, 32);
    g.lineTo(37, 37);
    g.lineTo(32, 62);
    g.lineTo(27, 37);
    g.lineTo(2, 32);
    g.lineTo(27, 27);
    g.closePath();
    g.fill();
    return new THREE.CanvasTexture(c);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.14, 0.14),
    new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  flash.position.set(0.27, -0.22, -1.0);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.27, -0.2, -0.8);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    owned: { pistol: true, rifle: false, smg: false },
    mag: { pistol: 12, rifle: 30, smg: 32 },
    reserve: { pistol: 48, rifle: 90, smg: 96 },
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
  };

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = model.userData.baseZ + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 40;
    flashLight.intensity = state.flash > 0 ? 14 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const d = def();
      model.rotation.x = -0.55 * Math.min(1, ((d.reloadTime - state.reloadLeft) / d.reloadTime) * 2);
      if (state.reloadLeft === 0) {
        const need = d.mag - state.mag[state.current];
        const take = Math.min(need, state.reserve[state.current]);
        state.mag[state.current] += take;
        state.reserve[state.current] -= take;
      }
    }
  }

  return {
    state,
    step,
    def,
    ready() {
      return state.mag[state.current] > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag[state.current] <= 0) return false;
      state.mag[state.current] -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag[state.current] === d.mag || state.reserve[state.current] === 0) return false;
      state.reloadLeft = d.reloadTime;
      return true;
    },
    // Standing still and aiming is the accurate way to shoot; running and gunning
    // sprays. This is the rule the whole gunfight balances on.
    spread(speed, aiming) {
      const d = def();
      const base = d.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * d.spreadMove;
      return aiming ? base * 0.5 : base;
    },
    switchTo(id) {
      if (!state.owned[id] || id === state.current || state.reloadLeft > 0) return false;
      models[state.current].visible = false;
      state.current = id;
      models[id].visible = true;
      state.cooldown = Math.max(state.cooldown, 0.25);
      return true;
    },
    acquire(id) {
      if (state.owned[id]) return false;
      state.owned[id] = true;
      state.mag[id] = WEAPONS[id].mag;
      state.reserve[id] = WEAPONS[id].reserve;
      this.switchTo(id);
      return true;
    },
    addGrenade() {
      if (state.grenades >= 2) return false;
      state.grenades += 1;
      return true;
    },
    refill() {
      for (const id of Object.keys(WEAPONS)) {
        state.mag[id] = WEAPONS[id].mag;
        state.reserve[id] = WEAPONS[id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
