// Frag grenades: a thrown sphere with gravity, one damped bounce off the world,
// and a 1.5-second fuse. The blast hurts enemies and the thrower, never teammates,
// with damage falling off from 100 at the centre to 15 at the edge of the 6-metre
// radius. The visual is a flash sphere and a point light that decay together.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 14;
const FUSE = 1.5;
const RADIUS = 6;
const MAX_DAMAGE = 100;
const MIN_DAMAGE = 15;

export function createGrenades(scene, world) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.5 }),
  );
  mesh.visible = false;
  scene.add(mesh);

  const flashMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
  );
  flashMesh.visible = false;
  scene.add(flashMesh);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 14);
  scene.add(flashLight);

  const active = { flying: false, fuse: 0, bounced: false };
  const position = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const probe = new THREE.Box3();
  let flashLeft = 0;

  function throwGrenade(from, direction, throwerSpeed) {
    if (active.flying) return false;
    position.copy(from);
    velocity.copy(direction).multiplyScalar(14 + throwerSpeed * 0.4);
    velocity.y += 2.5;
    active.flying = true;
    active.fuse = FUSE;
    active.bounced = false;
    mesh.visible = true;
    mesh.position.copy(position);
    return true;
  }

  function explode(onBlast) {
    active.flying = false;
    mesh.visible = false;
    flashMesh.visible = true;
    flashMesh.position.copy(position);
    flashMesh.scale.setScalar(0.5);
    flashLight.position.copy(position);
    flashLight.intensity = 60;
    flashLeft = 0.35;
    onBlast(position, RADIUS, MAX_DAMAGE, MIN_DAMAGE);
  }

  function step(dt, onBlast) {
    if (flashLeft > 0) {
      flashLeft = Math.max(0, flashLeft - dt);
      const t = flashLeft / 0.35;
      flashMesh.scale.setScalar(0.5 + (1 - t) * 4);
      flashMesh.material.opacity = t * 0.85;
      flashLight.intensity = 60 * t;
      if (flashLeft === 0) flashMesh.visible = false;
    }
    if (!active.flying) return;
    active.fuse -= dt;
    previous.copy(position);
    velocity.y -= GRAVITY * dt;
    position.addScaledVector(velocity, dt);
    probe.min.set(position.x - 0.09, position.y - 0.09, position.z - 0.09);
    probe.max.set(position.x + 0.09, position.y + 0.09, position.z + 0.09);
    let hit = null;
    for (const collider of world.colliders) {
      if (probe.intersectsBox(collider)) {
        hit = collider;
        break;
      }
    }
    if (position.y < 0.09) {
      position.y = 0.09;
      velocity.y = Math.abs(velocity.y) * 0.45;
      velocity.x *= 0.7;
      velocity.z *= 0.7;
      active.bounced = true;
    } else if (hit) {
      // Bounce off the face the grenade came in through, damped.
      if (previous.x + 0.09 <= hit.min.x || previous.x - 0.09 >= hit.max.x) velocity.x *= -0.45;
      else if (previous.z + 0.09 <= hit.min.z || previous.z - 0.09 >= hit.max.z) velocity.z *= -0.45;
      else velocity.y *= -0.45;
      position.copy(previous);
      active.bounced = true;
    }
    mesh.position.copy(position);
    if (active.fuse <= 0) explode(onBlast);
  }

  return {
    throw: throwGrenade,
    step,
    isFlying() {
      return active.flying;
    },
    reset() {
      active.flying = false;
      mesh.visible = false;
      flashMesh.visible = false;
      flashLight.intensity = 0;
      flashLeft = 0;
    },
  };
}
