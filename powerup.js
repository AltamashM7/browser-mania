import { RULES } from './rules.js';

const ease = t => .5 - .5*Math.cos(Math.PI*Math.max(0,Math.min(1,t)));

export function createPowerUp(THREE,{scene,player,playerActor,camera,environment,audio,enter,restore,complete}) {
  const aura=new THREE.Group();player.add(aura);aura.visible=false;
  const uniforms={time:{value:0},strength:{value:0}};
  const flameMaterial=new THREE.ShaderMaterial({
    uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:`
      uniform float time;varying vec2 flameUV;
      void main(){
        flameUV=uv;vec3 p=position;float a=uv.x*6.283185;
        p.y+=pow(uv.y,3.0)*(sin(a*11.0+time*2.1)*0.22+sin(a*7.0-time*3.0)*0.15);
        p.xz*=1.0+sin(uv.y*8.0-time*4.0+a*2.0)*0.055;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }
    `,
    fragmentShader:`
      uniform float time;uniform float strength;varying vec2 flameUV;
      void main(){
        vec2 p=flameUV;float a=p.x*6.283185;
        float tip=0.74+0.14*sin(a*9.0+time*2.7)+0.095*sin(a*17.0-time*1.4);
        float flame=1.0-smoothstep(tip-0.085,tip+0.015,p.y);
        float strands=pow(0.5+0.5*sin(a*21.0+sin(p.y*11.0-time*5.0)*0.8),5.0);
        float rise=0.65+0.35*sin(p.y*19.0-time*7.0+a*3.0);
        float alpha=(0.09+strands*0.34)*flame*smoothstep(0.0,0.12,p.y)*strength*rise;
        vec3 gold=mix(vec3(1.0,0.28,0.015),vec3(1.0,0.88,0.3),p.y);
        gl_FragColor=vec4(gold*(1.1+strands),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const flame=new THREE.Mesh(new THREE.CylinderGeometry(.25,.95,2.8,64,24,true),flameMaterial);flame.position.y=1.3;flame.frustumCulled=false;aura.add(flame);
  const sparkGeometry=new THREE.BufferGeometry(),sparkPositions=[];
  for(let i=0;i<70;i++){const a=i*2.39996,r=.35+(i%9)*.075;sparkPositions.push(Math.sin(a)*r,(i*.37)%2.8,Math.cos(a)*r);}
  sparkGeometry.setAttribute('position',new THREE.Float32BufferAttribute(sparkPositions,3));
  const sparkMaterial=new THREE.ShaderMaterial({
    uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`uniform float time;varying float sparkFade;void main(){vec3 p=position;p.y=mod(p.y+time*1.8,2.8);sparkFade=sin(p.y/2.8*3.14159);p.xz*=1.0-p.y*0.13;vec4 view=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*view;gl_PointSize=clamp(14.0/-view.z,1.0,4.0);}`,
    fragmentShader:`uniform float strength;varying float sparkFade;void main(){float d=length(gl_PointCoord-0.5);gl_FragColor=vec4(1.0,0.79,0.18,(1.0-smoothstep(0.1,0.5,d))*strength*sparkFade*0.8);}`,
  });
  const sparks=new THREE.Points(sparkGeometry,sparkMaterial);sparks.frustumCulled=false;aura.add(sparks);
  const light=new THREE.PointLight(0xffc64d,0,7,2);light.position.y=1.2;aura.add(light);
  const fade=document.getElementById('scene-fade'),frame=document.getElementById('cinematic'),subtitle=document.getElementById('subtitle'),skip=document.querySelector('.skip-hint');
  let active=null,clock=0;
  function glow(dt,strength){clock+=dt;uniforms.time.value=clock;uniforms.strength.value=strength;aura.visible=strength>.001;light.intensity=strength*6;}
  function cleanup(){frame.hidden=true;subtitle.textContent='';skip.hidden=false;fade.style.opacity='0';}
  return {
    get transforming(){return !!active;},
    start(){
      active={phase:'cover',elapsed:0,time:0,position:camera.position.clone(),rotation:camera.quaternion.clone(),fov:camera.fov,angle:Math.atan2(camera.position.x-player.position.x,camera.position.z-player.position.z)};
      enter();frame.hidden=true;subtitle.textContent='';fade.style.opacity='0';
    },
    update(dt){
      if(!active||document.hidden)return;
      const c=active;c.elapsed+=dt;
      if(c.phase==='cover'){
        fade.style.opacity=String(ease(c.elapsed/.18));
        if(c.elapsed>=.18){c.phase='charge';c.elapsed=0;frame.hidden=false;skip.hidden=true;player.visible=true;camera.fov=52;camera.updateProjectionMatrix();playerActor.update(0,'power');audio.powerScream(RULES.powerTransform);}
      }else if(c.phase==='charge'){
        c.time=Math.min(RULES.powerTransform,c.time+dt);
        playerActor.update(dt,'power');
        const progress=c.time/RULES.powerTransform,angle=c.angle+ease(progress)*Math.PI*2;
        camera.position.set(player.position.x+Math.sin(angle)*3.8,2.05+Math.sin(progress*Math.PI)*.48,player.position.z+Math.cos(angle)*3.8);
        environment.constrainCamera(camera.position);camera.lookAt(player.position.x,1.25,player.position.z);
        glow(dt,ease(c.time/1.3));
        fade.style.opacity=String(c.time<.18?1-ease(c.time/.18):c.time>RULES.powerTransform-.2?ease((c.time-RULES.powerTransform+.2)/.2):0);
        if(c.time>=RULES.powerTransform){
          c.phase='reveal';c.elapsed=0;audio.stopPowerScream();camera.position.copy(c.position);camera.quaternion.copy(c.rotation);camera.fov=c.fov;camera.updateProjectionMatrix();frame.hidden=true;skip.hidden=false;restore();
        }
      }else{
        playerActor.update(dt,'idle');glow(dt,1);fade.style.opacity=String(1-ease(c.elapsed/.18));
        if(c.elapsed>=.18){active=null;cleanup();complete();}
      }
    },
    updateAura(dt,remaining){if(!active)glow(dt,ease(Math.min(1,remaining/.8)));},
    cancel(){if(active)audio.stopPowerScream();active=null;glow(0,0);cleanup();},
  };
}
