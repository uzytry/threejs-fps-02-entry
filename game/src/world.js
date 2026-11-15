// CINDERFALL REFINERY — the map. An abandoned solar refinery at dusk: one bomb site
// (the Reactor pad) at the north end, three lanes in from the attackers' yard in the
// south — PIPE (west), YARD (mid) and VENT (east). Boxes and cylinders only, no models,
// no textures except two canvas-drawn ones for the pad. Under the map sits the waypoint
// graph the bots walk: every edge is a straight, wall-free run, and BFS over it is the
// whole of bot pathfinding. This module also owns the shared collision mover and the
// line-of-sight test, so the player and the bots resolve against the same world.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes [x, z]. 0-2 attacker spawn, 3-5 lane entries, 6-8 lane mids,
// 9-11 lane exits, 12-16 site pocket, 17-19 defender spawn, 20-21 cross-lane
// connectors, 22-23 site flanks, 24 site back, 25-30 lane intermediates.
const NODES = [
  [0, 20], [-8, 20], [8, 20],
  [-18, 12], [0, 12], [18, 12],
  [-18, 0], [0, 0], [18, 0],
  [-18, -10], [0, -10], [18, -10],
  [-6, -13], [6, -13], [0, -17], [-4, -17], [4, -17],
  [-6, -22], [0, -22], [6, -22],
  [-9, 0], [9, 0],
  [-13, -13], [13, -13], [0, -20],
  [-18, 6], [18, 6], [0, 6],
  [-18, -5], [18, -5], [0, -5],
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 3], [2, 5],
  [3, 25], [25, 6], [6, 28], [28, 9], [9, 22], [22, 12],
  [4, 27], [27, 7], [7, 30], [30, 10], [10, 12], [10, 13],
  [5, 26], [26, 8], [8, 29], [29, 11], [11, 23], [23, 13],
  [6, 20], [20, 7], [7, 21], [21, 8],
  [12, 15], [15, 14], [14, 16], [16, 13], [12, 14], [13, 14],
  [17, 24], [18, 24], [19, 24], [24, 14], [24, 15], [24, 16],
];

// Lane routes, spawn entry to the pad, as node sequences.
const LANES = {
  west: [3, 25, 6, 28, 9, 22, 12, 15, 14],
  mid: [4, 27, 7, 30, 10, 12, 14],
  east: [5, 26, 8, 29, 11, 23, 13, 16, 14],
};

const ADJACENCY = NODES.map(() => []);
for (const [a, b] of EDGES) {
  ADJACENCY[a].push(b);
  ADJACENCY[b].push(a);
}

// BFS over the waypoint graph. Returns node indices from `from` to `to` inclusive,
// or null when unreachable. Allocated on repath only, never per frame.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Array(NODES.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head];
    for (const next of ADJACENCY[node]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === to) {
        const path = [to];
        let walk = node;
        while (walk !== from) {
          path.push(walk);
          walk = prev[walk];
        }
        path.push(from);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i += 1) {
    const dx = NODES[i][0] - x;
    const dz = NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.accent;
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = PALETTE.canvas;
  for (let x = -32; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 32);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

function padTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#1d2026';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = PALETTE.accent;
  g.lineWidth = 6;
  g.strokeRect(14, 14, 484, 292);
  g.fillStyle = PALETTE.accent;
  g.font = '700 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('REACTOR', 256, 150);
  g.font = '600 30px system-ui, sans-serif';
  g.fillStyle = PALETTE.muted;
  g.fillText('SITE A  //  PLANT ZONE', 256, 205);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const rust = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a3630'), roughness: 0.95 });
  const concrete = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2e35'), roughness: 0.95 });
  const panel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d2b3a'), roughness: 0.4, metalness: 0.55 });
  const hazard = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7 });
  const padTop = new THREE.MeshStandardMaterial({ map: padTexture(), roughness: 0.85 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(r, h, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      // Cylinders collide as their bounding box; close enough at this scale.
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and the outer desert plane the walls sit in.
  box(57.2, 0.4, 48.8, 0, -0.2, 0, concrete);
  const desert = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: new THREE.Color('#191512'), roughness: 1 }));
  desert.rotation.x = -Math.PI / 2;
  desert.position.y = -0.06;
  desert.receiveShadow = true;
  scene.add(desert);

  // Perimeter walls, 4.6 m.
  box(0.4, 4.6, 48.8, -28.4, 2.3, 0, materials.surface);
  box(0.4, 4.6, 48.8, 28.4, 2.3, 0, materials.surface);
  box(57.2, 4.6, 0.4, 0, 2.3, -24.4, materials.surface);
  box(57.2, 4.6, 0.4, 0, 2.3, 24.4, materials.surface);

  // South cross wall (z = +10) with three lane-entry gaps: [-20,-16], [-2,2], [16,20].
  // North cross wall (z = -10) with the same gaps: lane exits into the site approach.
  for (const z of [10, -10]) {
    box(8, 4.6, 0.4, -24, 2.3, z, materials.surface);
    box(14, 4.6, 0.4, -9, 2.3, z, materials.surface);
    box(14, 4.6, 0.4, 9, 2.3, z, materials.surface);
    box(8, 4.6, 0.4, 24, 2.3, z, materials.surface);
  }

  // Lane separators (x = -9 and x = +9), running z = -24..+10 with a mid gap at z in [-2, 2].
  for (const x of [-9, 9]) {
    box(0.4, 4.6, 22, x, 2.3, -13, materials.surface);
    box(0.4, 4.6, 8, x, 2.3, 6, materials.surface);
  }

  // The Reactor pad: flat plate with painted markings, hazard border, corner posts.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(12, 0.06, 8), padTop);
  plate.position.set(0, 0.03, -17);
  plate.receiveShadow = true;
  group.add(plate);
  box(12.4, 0.1, 0.3, 0, 0.05, -13, hazard, false);
  box(12.4, 0.1, 0.3, 0, 0.05, -21, hazard, false);
  box(0.3, 0.1, 8, -6.1, 0.05, -17, hazard, false);
  box(0.3, 0.1, 8, 6.1, 0.05, -17, hazard, false);
  box(0.35, 1.3, 0.35, -6, 0.65, -13.2, materials.accent);
  box(0.35, 1.3, 0.35, 6, 0.65, -13.2, materials.accent);
  box(0.35, 1.3, 0.35, -6, 0.65, -20.8, materials.accent);
  box(0.35, 1.3, 0.35, 6, 0.65, -20.8, materials.accent);

  // YARD (mid): two long containers staggered across the lane, crates, a pillar.
  // Cover sits clear of the lane centreline (x = 0) and of the waypoint legs, so
  // a bot walking node to node never wedges against a corner: every graph edge
  // is a straight, wall-free run, and the cover honours that contract.
  box(2.4, 2.4, 6, -3.4, 1.2, 4.5, rust);
  box(2.4, 2.4, 6, 3.4, 1.2, -4, panel);
  box(1.2, 1.2, 1.2, 2.6, 0.6, 6, materials.hairline);
  box(1.1, 1.1, 1.1, -4.6, 0.55, -2, materials.hairline);
  box(1.1, 1.1, 1.1, 4.6, 0.55, 4, materials.hairline);
  box(1, 3.4, 1, -2.8, 1.7, -7.4, materials.surface);

  // PIPE (west): crates, a low wall, a pipe run along the outer wall.
  box(1.2, 1.2, 1.2, -15.5, 0.6, 5, materials.hairline);
  box(1.1, 1.1, 1.1, -15, 0.55, -3, materials.hairline);
  box(1.1, 1.1, 1.1, -21.5, 0.55, -4, materials.hairline);
  box(3, 1.1, 0.5, -15.5, 0.55, -1, materials.surface);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 18, 12), rust);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(-26.6, 1.1, 0);
  pipe.castShadow = true;
  group.add(pipe);
  colliders.push(new THREE.Box3(new THREE.Vector3(-27, 0.7, -9), new THREE.Vector3(-26.2, 1.5, 9)));
  shootables.push(pipe);

  // VENT (east): crates and two vent stacks.
  box(1.2, 1.2, 1.2, 15.5, 0.6, 5, materials.hairline);
  box(1.1, 1.1, 1.1, 15, 0.55, -3, materials.hairline);
  box(1.1, 1.1, 1.1, 21.5, 0.55, -4, materials.hairline);
  cylinder(0.8, 3.2, 14, 1.6, -7, rust);
  cylinder(0.8, 3.2, 22, 1.6, 2, rust);

  // Site cover: crates at the pad corners, pillars flanking it, defender cover at the back.
  box(1.2, 1.2, 1.2, -2.5, 0.6, -13.6, materials.hairline);
  box(1.2, 1.2, 1.2, 2.5, 0.6, -13.6, materials.hairline);
  box(1.1, 1.1, 1.1, -5.5, 0.55, -20.2, materials.hairline);
  box(1.1, 1.1, 1.1, 5.5, 0.55, -20.2, materials.hairline);
  box(1, 3.4, 1, -7.4, 1.7, -17, materials.surface);
  box(1, 3.4, 1, 7.4, 1.7, -17, materials.surface);
  box(4, 1.2, 2.4, -10, 0.6, -22.4, rust);
  box(4, 1.2, 2.4, 10, 0.6, -22.4, panel);

  // Spawn-yard dressing.
  box(1.2, 1.2, 1.2, -12, 0.6, 18.5, materials.hairline);
  box(1.2, 1.2, 1.2, 12, 0.6, 16, materials.hairline);
  box(2.4, 1.2, 1.2, 0, 0.6, 22.6, materials.hairline);

  // Amber strip lights over the three lane entries: readable at a glance.
  for (const x of [-18, 0, 18]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
    strip.position.set(x, 3.6, 10);
    group.add(strip);
    const strip2 = strip.clone();
    strip2.position.set(x, 3.6, -10);
    group.add(strip2);
  }

  // Derelict silhouettes outside the walls, for a horizon with depth.
  const ruins = [
    [-40, 6, -30, 10, 12, 8], [38, 4, -34, 12, 8, 10], [-44, 3, 10, 8, 6, 12],
    [42, 5, 18, 10, 10, 8], [-20, 4, -42, 14, 8, 8], [24, 3, -44, 10, 6, 10],
  ];
  for (const [x, y, z, w, h, d] of ruins) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: new THREE.Color('#121216'), roughness: 1 }));
    m.position.set(x, y, z);
    scene.add(m);
  }
  // Tilted solar panels, the refinery's own dead array.
  for (const [x, z, ry] of [[-36, -8, 0.4], [36, -12, -0.3], [-34, 22, 0.9]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(7, 0.15, 4), panel);
    p.position.set(x, 2.2, z);
    p.rotation.set(-0.5, ry, 0);
    scene.add(p);
  }
  // The low dusk sun.
  const sun = new THREE.Mesh(new THREE.CircleGeometry(7, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a3c'), fog: false }));
  sun.position.set(-90, 16, -60);
  sun.lookAt(0, 2, 0);
  scene.add(sun);

  // Light: a warm low key from the west, a cool fill from the east, a dim sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#3a4656'), new THREE.Color('#241c16'), 1.5);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 3.0);
  key.position.set(-24, 26, 14);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -34;
  key.shadow.camera.right = 34;
  key.shadow.camera.top = 34;
  key.shadow.camera.bottom = -34;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a7a9a'), 0.7);
  fill.position.set(18, 12, -18);
  scene.add(fill);

  // --- Shared collision: a body is an axis-aligned box moved one axis at a time. ---
  const probe = new THREE.Box3();
  function overlaps(x, y, z, height, radius, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function moveBody(body, dt) {
    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, body.radius, 0.05)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, body.radius, 0.05)) body.position.z = nextZ;
    else body.velocity.z = 0;
    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, body.radius, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
  }

  // --- Shared line of sight: true when no shootable stands between the points. ---
  const sightRay = new THREE.Raycaster();
  const sightDir = new THREE.Vector3();
  function hasLineOfSight(from, to) {
    sightDir.subVectors(to, from);
    const distance = sightDir.length();
    if (distance < 0.001) return true;
    sightDir.divideScalar(distance);
    sightRay.set(from, sightDir);
    sightRay.far = distance - 0.05;
    return sightRay.intersectObjects(shootables, false).length === 0;
  }

  // True when a body box at (x, y, z) would overlap any collider (the crouch check).
  function testBox(x, y, z, height, radius) {
    return overlaps(x, y, z, height, radius, 0) !== null;
  }

  return {
    colliders,
    shootables,
    group,
    moveBody,
    testBox,
    hasLineOfSight,
    waypoints: { nodes: NODES, lanes: LANES },
    site: { minX: -6, maxX: 6, minZ: -21, maxZ: -13, center: new THREE.Vector3(0, 0, -17) },
    spawns: {
      attack: [{ x: 0, z: 21.5 }, { x: -6, z: 21 }, { x: 6, z: 21 }, { x: -12, z: 20.5 }, { x: 12, z: 20.5 }],
      defend: [{ x: -7, z: -22.5 }, { x: -4, z: -22.5 }, { x: 0, z: -22.5 }, { x: 4, z: -22.5 }, { x: 7, z: -22.5 }],
    },
    // Defender hold spots: node + the yaw to face (PI looks south, at the lanes).
    holdSpots: [
      { node: 12, yaw: Math.PI },
      { node: 13, yaw: Math.PI },
      { node: 15, yaw: Math.PI * 0.9 },
      { node: 16, yaw: Math.PI * 1.1 },
      { node: 24, yaw: Math.PI },
    ],
    // Post-plant cover for attackers guarding a planted bomb.
    postPlantSpots: [
      { x: -5, z: -13.6 }, { x: 5, z: -13.6 }, { x: -7.4, z: -17 }, { x: 7.4, z: -17 }, { x: 0, z: -11.5 },
    ],
  };
}
