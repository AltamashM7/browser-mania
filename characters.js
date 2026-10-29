import * as THREE from './vendor/three.module.js';
import { FBXLoader } from './vendor/loaders/FBXLoader.js';
import { RULES } from './rules.js';

export async function loadCharacterAssets() {
  const loader = new FBXLoader();
  const [run, idle, attack, dance, death, hit, power] = await Promise.all(['run', 'idle', 'attack', 'dance', 'death', 'hit', 'power'].map(name => loader.loadAsync(`./assets/animations/${name}.fbx`)));
  const clips = {};
  const boneNames = new Set(); run.traverse(node => { if(node.isBone)boneNames.add(node.name); });
  for (const [name, source] of Object.entries({ run, idle, attack, dance, death, hit, power })) {
    if (!source.animations.length) throw new Error(`Missing ${name} animation`);
    const clip = source.animations[0].clone();
    clip.name = name;
    clip.tracks = clip.tracks.filter(track => boneNames.has(track.name.split('.')[0]));
    const hipRatio = run.getObjectByName('mixamorigHips').position.y / source.getObjectByName('mixamorigHips').position.y;
    // Gameplay owns translation; retain only the authored vertical hip motion.
    for (const track of clip.tracks) {
      if (track.name.endsWith('Hips.position')) {
        for (let i = 0; i < track.values.length; i += 3) { track.values[i] = 0; track.values[i + 1] *= hipRatio; track.values[i + 2] = 0; }
      }
    }
    clips[name] = clip;
  }
  const walking=await fetch('./assets/animations/walk.json');
  if(!walking.ok)throw new Error('Walking animation unavailable');
  clips.walk=THREE.AnimationClip.parse(await walking.json());
  return { rig: run, clips, geometry: buildSkin(run) };
}

function buildSkin(rig) {
  rig.updateMatrixWorld(true);
  const bones = [], lookup = new Map();
  rig.traverse(node => { if (node.isBone) { lookup.set(node.name.replace('mixamorig', ''), bones.length); bones.push(node); } });
  const positions = [], normals = [], skinIndices = [], skinWeights = [], groups = [];
  const worldPosition = name => bones[lookup.get(name)].getWorldPosition(new THREE.Vector3());
  const identity = new THREE.Quaternion();
  function add(geometry, center, rotation, scale, material, boneA, boneB = boneA, weightAlong = false) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const matrix = new THREE.Matrix4().compose(center, rotation, scale);
    const position = source.attributes.position, normal = source.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const start = positions.length / 3;
    for (let i = 0; i < position.count; i++) {
      const original = new THREE.Vector3().fromBufferAttribute(position, i);
      // Soft weighting at the distal end lets elbows and knees bend continuously.
      const blend = weightAlong ? THREE.MathUtils.smoothstep(original.y, .2, .5) * .5 : 0;
      const point = original.applyMatrix4(matrix);
      const n = new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      positions.push(point.x, point.y, point.z); normals.push(n.x, n.y, n.z);
      skinIndices.push(lookup.get(boneA), lookup.get(boneB), 0, 0);
      skinWeights.push(1 - blend, blend, 0, 0);
    }
    groups.push({ start, count: position.count, material });
    if (source !== geometry) source.dispose();
    geometry.dispose();
  }
  function segment(a, b, radiusA, radiusB, material) {
    const start = worldPosition(a), end = worldPosition(b);
    const direction = end.clone().sub(start);
    add(new THREE.CylinderGeometry(radiusB, radiusA, 1, 8), start.clone().add(end).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()), new THREE.Vector3(1, direction.length(), 1), material, a, b, true);
  }
  function joint(bone, radius, material) {
    add(new THREE.SphereGeometry(radius, 10, 7), worldPosition(bone), identity, new THREE.Vector3(1, 1, 1), material, bone);
  }
  function block(bone, offset, dimensions, material) {
    add(new THREE.BoxGeometry(1, 1, 1), worldPosition(bone).add(new THREE.Vector3(...offset)), identity, new THREE.Vector3(...dimensions), material, bone);
  }
  segment('Hips', 'Spine2', 14, 21, 0);
  segment('Spine2', 'Neck', 21, 9, 0);
  segment('Neck', 'Head', 6, 7, 1);
  // Helmet, faceplate and backpack remain rigid while following their bones.
  add(new THREE.IcosahedronGeometry(15, 1), worldPosition('Head').add(new THREE.Vector3(0, 11, 0)), identity, new THREE.Vector3(.88, 1.05, .88), 0, 'Head');
  block('Head', [0, 12, 12], [23, 8, 5], 1);
  block('Head', [0, 12, 15], [18, 2, 1.2], 2);
  block('Spine2', [0, -3, -15], [24, 30, 7], 1);
  block('Spine2', [0, -3, -19], [4, 23, 1], 2);
  block('Hips', [0, -3, 0], [29, 12, 21], 1);
  for (const side of ['Left', 'Right']) {
    segment(`${side}Arm`, `${side}ForeArm`, 7.5, 6, 0);
    segment(`${side}ForeArm`, `${side}Hand`, 6, 4.7, 0);
    joint(`${side}Arm`, 8, 0); joint(`${side}ForeArm`, 6.5, 1);
    joint(`${side}Hand`, 6, 2);
    segment(`${side}UpLeg`, `${side}Leg`, 10, 7, 1);
    segment(`${side}Leg`, `${side}Foot`, 7.5, 5.5, 0);
    joint(`${side}Leg`, 7.5, 1);
    block(`${side}Foot`, [0, -4, 5], [12, 10, 24], 1);
  }
  // Batch the body into three material groups, even with many articulated parts.
  const geometry = new THREE.BufferGeometry();
  const packed = { positions: [], normals: [], indices: [], weights: [] };
  for (let material = 0; material < 3; material++) {
    const start = packed.positions.length / 3;
    for (const group of groups.filter(group => group.material === material)) {
      packed.positions.push(...positions.slice(group.start * 3, (group.start + group.count) * 3));
      packed.normals.push(...normals.slice(group.start * 3, (group.start + group.count) * 3));
      packed.indices.push(...skinIndices.slice(group.start * 4, (group.start + group.count) * 4));
      packed.weights.push(...skinWeights.slice(group.start * 4, (group.start + group.count) * 4));
    }
    geometry.addGroup(start, packed.positions.length / 3 - start, material);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(packed.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(packed.normals, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(packed.indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(packed.weights, 4));
  return geometry;
}

const materialSets = new Map();
export function createHumanoid(assets, enemy = false) {
  const rig = assets.rig.clone(true);
  const bones = []; rig.traverse(node => { if (node.isBone) bones.push(node); });
  if (!materialSets.has(enemy)) materialSets.set(enemy, [
    new THREE.MeshStandardMaterial({ color: enemy ? 0x665771 : 0xd5d9e4, roughness: .65, metalness: .15 }),
    new THREE.MeshStandardMaterial({ color: enemy ? 0x231c2c : 0x161925, roughness: .7 }),
    new THREE.MeshStandardMaterial({ color: 0xff287f, emissive: 0xff287f, emissiveIntensity: enemy ? 2.2 : 1.5 }),
  ]);
  const skin = new THREE.SkinnedMesh(assets.geometry, materialSets.get(enemy));
  skin.castShadow = true; skin.receiveShadow = true; skin.frustumCulled = false;
  rig.add(skin);
  rig.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skin.bind(skeleton);
  rig.scale.setScalar(.0115);
  // Mixamo faces +Z; the game character's forward axis is -Z.
  const object = new THREE.Group(); object.rotation.y = Math.PI; object.add(rig);
  const mixer = new THREE.AnimationMixer(rig);
  const actions = Object.fromEntries(Object.entries(assets.clips).map(([name, clip]) => [name, mixer.clipAction(clip)]));
  let current = null;
  function update(dt, name = 'idle', pace = 1) {
    if (name !== current) {
      const next = actions[name];
      const once = name === 'death' || name === 'hit' || name === 'power';
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = once;
      next.reset().setEffectiveWeight(1).play();
      if (current) next.crossFadeFrom(actions[current], name === 'hit' ? .035 : current === 'hit' || name === 'attack' ? .08 : .16, false);
      current = name;
    }
    const action = actions[name];
    action.timeScale = name === 'power' ? assets.clips.power.duration / RULES.powerTransform : name === 'hit' ? assets.clips.hit.duration / RULES.hitDuration : name === 'attack' ? assets.clips.attack.duration / (enemy ? .7 : .48) : pace;
    mixer.update(dt);
  }
  update(0);
  return {
    object, update,
    pose(name, fraction = 1) {
      mixer.stopAllAction();current=null;update(0,name);mixer.update(assets.clips[name].duration * Math.min(.99999,fraction));
      actions[name].paused=true;
    },
    reset() { mixer.stopAllAction(); current = null; update(0); },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(rig); skeleton.dispose(); },
  };
}
