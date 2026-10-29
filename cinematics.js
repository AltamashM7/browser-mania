const TAUNT = 'Survive for a minute against us, and you will be given your cherished freedom..!';
const ease = t => .5 - .5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));

export function createCinematics(THREE, hooks) {
  const { camera, player, playerActor, enemies, clearEnemies, spawnEnemy, environment } = hooks;
  const fade = document.getElementById('scene-fade');
  const frame = document.getElementById('cinematic');
  const subtitle = document.getElementById('subtitle');
  let active = null;
  const curve = points => new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  function addEnemy(x,z,rotation=0) {
    const enemy=spawnEnemy();enemy.object.position.set(x,0,z);enemy.object.rotation.set(0,rotation,0);enemy.actor.reset();return enemy;
  }
  function setup() {
    const c=active;
    hooks.stage();
    hooks.sound?.(c.type);
    clearEnemies();environment.setRadius(18);player.visible=true;player.position.set(0,0,4);player.rotation.set(0,0,0);playerActor.reset();
    camera.fov=c.type==='intro'?46:53;camera.updateProjectionMatrix();
    if(c.type==='intro') {
      addEnemy(0,-2.3,Math.PI);addEnemy(-3.8,-4.4,Math.PI-.25);addEnemy(3.3,-5,Math.PI+.2);
      c.path=curve([[3.8,3,8],[5.2,2.5,4],[2.5,1.9,1.4],[.65,1.65,.6]]);
      c.focus=curve([[0,1.4,1.5],[0,1.4,-.5],[0,1.45,-2],[0,1.47,-2.3]]);
      c.duration=8.4;
    } else if(c.type==='won') {
      const fallen=[[-2.6,2.5,.4],[3.2,.3,-.5],[-4.1,-2.5,1.2],[4.8,-4.4,-1.1],[-3.1,-6.8,.3],[5.5,4.8,2],[1.8,-9.3,1.8]];
      for(const [x,z,r] of fallen)addEnemy(x,z,r).actor.pose('death');
      c.path=curve([[.4,2,8],[1.1,2.6,10],[1.7,3.3,13],[1.2,4,16]]);c.duration=9;
    } else {
      for(let i=0;i<6;i++) {
        const a=i/6*Math.PI*2+.23,r=4.2+(i%2)*.35;
        const enemy=addEnemy(Math.sin(a)*r,4+Math.cos(a)*r);
        enemy.cinemaAngle=a;enemy.cinemaRadius=r;enemy.actor.update(i*.55,'dance');
      }
      c.path=curve([[-4.5,2.7,9],[-6,2.4,6],[-4.7,2.2,1.6],[-.8,2.5,-1.8],[4.6,3.2,1.8]]);c.duration=10;
    }
    c.time=0;play(0);
  }
  function play(dt) {
    const c=active;c.time+=dt;
    if(c.type==='intro') {
      const progress=ease(c.time/3.6);
      camera.position.copy(c.path.getPointAt(progress));camera.position.y+=Math.sin(c.time*.7)*.012;
      camera.lookAt(c.focus.getPointAt(progress));
      for(const enemy of enemies)enemy.actor.update(dt,'idle');
      playerActor.update(dt,'idle');
      subtitle.textContent=c.time>=3.6&&c.time<8.4?TAUNT:'';
    } else if(c.type==='won') {
      const progress=Math.min(1,c.time/c.duration);
      player.position.z=4-progress*10;
      playerActor.update(dt,'walk',.72);
      camera.position.copy(c.path.getPointAt(ease(progress)));camera.lookAt(player.position.x,1.1,player.position.z);
    } else {
      playerActor.update(dt,'death',1);
      for(const enemy of enemies) {
        const r=enemy.cinemaRadius-Math.min(c.time,8)*.14;
        enemy.object.position.set(Math.sin(enemy.cinemaAngle)*r,0,4+Math.cos(enemy.cinemaAngle)*r);
        enemy.object.rotation.y=Math.atan2(enemy.object.position.x,enemy.object.position.z-4);
        enemy.actor.update(dt,c.time<1.5?'walk':'dance',c.time<1.5?.65:1);
      }
      camera.position.copy(c.path.getPointAt(ease(c.time/c.duration)));camera.lookAt(0,.8,4);
    }
  }
  function completeShot() {
    subtitle.textContent='';frame.hidden=true;
    if(active.type==='intro')hooks.prepareGameplay();else hooks.showResult(active.type);
    active.phase='reveal';active.elapsed=0;
  }
  return {
    get active(){return !!active;},
    start(type) {
      active={type,phase:'cover',elapsed:0,time:0,duration:0,fadeStart:0,skip:false};
      frame.hidden=true;subtitle.textContent='';fade.style.opacity='0';
      hooks.enter();
    },
    skip() {
      if(!active||active.phase==='reveal'||active.phase==='out')return;
      if(active.phase==='cover'){active.skip=true;return;}
      active.phase='out';active.elapsed=0;active.fadeStart=Number(fade.style.opacity)||0;subtitle.textContent='';
    },
    cancel(){active=null;fade.style.opacity='0';frame.hidden=true;subtitle.textContent='';},
    update(dt) {
      if(!active||document.hidden)return;
      const c=active;c.elapsed+=dt;
      if(c.phase==='cover') {
        fade.style.opacity=String(ease(c.elapsed/.45));
        if(c.elapsed>=.45){setup();frame.hidden=false;c.phase=c.skip?'out':'in';c.elapsed=0;c.fadeStart=1;}
      } else if(c.phase==='in') {
        play(dt);fade.style.opacity=String(1-ease(c.elapsed/.8));
        if(c.elapsed>=.8){c.phase='shot';c.elapsed=0;fade.style.opacity='0';}
      } else if(c.phase==='shot') {
        play(dt);if(c.time>=c.duration){c.phase='out';c.elapsed=0;c.fadeStart=0;subtitle.textContent='';}
      } else if(c.phase==='out') {
        play(dt);subtitle.textContent='';fade.style.opacity=String(c.fadeStart+(1-c.fadeStart)*ease(c.elapsed/.75));
        if(c.elapsed>=.75){fade.style.opacity='1';completeShot();}
      } else if(c.phase==='reveal') {
        fade.style.opacity=String(1-ease(c.elapsed/.8));
        if(c.elapsed>=.8){const intro=c.type==='intro';active=null;fade.style.opacity='0';if(intro)hooks.beginGameplay();}
      }
    },
  };
}
