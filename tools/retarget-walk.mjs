// Convert the user's Fitrah walking clip onto the game's Mixamo skeleton once.
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { FBXLoader } from '../vendor/loaders/FBXLoader.js';

function readFBX(path) {
  const bytes=readFileSync(path);
  return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
const source=readFBX(process.argv[2]);
const target=readFBX(new URL('../assets/animations/run.fbx',import.meta.url));
source.updateMatrixWorld(true);target.updateMatrixWorld(true);
const mapping={Hips:'Hips',Spine:'Spine',Spine1:'Spine1',Spine2:'Spine2',Neck:'Neck',Head:'Head'};
for(const [side,suffix] of [['Left','L'],['Right','R']]) {
  for(const bone of ['Shoulder','Arm','ForeArm','Hand','UpLeg','Leg','Foot','ToeBase'])mapping[side+bone]=bone+suffix;
}
const pairs=[];
target.traverse(bone=>{
  if(!bone.isBone)return;
  const name=bone.name.replace('mixamorig',''),sourceBone=source.getObjectByName(mapping[name]);
  if(!sourceBone)return;
  pairs.push({bone,source:sourceBone,rest:bone.getWorldQuaternion(new THREE.Quaternion()),inverseRest:sourceBone.getWorldQuaternion(new THREE.Quaternion()).invert(),values:[]});
});
const hipSource=source.getObjectByName('Hips'),hipTarget=target.getObjectByName('mixamorigHips');
const heightRatio=hipTarget.position.y/hipSource.position.y;
const clip=source.animations[0],mixer=new THREE.AnimationMixer(source);
mixer.clipAction(clip).play();
const frameCount=Math.ceil(clip.duration*30),times=[],hips=[];
const q=new THREE.Quaternion(),parentQ=new THREE.Quaternion();
let handMin=Infinity,handMax=-Infinity;
for(let frame=0;frame<=frameCount;frame++) {
  const time=frame/frameCount*clip.duration;times.push(time);
  mixer.setTime(Math.min(time,clip.duration-1e-6));source.updateMatrixWorld(true);
  hipTarget.position.set(0,hipSource.position.y*heightRatio,0);target.updateMatrixWorld(true);
  hips.push(0,hipTarget.position.y,0);
  for(const pair of pairs) {
    pair.source.getWorldQuaternion(q);q.multiply(pair.inverseRest).multiply(pair.rest);
    pair.bone.parent.getWorldQuaternion(parentQ).invert();q.premultiply(parentQ).normalize();
    pair.bone.quaternion.copy(q);pair.bone.updateMatrixWorld(true);
    if(pair.values.length&&q.dot(new THREE.Quaternion().fromArray(pair.values,pair.values.length-4))<0){q.x*=-1;q.y*=-1;q.z*=-1;q.w*=-1;}
    pair.values.push(q.x,q.y,q.z,q.w);
  }
  const handY=target.getObjectByName('mixamorigLeftHand').getWorldPosition(new THREE.Vector3()).y;
  handMin=Math.min(handMin,handY);handMax=Math.max(handMax,handY);
}
// The source is a full walking cycle; match the final sample to the first for a clean loop.
hips.splice(hips.length-3,3,...hips.slice(0,3));
const tracks=[new THREE.VectorKeyframeTrack('mixamorigHips.position',times,hips)];
for(const pair of pairs){pair.values.splice(pair.values.length-4,4,...pair.values.slice(0,4));tracks.push(new THREE.QuaternionKeyframeTrack(`${pair.bone.name}.quaternion`,times,pair.values));}
const result=new THREE.AnimationClip('walk',clip.duration,tracks);
if(tracks.some(track=>Array.from(track.values).some(value=>!Number.isFinite(value))))throw new Error('Invalid walking keyframe');
writeFileSync(new URL('../assets/animations/walk.json',import.meta.url),JSON.stringify(THREE.AnimationClip.toJSON(result)));
console.log(`Retargeted ${pairs.length} body bones; ${clip.duration.toFixed(2)}s walking loop; hands at ${handMin.toFixed(0)}–${handMax.toFixed(0)}cm, below shoulder level.`);
