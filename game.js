import { RULES, newRound, advanceRound, isOutsideZone, zoneRadius, registerEnemyHit, activatePower, finishPowerTransformation, playerAttackRange } from './rules.js';
import { createArenaWalls } from './arena-walls.js';
import { loadCharacterAssets, createHumanoid } from './characters.js';
import { createCinematics } from './cinematics.js';
import { createGameAudio } from './audio.js';
import { createPowerUp } from './powerup.js';

const $ = id => document.getElementById(id);
let THREE;
try {
  THREE = await import('./vendor/three.module.js');
  await boot();
} catch (error) {
  $('load-error').textContent = `Unable to start: ${error.message}`;
  $('start').textContent = 'Retry'; $('start').disabled = false;
  $('start').onclick = () => location.reload(); console.error(error);
}

async function boot() {
  const audio=createGameAudio();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101019);
  scene.fog = new THREE.FogExp2(0x101019, .018);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  $('game').appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, .1, 160);
  scene.add(new THREE.HemisphereLight(0xc5c7e6, 0x302331, 1.5));
  const sun = new THREE.DirectionalLight(0xe8dfef, 2.6); sun.position.set(-8, 19, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-29,right:29,top:29,bottom:-29,near:1,far:70});sun.shadow.bias=-.0006;scene.add(sun);
  const accentLight = new THREE.PointLight(0xff367f, 24, 24, 2);accentLight.position.set(-9,4,-9);scene.add(accentLight);
  const menuLight = new THREE.PointLight(0xffe5dc, 15, 11, 2); menuLight.position.set(1,2.7,6);scene.add(menuLight);
  const rimLight = new THREE.PointLight(0xff2c87, 13, 10, 2);rimLight.position.set(-1,2,2);scene.add(rimLight);
  const environment = createArenaWalls(THREE,scene);
  const assets = await loadCharacterAssets();
  const player = new THREE.Group(); scene.add(player);
  const playerActor = createHumanoid(assets);player.add(playerActor.object);
  const menuActor = createHumanoid(assets);
  const menuCharacter = new THREE.Group();menuCharacter.add(menuActor.object);menuCharacter.position.set(0,0,4);menuCharacter.rotation.y=Math.PI+.12;scene.add(menuCharacter);
  const boxGeo = new THREE.BoxGeometry(1,1,1);
  const healingMaterial = new THREE.MeshStandardMaterial({color:0xb1f5dc,emissive:0x57d7af,emissiveIntensity:1.2,roughness:.3});
  const enemies=[],effects=[];
  let healing=null,state=newRound();state.status='menu';
  let yaw=0,pitch=.18,cameraDistance=3.7,attackLeft=0,hitLeft=0,cooldown=0,invulnerability=0,spawnTimer=2;
  let cameraYaw=0,cameraPitch=.18,gait=0,cameraRoll=0;
  const cameraVelocity=new THREE.Vector3(),lookTarget=new THREE.Vector3();
  let menuTime=0;
  const keys=new Set(),move=new THREE.Vector3(),desiredCamera=new THREE.Vector3(),cameraTarget=new THREE.Vector3();
  const healthPips=[...document.querySelectorAll('#lives i')];
  function setSceneMode(menu) {
    menuCharacter.visible=menu;menuLight.visible=menu;rimLight.visible=menu;
    player.visible=!menu;for(const enemy of enemies)enemy.object.visible=!menu;
    if(healing)healing.visible=!menu;
    camera.fov=menu?45:60;camera.updateProjectionMatrix();
  }
  function updateMenuCamera() {
    camera.position.set(Math.sin(menuTime*.13)*.055,1.35,7.6);
    camera.lookAt(-1.05,1.02,4);
  }
  function updateCamera(dt,snap=false) {
    const turn=Math.atan2(Math.sin(yaw-cameraYaw),Math.cos(yaw-cameraYaw));
    cameraYaw=snap?yaw:cameraYaw+turn*(1-Math.exp(-23*dt));
    cameraPitch=snap?pitch:THREE.MathUtils.lerp(cameraPitch,pitch,1-Math.exp(-20*dt));
    const horizontal=Math.cos(cameraPitch)*(cameraDistance+attackLeft*.18);
    const shoulder=.32;
    desiredCamera.set(player.position.x+Math.sin(cameraYaw)*horizontal+Math.cos(cameraYaw)*shoulder,1.35+Math.sin(cameraPitch)*cameraDistance,player.position.z+Math.cos(cameraYaw)*horizontal-Math.sin(cameraYaw)*shoulder);
    const moving=move.lengthSq()>0&&attackLeft<=0&&hitLeft<=0;
    if(moving)gait+=dt*10;
    desiredCamera.y+=moving?Math.sin(gait)*.016:0;
    environment.constrainCamera(desiredCamera);
    if(snap){camera.position.copy(desiredCamera);cameraVelocity.set(0,0,0);}
    else {
      // Analytic critically damped spring: weight without frame-dependent wobble.
      const omega=14,decay=Math.exp(-omega*dt);
      for(const axis of ['x','y','z']) {
        const delta=camera.position[axis]-desiredCamera[axis],step=(cameraVelocity[axis]+omega*delta)*dt;
        cameraVelocity[axis]=(cameraVelocity[axis]-omega*step)*decay;
        camera.position[axis]=desiredCamera[axis]+(delta+step)*decay;
      }
    }
    environment.constrainCamera(camera.position);
    cameraTarget.set(player.position.x-Math.sin(cameraYaw)*.45,1.32,player.position.z-Math.cos(cameraYaw)*.45);
    if(snap)lookTarget.copy(cameraTarget);else lookTarget.lerp(cameraTarget,1-Math.exp(-18*dt));
    camera.lookAt(lookTarget);
    cameraRoll=THREE.MathUtils.lerp(cameraRoll,moving?Math.sin(gait*.5)*.0025:0,1-Math.exp(-8*dt));camera.rotateZ(cameraRoll);
  }
  function removeEnemy(index) { const enemy=enemies[index];scene.remove(enemy.object);enemy.actor.dispose();enemies.splice(index,1); }
  function spawnEnemy() {
    let a=Math.random()*Math.PI*2,r=zoneRadius(a,state.radius)-.7;
    let x=Math.sin(a)*r,z=Math.cos(a)*r;
    if(Math.hypot(x-player.position.x,z-player.position.z)<4){a+=Math.PI;r=zoneRadius(a,state.radius)-.7;x=Math.sin(a)*r;z=Math.cos(a)*r;}
    const object=new THREE.Group();object.position.set(x,0,z);environment.constrain(object.position,.4);scene.add(object);
    const actor=createHumanoid(assets,true);object.add(actor.object);actor.update(Math.random()*.6,'run',.7);const enemy={object,actor};enemies.push(enemy);return enemy;
  }
  function burst(position,color=0xff508e,range=RULES.attackRange,duration=.45) {
    const geometry=new THREE.RingGeometry(.88,1,64),p=geometry.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),a=Math.atan2(x,y),r=1+.045*Math.sin(a*5)+.025*Math.cos(a*9);p.setXY(i,x*r,y*r);}
    const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false});
    const object=new THREE.Mesh(geometry,material);object.rotation.x=-Math.PI/2;object.position.copy(position);object.position.y=.08;
    scene.add(object);effects.push({object,life:duration,duration,range});
  }
  function clearEffects() {for(const effect of effects){scene.remove(effect.object);effect.object.geometry.dispose();effect.object.material.dispose();}effects.length=0;}
  function attack() {
    if(state.status!=='playing'||cooldown>0||hitLeft>0)return;
    const range=playerAttackRange(state);
    attackLeft=RULES.attackDuration;cooldown=RULES.attackCooldown;burst(player.position,state.powerRemaining>0?0xffda70:0xff508e,range);audio.event('pulse');
    const killsBefore=state.kills;
    for(let i=enemies.length-1;i>=0;i--)if(enemies[i].object.position.distanceTo(player.position)<=range){burst(enemies[i].object.position,0xe5d8e7,.9,.25);removeEnemy(i);state.kills++;}
    if(state.kills>killsBefore)audio.event('impact');
  }
  function removeHealing() {
    if(!healing)return;scene.remove(healing);healing.traverse(o=>{if(o.isMesh&&o.geometry!==boxGeo)o.geometry.dispose();});healing=null;
  }
  function hitReaction() {
    hitLeft=RULES.hitDuration;attackLeft=0;invulnerability=.7;
    playerActor.update(0,'hit');audio.event('hit');
  }
  function spawnHealing() {
    if(healing)return;
    healing=new THREE.Group();scene.add(healing);const a=Math.random()*Math.PI*2,r=state.radius*.45;
    healing.position.set(Math.sin(a)*r,0,Math.cos(a)*r);environment.constrain(healing.position,.5);
    const core=new THREE.Mesh(new THREE.OctahedronGeometry(.35),healingMaterial);core.position.y=.8;healing.add(core);
    for(const scale of [[.12,.48,.12],[.48,.12,.12]]){const piece=new THREE.Mesh(boxGeo,healingMaterial);piece.position.y=1.4;piece.scale.set(...scale);healing.add(piece);}
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.6,.025,6,40),healingMaterial);ring.rotation.x=Math.PI/2;ring.position.y=.08;healing.add(ring);
    audio.event('healing');
  }
  function releaseMouse() {keys.clear();if(document.pointerLockElement)document.exitPointerLock();}
  function showMenu(type) {
    releaseMouse();$('overlay').hidden=false;$('hud').hidden=true;$('load-error').textContent='';$('exit').hidden=false;
    document.body.classList.remove('danger');setSceneMode(true);updateMenuCamera();
    $('title').innerHTML=type==='paused'?'PAUSED':type==='won'?'SURVIVED':type==='lost'?'FALLEN':'LAST<span>SIGNAL</span>';
    $('start').textContent=type==='paused'?'Resume':type==='menu'?'Start Game':'Play Again';
    $('exit').textContent=type==='menu'?'Exit':'Main Menu';
    $('result').hidden=!['won','lost'].includes(type);
    $('result').textContent=`${Math.floor(state.time/60)}:${String(Math.floor(state.time%60)).padStart(2,'0')}`;
  }
  function pause() {if(state.status!=='playing')return;state.status='paused';showMenu('paused');}
  function captureMouse() {
    const failed=()=>{if(state.status==='cinematic'||state.status==='powerup')return;if(state.status==='playing')pause();$('load-error').textContent='Mouse capture is unavailable; open the game in a browser tab and press Resume.';};
    try{const result=renderer.domElement.requestPointerLock();if(result?.catch)result.catch(failed);}catch{failed();}
  }
  function resume() {
    state.status='playing';keys.clear();$('overlay').hidden=true;$('hud').hidden=false;setSceneMode(false);updateCamera(1,true);captureMouse();
  }
  function reset() {
    powerup.cancel();
    while(enemies.length)removeEnemy(enemies.length-1);removeHealing();clearEffects();state=newRound();
    player.position.set(0,0,4);player.rotation.set(0,0,0);playerActor.reset();yaw=0;pitch=.18;cameraDistance=3.7;
    attackLeft=hitLeft=cooldown=invulnerability=0;spawnTimer=2;keys.clear();environment.setRadius(state.radius);
    cinematics.start('intro');captureMouse();updateHud();
  }
  function mainMenu() {
    powerup.cancel();
    cinematics.cancel();
    state.status='menu';while(enemies.length)removeEnemy(enemies.length-1);removeHealing();clearEffects();
    environment.setRadius(RULES.initialRadius);$('game').style.opacity='1';showMenu('menu');
  }
  function updateHud() {
    const remaining=Math.max(0,Math.ceil(RULES.duration-state.time));
    $('time').textContent=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
    $('shrink').textContent=state.stage>=5?'—':`${Math.max(0,Math.ceil((state.stage+1)*10-state.time))}`;
    $('shrink').setAttribute('aria-label','Seconds to next shrink');
    const hp=Math.max(0,state.lives*3-state.hits);
    healthPips.forEach((pip,i)=>pip.classList.toggle('empty',i>=hp));
    $('lives').setAttribute('aria-label',`${state.lives} lives; ${3-state.hits} hits until next life lost`);
    const outside=isOutsideZone(player.position,state.radius);$('danger').hidden=!outside;document.body.classList.toggle('danger',outside);
    $('danger-fill').style.width=`${Math.max(0,1-state.outside/RULES.outsideLimit)*100}%`;
    $('attack-fill').style.width=`${Math.max(0,1-cooldown/RULES.attackCooldown)*100}%`;
    $('attack-label').textContent='PULSE';
    const powered=state.powerRemaining>0,ready=!state.powerUsed&&state.time+1e-8>=RULES.powerCharge;
    $('power-meter').hidden=state.powerUsed&&!powered;
    $('power-meter').classList.toggle('ready',ready||powered);
    $('power-fill').style.width=`${(powered?state.powerRemaining/RULES.powerDuration:state.powerUsed?0:Math.min(1,state.time/RULES.powerCharge))*100}%`;
    $('power-hint').textContent=powered?`${state.powerRemaining.toFixed(1)}s`:ready?'SPACE · TRANSFORM':'POWER';
  }
  function tick(dt) {
    attackLeft=Math.max(0,attackLeft-dt);hitLeft=Math.max(0,hitLeft-dt);cooldown=Math.max(0,cooldown-dt);invulnerability=Math.max(0,invulnerability-dt);
    const horizontal=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    move.set(Math.cos(yaw)*horizontal-Math.sin(yaw)*forward,0,-Math.sin(yaw)*horizontal-Math.cos(yaw)*forward);
    const moving=move.lengthSq()>0&&attackLeft<=0&&hitLeft<=0;
    if(moving){
      move.normalize();player.position.addScaledVector(move,dt*RULES.playerSpeed);environment.constrain(player.position);
      const target=Math.atan2(-move.x,-move.z),difference=Math.atan2(Math.sin(target-player.rotation.y),Math.cos(target-player.rotation.y));player.rotation.y+=difference*Math.min(1,dt*16);
    }
    playerActor.update(dt,hitLeft>0?'hit':attackLeft>0?'attack':moving?'run':'idle',1.15);
    player.visible=true;
    const events=advanceRound(state,dt,isOutsideZone(player.position,state.radius));
    if(events.damaged){hitReaction();audio.event('life');}
    if(events.shrunk){
      environment.setRadius(state.radius);
      audio.event('shrink');
      if(healing&&isOutsideZone(healing.position,state.radius)){
        const a=Math.atan2(healing.position.x,healing.position.z),length=Math.hypot(healing.position.x,healing.position.z),r=zoneRadius(a,state.radius)-1;
        healing.position.x*=r/length;healing.position.z*=r/length;
      }
    }
    if(events.healing)spawnHealing();
    if(state.status!=='playing'){updateHud();cinematics.start(state.status);return;}
    spawnTimer-=dt;if(spawnTimer<=0){if(enemies.length<18)spawnEnemy();spawnTimer=Math.max(1.3,3.5-state.stage*.3);}
    const speed=RULES.enemySpeed+state.stage*RULES.speedPerShrink;
    for(const enemy of enemies){
      const p=enemy.object.position,dx=player.position.x-p.x,dz=player.position.z-p.z,distance=Math.hypot(dx,dz);
      if(distance>.01){const step=Math.min(distance,speed*dt);p.x+=dx/distance*step;p.z+=dz/distance*step;environment.constrain(p,.35);enemy.object.rotation.y=Math.atan2(-dx,-dz);}
      enemy.actor.update(dt,distance<1.3?'attack':'run',speed/4.2);
      if(distance<.85&&invulnerability<=0){
        const livesBefore=state.lives;registerEnemyHit(state);hitReaction();if(state.lives<livesBefore)audio.event('life');
        if(distance>.01){p.x-=dx/distance*1.6;p.z-=dz/distance*1.6;environment.constrain(p,.35);}
        if(state.status!=='playing')break;
      }
    }
    if(healing){
      healing.rotation.y+=dt;healing.children[0].position.y=.8+Math.sin(state.time*3)*.1;
      if(state.lives<RULES.maxLives&&healing.position.distanceTo(player.position)<1.15){state.lives++;burst(healing.position,0xb1f5dc,1.8,.6);removeHealing();audio.event('pickup');}
    }
    for(let i=effects.length-1;i>=0;i--){
      const effect=effects[i];effect.life-=dt;
      if(effect.life<=0){scene.remove(effect.object);effect.object.geometry.dispose();effect.object.material.dispose();effects.splice(i,1);}
      else{const progress=1-effect.life/effect.duration;effect.object.scale.setScalar(.2+progress*effect.range);effect.object.material.opacity=(1-progress)*.75;}
    }
    updateCamera(dt);updateHud();if(state.status!=='playing')cinematics.start(state.status);
  }
  const cinematics=createCinematics(THREE,{
    camera,player,playerActor,enemies,environment,spawnEnemy,
    sound:kind=>audio.event(kind),
    clearEnemies(){while(enemies.length)removeEnemy(enemies.length-1);},
    enter(){state.status='cinematic';keys.clear();$('hud').hidden=true;$('overlay').hidden=true;document.body.classList.remove('danger');},
    stage(){if(healing)healing.visible=false;menuCharacter.visible=false;menuLight.visible=false;rimLight.visible=false;player.visible=true;},
    prepareGameplay(){
      while(enemies.length)removeEnemy(enemies.length-1);clearEffects();
      player.position.set(0,0,4);player.rotation.set(0,0,0);playerActor.reset();move.set(0,0,0);cameraRoll=gait=0;
      spawnEnemy();spawnEnemy();spawnEnemy();setSceneMode(false);environment.setRadius(state.radius);updateCamera(1,true);
    },
    beginGameplay(){state.status='playing';$('hud').hidden=false;keys.clear();updateHud();if(document.pointerLockElement!==renderer.domElement)pause();},
    showResult(type){state.status=type;showMenu(type);},
  });
  const powerup=createPowerUp(THREE,{
    scene,player,playerActor,camera,environment,audio,
    enter(){keys.clear();move.set(0,0,0);$('hud').hidden=true;document.body.classList.remove('danger');},
    restore(){setSceneMode(false);updateCamera(1,true);},
    complete(){finishPowerTransformation(state);$('hud').hidden=false;keys.clear();updateHud();if(document.pointerLockElement!==renderer.domElement)pause();},
  });
  $('start').disabled=false;$('start').textContent='Start Game';
  $('start').onclick=()=>{if(state.status==='exited'){mainMenu();return;}state.status==='paused'?resume():reset();};
  $('pause').onclick=pause;
  $('controls-button').onclick=()=>{audio.event('select');$('controls-dialog').showModal();};
  $('exit').onclick=()=>{
    if(state.status!=='menu'){mainMenu();return;}
    releaseMouse();audio.stop();state.status='exited';renderer.setAnimationLoop(null);$('game').style.opacity='0';$('start').textContent='Return';$('exit').hidden=true;
    // Browsers allow closing script-opened windows; ordinary tabs retain a Return action.
    window.close();
  };
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==renderer.domElement&&state.status==='playing')pause();});
  document.addEventListener('pointerlockerror',()=>{if(state.status==='cinematic'||state.status==='powerup')return;if(state.status==='playing')pause();$('load-error').textContent='Mouse capture is unavailable; open the game in a browser tab and press Resume.';});
  addEventListener('keydown',event=>{
    if(event.code==='Escape'){if(cinematics.active)cinematics.skip();else pause();return;}
    if(state.status!=='playing')return;
    if(event.code==='Space'){event.preventDefault();if(!event.repeat&&activatePower(state))powerup.start();return;}
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))event.preventDefault();keys.add(event.code);
  });
  addEventListener('keyup',event=>keys.delete(event.code));
  addEventListener('blur',()=>{keys.clear();pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  renderer.domElement.addEventListener('mousedown',event=>{if(event.button===0&&document.pointerLockElement===renderer.domElement)attack();});
  renderer.domElement.addEventListener('contextmenu',event=>event.preventDefault());
  addEventListener('mousemove',event=>{
    if(state.status!=='playing'||document.pointerLockElement!==renderer.domElement)return;
    yaw-=event.movementX*.0025;pitch=THREE.MathUtils.clamp(pitch+event.movementY*.002,.02,.82);
  });
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
  player.position.set(0,0,4);setSceneMode(true);updateMenuCamera();
  let previousTime=performance.now();
  function render(now){
    const dt=Math.min((now-previousTime)/1000,.05);previousTime=now;if(!powerup.transforming)environment.update(dt);
    const boundaryDistance=Math.abs(Math.hypot(player.position.x,player.position.z)-zoneRadius(Math.atan2(player.position.x,player.position.z),state.radius));
    audio.update(dt,{playing:state.status==='playing',moving:move.lengthSq()>0&&attackLeft<=0&&hitLeft<=0,proximity:Math.max(0,1-boundaryDistance/4),cinematic:cinematics.active});
    powerup.updateAura(dt,state.status==='playing'?state.powerRemaining:0);
    if(powerup.transforming)powerup.update(dt);
    else if(cinematics.active)cinematics.update(dt);
    else if(state.status==='playing')tick(dt);
    else if(state.status!=='exited'){menuTime+=dt;menuActor.update(dt,'idle');updateMenuCamera();}
    renderer.render(scene,camera);
  }
  // Re-entering the menu after an Exit fallback also restarts rendering.
  const startClick=$('start').onclick;
  $('start').onclick=()=>{if(state.status==='exited'){previousTime=performance.now();renderer.setAnimationLoop(render);}startClick();};
  renderer.setAnimationLoop(render);
}
