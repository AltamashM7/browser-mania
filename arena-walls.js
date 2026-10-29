import { zoneRadius } from './rules.js';

const extent = a => 26.8 + 2.3 * Math.sin(a * 3 + .7) + 1.6 * Math.cos(a * 5 - .9) + 1.2 * Math.sin(a + .4);

export function createArenaWalls(THREE, scene) {
  let seed = 73;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const uniforms = { time: { value: 0 } };
  const wallMaterial = new THREE.ShaderMaterial({
    uniforms, side: THREE.DoubleSide,
    vertexShader: `varying vec2 stoneUV; varying vec3 stoneNormal; void main() { stoneUV = uv; stoneNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; varying vec2 stoneUV; varying vec3 stoneNormal;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise2(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + 1.0), f.x), f.y);
      }
      float fbm(vec2 p) {
        float n = 0.0, w = 0.5;
        for(int i=0; i<4; i++) { n += noise2(p) * w; p = p * 2.07 + 3.1; w *= 0.5; }
        return n;
      }
      void main() {
        vec2 p = stoneUV;
        vec2 warp = vec2(fbm(p * 0.24), fbm(p * 0.24 + 8.3));
        vec2 veins = (p + warp * 2.1) * 0.65;
        vec2 cell = floor(veins), q = fract(veins);
        float first = 10.0, second = 10.0;
        for(int y=-1; y<=1; y++) {
          for(int x=-1; x<=1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 offset = vec2(hash(cell+g), hash(cell+g+19.7));
            float d = length(g + 0.12 + offset * 0.76 - q);
            if(d < first) { second = first; first = d; } else { second = min(second,d); }
          }
        }
        float fracture = second - first;
        float reveal = smoothstep(0.47, 0.69, fbm(p * 0.19 + vec2(time * 0.035, -time * 0.018)));
        float breath = 0.55 + 0.45 * sin(time * 0.72 + fbm(p * 0.12) * 16.0);
        float energy = reveal * breath;
        float core = exp(-fracture * 160.0) * energy;
        float halo = exp(-fracture * 19.0) * energy;
        float damp = fbm(vec2(p.x * 0.7, p.y * 0.12));
        float light = 0.7 + 0.3 * abs(dot(normalize(stoneNormal), normalize(vec3(0.3,0.1,0.8))));
        vec3 stone = mix(vec3(0.025,0.029,0.043),vec3(0.092,0.089,0.112),damp) * light;
        stone *= 0.82 + noise2(p * 27.0) * 0.24;
        stone *= 1.0 - exp(-fracture * 95.0) * 0.7;
        stone *= 0.65 + 0.35 * smoothstep(0.0,4.0,p.y);
        vec3 color = stone + vec3(0.78,0.025,0.34) * halo * 0.8 + vec3(1.0,0.53,0.77) * core * 2.5;
        gl_FragColor = vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const vertices = [], uv = [], outline = [], count = 38;
  for (let i=0;i<count;i++) { const a=i/count*Math.PI*2; outline.push(new THREE.Vector3(Math.sin(a)*extent(a),-.25,Math.cos(a)*extent(a))); }
  let length=0;
  const heights=outline.map((_,i)=>12+random()*7+(i>14&&i<19?-6:0));
  for(let i=0;i<count;i++) {
    const a=outline[i],b=outline[(i+1)%count],w=a.distanceTo(b);
    const ta=a.clone().multiplyScalar(1.015).setY(heights[i]),tb=b.clone().multiplyScalar(1.015).setY(heights[(i+1)%count]);
    for(const p of [a,b,ta,b,tb,ta])vertices.push(p.x,p.y,p.z);
    uv.push(length,0,length+w,0,length,ta.y,length+w,0,length+w,tb.y,length,ta.y);length+=w;
  }
  const wallGeo=new THREE.BufferGeometry();wallGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));wallGeo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));wallGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(wallGeo,wallMaterial));

  // Painted wear, water stains and branching cracks, with no external texture load.
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#48464c';ctx.fillRect(0,0,1024,1024);
  for(let i=0;i<9000;i++){const v=Math.floor(60+random()*55);ctx.fillStyle=`rgba(${v},${v},${v+4},0.12)`;ctx.fillRect(random()*1024,random()*1024,2+random()*9,1+random()*5);}
  for(let i=0;i<100;i++) {
    const x=random()*1024,y=random()*1024,r=15+random()*90,g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,'#15151b30');g.addColorStop(1,'#15151b00');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);
  }
  for(let i=0;i<36;i++) {
    let x=random()*1024,y=random()*1024,a=random()*7;ctx.strokeStyle='#16141d80';ctx.lineWidth=.5+random()*1.8;ctx.beginPath();ctx.moveTo(x,y);
    for(let j=0;j<12;j++){a+=(random()-.5)*1.3;x+=Math.cos(a)*(7+random()*16);y+=Math.sin(a)*(7+random()*16);ctx.lineTo(x,y);}ctx.stroke();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(.022,.022);texture.anisotropy=4;
  const stoneMaterial=new THREE.MeshStandardMaterial({color:0xb2adb8,map:texture,roughness:.84,metalness:.12});
  const shape=new THREE.Shape();outline.forEach((p,i)=>i?shape.lineTo(p.x,-p.z):shape.moveTo(p.x,-p.z));shape.closePath();
  const floor=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.85,bevelEnabled:false}),stoneMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-.85;floor.receiveShadow=true;scene.add(floor);
  const rubbleMaterial=new THREE.MeshStandardMaterial({color:0x34313c,roughness:.95,flatShading:true});
  const rubbleGeo=new THREE.DodecahedronGeometry(1,0),rp=rubbleGeo.attributes.position;
  for(let i=0;i<rp.count;i++){const x=rp.getX(i),y=rp.getY(i),z=rp.getZ(i),n=1+.17*Math.sin(x*21+y*13+z*7);rp.setXYZ(i,x*n,y*n,z*n);}rubbleGeo.computeVertexNormals();
  const rubble=new THREE.InstancedMesh(rubbleGeo,rubbleMaterial,135);rubble.castShadow=true;rubble.receiveShadow=true;
  const object=new THREE.Object3D();
  for(let i=0;i<135;i++) {
    const a=random()*Math.PI*2,r=extent(a)-1.5-random()*3.5,s=.12+random()*.7;
    object.position.set(Math.sin(a)*r,s*.3-.04,Math.cos(a)*r);object.rotation.set(random(),random()*6,random());object.scale.set(s*(1+random()),s*.5,s);object.updateMatrix();rubble.setMatrixAt(i,object.matrix);
  }scene.add(rubble);
  const obstacles=[];
  function ruin(x,z,w,h,d,tilt) {
    const geometry=new THREE.BoxGeometry(w,h,d,3,3,2),p=geometry.attributes.position;
    for(let i=0;i<p.count;i++){const vx=p.getX(i),vy=p.getY(i),vz=p.getZ(i);p.setXYZ(i,vx+Math.sin(vy*4+vz*6)*.09,vy+Math.sin(vx*9+vz*5)*.13,vz+Math.cos(vx*7+vy*3)*.08);}geometry.computeVertexNormals();
    const block=new THREE.Mesh(geometry,stoneMaterial);block.position.set(x,h*.5-.08,z);block.rotation.set(tilt*.35,tilt,tilt*.12);block.castShadow=true;block.receiveShadow=true;scene.add(block);obstacles.push({x,z,r:Math.max(w,d)*.55});return block;
  }
  ruin(-12,-13,1.6,7,1.9,.12);ruin(-8.8,-14.5,1.4,4.7,1.7,-.16);
  const lintel=ruin(-10.5,-14.2,6.8,.9,1.6,.25);lintel.position.y=5.2;obstacles.pop();
  ruin(13,-9,3.7,.8,1.4,-.4);ruin(16,6,1.8,3.4,1.8,.18);ruin(-14,8,2.5,1.1,1.5,.45);ruin(6,19,6,.6,2.2,-.3);
  for(let i=0;i<24;i++) {
    const a=random()*6.28,r=10+random()*11;
    const slab=new THREE.Mesh(new THREE.BoxGeometry(1.2+random()*2.8,.05+random()*.06,.25+random()*.8),rubbleMaterial);slab.position.set(Math.sin(a)*r,.01,Math.cos(a)*r);slab.rotation.y=random()*6.28;slab.receiveShadow=true;scene.add(slab);
  }
  const boundaryGeo=new THREE.BufferGeometry(),boundaryPositions=new Float32Array(128*18);boundaryGeo.setAttribute('position',new THREE.BufferAttribute(boundaryPositions,3));
  const boundaryMaterial=new THREE.MeshBasicMaterial({color:0xff548f,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false});
  const boundary=new THREE.Mesh(boundaryGeo,boundaryMaterial);boundary.frustumCulled=false;scene.add(boundary);
  const curtainGeometry=new THREE.BufferGeometry(),curtainPositions=new Float32Array(128*18),curtainUV=[];
  curtainGeometry.setAttribute('position',new THREE.BufferAttribute(curtainPositions,3));
  for(let i=0;i<128;i++)curtainUV.push(i/128,0,(i+1)/128,0,i/128,1,(i+1)/128,0,(i+1)/128,1,i/128,1);
  curtainGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(curtainUV,2));
  const curtainMaterial=new THREE.ShaderMaterial({
    uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`varying vec2 barrierUV;void main(){barrierUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`
      uniform float time;varying vec2 barrierUV;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){
        vec2 p=barrierUV;
        float topFade=1.0-smoothstep(0.12,1.0,p.y);
        float scan=pow(0.5+0.5*sin(p.y*125.0-time*3.0),16.0);
        float strip=floor(p.y*28.0);
        float jump=step(0.91,hash(vec2(strip,floor(time*4.0))));
        float cells=hash(floor(vec2(p.x*180.0+jump*3.0,p.y*18.0))+floor(time*2.5));
        float fragments=step(0.94,cells);
        float base=exp(-p.y*15.0);
        float alpha=(0.075+scan*0.08+fragments*0.18+jump*0.025+base*0.12)*topFade;
        vec3 color=mix(vec3(0.5,0.035,0.23),vec3(1.0,0.46,0.7),scan*0.5+fragments*0.4+base*0.4);
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const curtain=new THREE.Mesh(curtainGeometry,curtainMaterial);curtain.frustumCulled=false;scene.add(curtain);
  function setRadius(radius) {
    let offset=0;
    const point=(i,extra)=>{const a=i/128*Math.PI*2,r=zoneRadius(a,radius)+extra;return [Math.sin(a)*r,.035,Math.cos(a)*r];};
    for(let i=0;i<128;i++)for(const p of [point(i,-.035),point(i+1,-.035),point(i,.035),point(i+1,-.035),point(i+1,.035),point(i,.035)])for(const n of p)boundaryPositions[offset++]=n;
    boundaryGeo.attributes.position.needsUpdate=true;
    offset=0;
    const wallPoint=(i,y)=>{const a=i/128*Math.PI*2,r=zoneRadius(a,radius);return [Math.sin(a)*r,y,Math.cos(a)*r];};
    for(let i=0;i<128;i++)for(const p of [wallPoint(i,.04),wallPoint(i+1,.04),wallPoint(i,3.4),wallPoint(i+1,.04),wallPoint(i+1,3.4),wallPoint(i,3.4)])for(const n of p)curtainPositions[offset++]=n;
    curtainGeometry.attributes.position.needsUpdate=true;
  }
  setRadius(18);let elapsed=0;
  return {
    setRadius,
    update(dt){elapsed+=dt;uniforms.time.value=elapsed;boundaryMaterial.opacity=.65+Math.sin(elapsed*2)*.12;},
    constrain(position,margin=.55){
      const a=Math.atan2(position.x,position.z),r=Math.hypot(position.x,position.z),max=extent(a)-1.6-margin;
      if(r>max){position.x*=max/r;position.z*=max/r;}
      for(const o of obstacles){const dx=position.x-o.x,dz=position.z-o.z,d=Math.hypot(dx,dz),limit=o.r+margin;if(d<limit){position.x=o.x+(d?dx/d:1)*limit;position.z=o.z+(d?dz/d:0)*limit;}}
    },
    constrainCamera(position){const a=Math.atan2(position.x,position.z),r=Math.hypot(position.x,position.z),max=extent(a)-1;if(r>max){position.x*=max/r;position.z*=max/r;}position.y=Math.max(.5,position.y);},
  };
}
