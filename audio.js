export function createGameAudio() {
  const music=document.getElementById('soundtrack');
  music.volume=.3;music.loop=true;
  let context=null,bus,noiseBuffer,ambientGain,muted=false,stopped=false,stepTime=0;
  let screamBuffer=null,screamLoading=null,screamSource=null,screamGain=null,screamToken=0;
  function setMuted(value) {
    muted=value;music.muted=muted;
    if(context)bus.gain.setTargetAtTime(muted||stopped?0:.65,context.currentTime,.035);
    for(const id of ['sound-toggle','hud-sound']) {
      const button=document.getElementById(id);
      button.setAttribute('aria-pressed',String(muted));
      button.setAttribute('aria-label',muted?'Unmute sound':'Mute sound');
      button.textContent=id==='sound-toggle'?`Sound: ${muted?'Off':'On'}`:muted?'♪̸':'♪';
    }
  }
  function initialize() {
    if(context)return;
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext)return;
    context=new AudioContext();bus=context.createGain();bus.gain.value=muted?0:.65;
    const limiter=context.createDynamicsCompressor();limiter.threshold.value=-16;limiter.ratio.value=5;
    bus.connect(limiter);limiter.connect(context.destination);
    noiseBuffer=context.createBuffer(1,context.sampleRate,context.sampleRate);
    const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    const source=context.createBufferSource(),filter=context.createBiquadFilter();
    source.buffer=noiseBuffer;source.loop=true;filter.type='bandpass';filter.frequency.value=1100;filter.Q.value=.45;
    ambientGain=context.createGain();ambientGain.gain.value=0;
    source.connect(filter);filter.connect(ambientGain);ambientGain.connect(bus);source.start();
    screamLoading=fetch('./assets/audio/power-scream.mp3').then(response=>{if(!response.ok)throw new Error('Scream audio unavailable');return response.arrayBuffer();}).then(data=>context.decodeAudioData(data)).then(buffer=>{screamBuffer=buffer;return buffer;}).catch(error=>{console.warn(error.message);return null;});
  }
  function unlock() {
    stopped=false;
    try{initialize();if(context?.state==='suspended')context.resume().catch(()=>{});if(context)bus.gain.setTargetAtTime(muted?0:.65,context.currentTime,.04);}catch(error){console.warn('Sound effects unavailable:',error.message);}
    if(music.paused)music.play().catch(()=>{});
  }
  function tone(frequency,end,duration,volume=.1,type='sine',delay=0) {
    if(!context||context.state!=='running'||muted||stopped)return;
    const at=context.currentTime+delay,osc=context.createOscillator(),gain=context.createGain();
    osc.type=type;osc.frequency.setValueAtTime(frequency,at);osc.frequency.exponentialRampToValueAtTime(Math.max(15,end),at+duration);
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.012);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    osc.connect(gain);gain.connect(bus);osc.start(at);osc.stop(at+duration+.02);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  function noise(duration,volume=.06,frequency=1500,filterType='lowpass',delay=0) {
    if(!context||context.state!=='running'||muted||stopped)return;
    const at=context.currentTime+delay,source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
    source.buffer=noiseBuffer;source.loop=true;filter.type=filterType;filter.frequency.setValueAtTime(frequency,at);filter.frequency.exponentialRampToValueAtTime(Math.max(90,frequency*.3),at+duration);
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+Math.min(.025,duration*.2));gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(filter);filter.connect(gain);gain.connect(bus);source.start(at);source.stop(at+duration+.03);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  function event(name) {
    if(name==='pulse'){tone(145,38,.35,.2);noise(.24,.11,4200,'bandpass');tone(650,120,.16,.035,'triangle');}
    else if(name==='impact'){noise(.17,.12,1200);tone(90,34,.2,.13);}
    else if(name==='hit'){noise(.1,.14,900);tone(75,32,.19,.17);}
    else if(name==='life'){tone(170,42,.55,.12,'triangle');}
    else if(name==='shrink'){noise(1.2,.05,2500,'bandpass');tone(95,40,.8,.075);noise(.28,.025,4800,'highpass',.35);}
    else if(name==='healing'){tone(620,630,.32,.06);tone(930,950,.5,.05,'sine',.13);}
    else if(name==='pickup'){[523,659,784].forEach((f,i)=>tone(f,f*1.01,.5,.07,'sine',i*.08));}
    else if(name==='intro'){noise(.8,.035,1800,'bandpass');tone(62,43,.9,.04);}
    else if(name==='won'){[261,329,392].forEach((f,i)=>tone(f,f,1,.055,'sine',i*.14));}
    else if(name==='lost'){tone(115,31,1.1,.11);noise(.45,.065,700);}
    else if(name==='select'){tone(480,330,.08,.025,'triangle');}
  }
  document.addEventListener('pointerdown',unlock,{capture:true});
  document.addEventListener('keydown',event=>{if(!event.repeat)unlock();},{capture:true});
  document.getElementById('sound-toggle').onclick=()=>setMuted(!muted);
  document.getElementById('hud-sound').onclick=()=>setMuted(!muted);
  setMuted(false);
  function stopPowerScream() {
    screamToken++;
    if(context&&screamSource){const source=screamSource;screamGain.gain.cancelScheduledValues(context.currentTime);screamGain.gain.setTargetAtTime(0,context.currentTime,.04);try{source.stop(context.currentTime+.15);}catch{}screamSource=null;}
    music.volume=.3;
  }
  return {
    event,unlock,
    powerScream(duration=6) {
      stopPowerScream();if(!context||stopped)return;
      const token=screamToken,start=context.currentTime;music.volume=.19;
      Promise.resolve(screamBuffer||screamLoading).then(buffer=>{
        if(!buffer||token!==screamToken||stopped)return;
        const offset=context.currentTime-start,remaining=duration-offset;if(remaining<=0)return;
        const source=context.createBufferSource(),gain=context.createGain(),at=context.currentTime;
        source.buffer=buffer;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.7,at+.05);
        gain.gain.setValueAtTime(.7,at+Math.max(.05,remaining-.8));gain.gain.linearRampToValueAtTime(0,at+remaining);
        source.connect(gain);gain.connect(bus);screamSource=source;screamGain=gain;
        source.start(at,offset);source.stop(at+remaining);
        source.onended=()=>{source.disconnect();gain.disconnect();if(screamSource===source)screamSource=null;};
      });
    },
    stopPowerScream,
    update(dt,{playing=false,moving=false,proximity=0,cinematic=false}={}) {
      if(context&&ambientGain){const level=playing?.002+Math.max(0,Math.min(1,proximity))*.016:cinematic?.0015:0;ambientGain.gain.setTargetAtTime(level,context.currentTime,.25);}
      if(playing&&moving){stepTime+=dt;if(stepTime>.38){stepTime=0;noise(.065,.024,520);tone(95,55,.07,.018);}}else stepTime=0;
    },
    stop(){stopPowerScream();stopped=true;music.pause();if(context){bus.gain.setTargetAtTime(0,context.currentTime,.04);ambientGain.gain.setTargetAtTime(0,context.currentTime,.04);}},
  };
}
