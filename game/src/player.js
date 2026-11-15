// The player body: acceleration, friction, gravity, crouch and jump, resolved by
// the world's shared mover, so the player and the bots collide the same way. Health
// and armour live here too: armour absorbs half of every hit. The hit proxy is a pair
// of invisible meshes the bots' raycasts can strike — the first-person camera has no
// visible body of its own, so without it nothing could ever shoot the player.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const AIM_SPEED = 3.1;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(scene, world) {
  const state = {
    position: new THREE.Vector3(0, 0, 21.5),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    radius: RADIUS,
    health: 100,
    armour: 0,
    alive: true,
  };
  const wish = new THREE.Vector3();

  // Invisible but raycastable: opacity 0 still intersects, visible = false would not.
  const ghost = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const proxy = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.82, 0.3), ghost);
  torso.position.y = 1.0;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), ghost);
  head.position.y = 1.56;
  head.userData.part = 'head';
  proxy.add(torso, head);
  scene.add(proxy);

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys, frozen, aiming) {
    if (!state.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if (!crouching && state.crouching) {
      // Stand up only when the head clears; otherwise stay crouched.
      if (!world.testBox(state.position.x, state.position.y, state.position.z, STAND_HEIGHT, RADIUS)) {
        state.crouching = false;
        state.height = STAND_HEIGHT;
      }
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    wish.set(0, 0, 0);
    if (!frozen) {
      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      if (forward || strafe) {
        const sin = Math.sin(state.yaw);
        const cos = Math.cos(state.yaw);
        wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
      }
    }

    const speed = state.crouching ? CROUCH_SPEED : aiming ? AIM_SPEED : WALK_SPEED;
    const blend = Math.min(1, ((state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }

    if (!frozen && keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;
    state.velocity.y = Math.max(-30, state.velocity.y);
    world.moveBody(state, dt);
    proxy.position.copy(state.position);
  }

  return {
    state,
    hitMeshes: [torso, head],
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    // Armour absorbs half the damage, spending one armour point per two damage.
    damage(amount) {
      if (!state.alive) return false;
      let rest = amount;
      if (state.armour > 0) {
        const absorbed = Math.min(state.armour, Math.ceil(rest / 2));
        state.armour -= absorbed;
        rest -= absorbed;
      }
      state.health -= rest;
      if (state.health <= 0) {
        state.health = 0;
        state.alive = false;
        proxy.position.set(0, -50, 0);
        return true;
      }
      return false;
    },
    reset(spawn) {
      state.position.set(spawn.x, 0, spawn.z);
      state.velocity.set(0, 0, 0);
      state.yaw = 0;
      state.pitch = 0;
      state.eye = STAND_EYE;
      state.crouching = false;
      state.height = STAND_HEIGHT;
      state.health = 100;
      state.alive = true;
      state.onGround = true;
      proxy.position.copy(state.position);
    },
  };
}
