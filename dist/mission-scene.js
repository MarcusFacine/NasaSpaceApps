import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RADIUS_KM, siteBasis } from './model.js';
import { EARTH_RADIUS, APOLLO, moonPosition, parkingPath, parkingState, toInertial } from './mission-model.js';
import { cloudMaterial, lunarMaterial, regolithNormalMap, detailedTerrainGeometry, contextTerrainGeometry, innerTerrainGeometry } from './lunar-surface.js';
import { loadStarCatalog, createStarField, setRotationRows } from './stars.js';
import { Spacecraft, createMaterials, makeEnvironment, buildDescentStage } from './spacecraft.js';
import { LandingSite } from './landing-site.js';

const asset=path=>new URL(path,import.meta.url).href;
const v=a=>new THREE.Vector3(a[0],a[2],-a[1]);
const space=a=>v(a).multiplyScalar(.001);
const Y=new THREE.Vector3(0,1,0);
const LUNAR_PHASES=new Set(['loi','lunarOrbit','descent','surface','ascent','lunarReturnOrbit','tei']);
const EARTH_PHASES=new Set(['launch','earthOrbit','tli','arrival']);
const ASCENT_BASE=.00315; // the ascent stage sits 3.15 m up, on the descent stage
const LOCAL_VIEW=new THREE.Vector3(.032,.009,.044); // ~55 m from the lander, 13 m up: a photographer on the ground
// Same distance, placed so the Sun comes from the side and a little behind: shadows run across the picture.
function sideLitView(sun){const h=new THREE.Vector3(sun[0],0,sun[2]);if(h.lengthSq()<1e-8)return LOCAL_VIEW.clone();h.normalize().applyAxisAngle(Y,1.95);return h.multiplyScalar(.0545).setY(.009);}
function mesh(geometry,material,parent,position){const m=new THREE.Mesh(geometry,material);if(position)m.position.set(...position);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}

// Water normals: a few crossing swell trains plus chop, tileable.
function waterNormalMap(size=256){
  const h=new Float32Array(size*size),TAU=Math.PI*2;
  const waves=[[3,1,1],[2,-3,.6],[5,2,.35],[-4,5,.25],[9,-7,.12],[13,11,.08]];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){let s=0;for(const [a,b,amp] of waves)s+=amp*Math.sin(TAU*(a*x+b*y)/size+a*1.7);h[y*size+x]=s;}
  const data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const l=h[y*size+(x+size-1)%size],r=h[y*size+(x+1)%size],u=h[((y+size-1)%size)*size+x],d=h[((y+1)%size)*size+x];
    const nx=(l-r)*1.4,ny=(u-d)*1.4,len=Math.hypot(nx,ny,1),i=(y*size+x)*4;
    data[i]=(nx/len*.5+.5)*255;data[i+1]=(ny/len*.5+.5)*255;data[i+2]=(1/len*.5+.5)*255;data[i+3]=255;
  }
  const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.anisotropy=8;t.needsUpdate=true;return t;
}

export class MissionScene {
  constructor(canvas,container,terrain,onError,{t=k=>k}={}){
    this.t=t;this.container=container;this.terrain=terrain;this.mode='auto';this.dirty=true;this.disposed=false;this.cameraKey='';
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;this.renderer.setClearColor(0x000000);this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(45,1,.001,10000);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=false;this.controls.addEventListener('change',()=>{this.dirty=true;});this.controls.addEventListener('start',()=>{this.cameraTween=null;this.manualCamera=true;});
    this.world=new THREE.Group();this.local=new THREE.Group();this.oceanGroup=new THREE.Group();this.scene.add(this.world,this.local,this.oceanGroup);
    this.sunlight=new THREE.DirectionalLight(0xfff6e4,3.2);this.sunlight.shadow.mapSize.set(4096,4096);this.sunlight.shadow.normalBias=.00004;this.sunlight.shadow.bias=-.00002;this.scene.add(this.sunlight,this.sunlight.target);
    this.fill=new THREE.AmbientLight(0xa4c2df,.03);this.scene.add(this.fill);
    // Reading light, only when the destination is in shadow; the scale label says so.
    this.earthlight=new THREE.DirectionalLight(0x9fc4ff,0);this.scene.add(this.earthlight,this.earthlight.target);
    // What polished metal reflects: regolith near the Moon, oceans and clouds near the Earth, sky over the Pacific.
    this.envs={moon:makeEnvironment(this.renderer,{ground:[.34,.33,.31]}),earth:makeEnvironment(this.renderer,{ground:[.12,.2,.34],horizon:[.4,.52,.72]}),space:makeEnvironment(this.renderer,{sky:[.02,.02,.025],ground:[.07,.07,.075]}),ocean:makeEnvironment(this.renderer,{sky:[.28,.46,.75],ground:[.03,.09,.16],horizon:[.78,.86,.95]})};
    this.materials=createMaterials(this.envs.space.texture);this.envName='space';
    const loader=new THREE.TextureLoader(),anisotropy=this.renderer.capabilities.getMaxAnisotropy();
    this.moonTexture=loader.load(asset('./assets/moon-color.jpg'),()=>this.dirty=true,undefined,()=>onError(t('error.moonTexture')));this.moonTexture.colorSpace=THREE.SRGBColorSpace;this.moonTexture.wrapS=THREE.RepeatWrapping;this.moonTexture.anisotropy=anisotropy;
    this.earthTexture=loader.load(asset('./assets/earth-color.jpg'),()=>this.dirty=true,undefined,()=>onError(t('error.earthTexture')));this.earthTexture.colorSpace=THREE.SRGBColorSpace;this.earthTexture.anisotropy=anisotropy;
    this.makeEarth(loader);
    this.moon=mesh(new THREE.SphereGeometry(RADIUS_KM/1000,160,120),lunarMaterial({vertexColors:false,map:this.moonTexture,color:0xf2efe8}),this.world);
    this.localEarth=mesh(new THREE.SphereGeometry(1,48,32),new THREE.MeshStandardMaterial({map:this.earthTexture,roughness:.85}),this.local);
    this.vehicle=new Spacecraft(this.materials);this.world.add(this.vehicle.group);
    this.localVehicle=new Spacecraft(this.materials);this.local.add(this.localVehicle.group);
    this.descentLeft=new THREE.Group();this.descentLeft.scale.setScalar(.001);this.descentLeft.add(buildDescentStage(this.materials));this.descentLeft.visible=false;this.local.add(this.descentLeft);
    this.makeTerrain(terrain);this.makeOcean();
    this.trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.8}));this.world.add(this.trail);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
    this.canvas=canvas;this.onContextLost=e=>{e.preventDefault();this.contextLost=true;if(!this.disposed)onError(t('error.contextLost'));};canvas.addEventListener('webglcontextlost',this.onContextLost);
    loadStarCatalog().then(data=>{if(!data||this.disposed)return;this.stars=createStarField(data,4000);this.stars.material.uniforms.uPixelRatio.value=this.renderer.getPixelRatio();setRotationRows(this.stars,[1,0,0],[0,0,1],[0,-1,0]);this.stars.visible=this.world.visible;this.scene.add(this.stars);this.dirty=true;});
    this.render=now=>{
      if(this.disposed)return;now=now??performance.now();this.animateCamera(now);
      // Moving dust and waves keep drawing while they are on screen.
      if(this.dustLevel>.02&&this.local.visible){this.landing.updateDust(this.dustLevel,now/1000);this.dirty=true;}
      if(this.oceanGroup.visible){this.water.material.normalMap.offset.set(now*.0000045,now*.0000031);this.dirty=true;}
      if(this.dirty&&!document.hidden&&!this.contextLost){
        if(this.stars){this.stars.matrix.setPosition(this.camera.position);this.stars.matrixWorldNeedsUpdate=true;}
        this.camera.updateMatrixWorld();this.sunView.value.copy(this.sunWorld).transformDirection(this.camera.matrixWorldInverse);
        this.renderer.render(this.scene,this.camera);this.labels();this.dirty=false;
      }
      this.frame=requestAnimationFrame(this.render);
    };this.render();
  }
  makeEarth(loader){
    // Same Earth as the explorer: city lights only on the night side, clouds, a thin blue limb.
    const lights=loader.load(asset('./assets/earth-lights.png'),()=>this.dirty=true);lights.colorSpace=THREE.SRGBColorSpace;
    const clouds=loader.load(asset('./assets/earth-clouds.png'),()=>this.dirty=true);
    this.earthExtras=[lights,clouds];this.sunWorld=new THREE.Vector3(1,0,0);this.sunView={value:new THREE.Vector3(0,0,1)};
    const material=new THREE.MeshStandardMaterial({map:this.earthTexture,roughness:.85,metalness:0,emissive:0xffc98a,emissiveMap:lights,emissiveIntensity:1.4});
    material.onBeforeCompile=shader=>{shader.uniforms.uSunView=this.sunView;shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 uSunView;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(.06, -.22, dot(normalize(vNormal), uSunView));');};
    const r=EARTH_RADIUS/1000;this.earth=mesh(new THREE.SphereGeometry(r,128,96),material,this.world);this.earth.castShadow=false;
    const cloudShell=new THREE.Mesh(new THREE.SphereGeometry(r*1.0016,128,96),cloudMaterial(clouds));this.earth.add(cloudShell);
    const limb=new THREE.Mesh(new THREE.SphereGeometry(r*1.022,96,64),new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.BackSide,uniforms:{uSunView:this.sunView},
      vertexShader:'varying vec3 vN;varying vec3 vV;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
      fragmentShader:'uniform vec3 uSunView;varying vec3 vN;varying vec3 vV;void main(){float rim=pow(1.-abs(dot(vN,vV)),2.2);float lit=smoothstep(-.35,.35,dot(-vN,uSunView));gl_FragColor=vec4(vec3(.35,.6,1.)*rim*lit*1.6,rim*lit);}'}));
    this.earth.add(limb);
  }
  makeTerrain(terrain){
    // Same LOLA relief as the explorer; around the destination, the landing site at lander scale.
    this.regolith=regolithNormalMap(512,11,{craters:0});
    this.landing=new LandingSite(terrain,{seed:[...terrain.site.id].reduce((s,c)=>s+c.charCodeAt(0),0)});this.local.add(this.landing.group);
    mesh(detailedTerrainGeometry(terrain),lunarMaterial({normalMap:this.regolith,normalScale:.3}),this.local);
    const inner=innerTerrainGeometry(terrain,{hole:this.landing.half});if(inner)mesh(inner,lunarMaterial({normalMap:this.regolith,normalScale:.32}),this.local);
    const context=contextTerrainGeometry(terrain);if(context)mesh(context,lunarMaterial({normalMap:null}),this.local);
    this.groundY=this.landing.heightAt(0,0);this.descentLeft.position.set(0,this.groundY,0);
  }
  makeOcean(){
    // Pacific recovery area: sky dome, sea with moving swell, the command module under its parachutes.
    const g=this.oceanGroup;g.visible=false;
    this.skyUniforms={uZenith:{value:new THREE.Color(.16,.34,.66)},uHorizon:{value:new THREE.Color(.72,.82,.92)},uSun:{value:new THREE.Vector3(0,1,0)},uGlow:{value:new THREE.Color(1,.92,.8)}};
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(90,48,24),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:this.skyUniforms,
      vertexShader:'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'uniform vec3 uZenith,uHorizon,uSun,uGlow;varying vec3 vDir;void main(){float y=max(vDir.y,0.);vec3 c=mix(uHorizon,uZenith,pow(y,.55));float s=max(dot(vDir,normalize(uSun)),0.);c+=uGlow*(pow(s,600.)*4.+pow(s,12.)*.25);if(vDir.y<0.)c=uHorizon*.55;gl_FragColor=vec4(c,1.);}'}));
    g.add(this.sky);
    const water=new THREE.MeshStandardMaterial({color:0x14405f,roughness:.09,metalness:0,normalMap:waterNormalMap(),normalScale:new THREE.Vector2(.55,.55)});water.normalMap.repeat.set(1600,1600);
    this.water=new THREE.Mesh(new THREE.PlaneGeometry(160,160),water);this.water.rotation.x=-Math.PI/2;this.water.receiveShadow=true;g.add(this.water);
    this.oceanVehicle=new Spacecraft(this.materials);this.oceanVehicle.set('cmChutes');g.add(this.oceanVehicle.group);
    const c=document.createElement('canvas');c.width=c.height=128;const g2=c.getContext('2d'),gr=g2.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(.3,'rgba(255,255,255,.55)');gr.addColorStop(.45,'rgba(240,246,248,.25)');gr.addColorStop(1,'rgba(240,246,248,0)');g2.fillStyle=gr;g2.fillRect(0,0,128,128);
    this.foamMap=new THREE.CanvasTexture(c);this.foam=new THREE.Mesh(new THREE.PlaneGeometry(.016,.016),new THREE.MeshBasicMaterial({map:this.foamMap,transparent:true,opacity:0,depthWrite:false}));this.foam.rotation.x=-Math.PI/2;this.foam.position.y=.00005;g.add(this.foam);
    this.oceanFog=new THREE.Fog(0xb9cde0,4,70);
  }
  oceanSky(date){
    // Real Sun over the splashdown point at that UTC time (day, twilight or night).
    const A=window.Astronomy,site=this.plan.entry.to,observer=new A.Observer(site.lat,site.lon,0);
    const eq=A.Equator(A.Body.Sun,date,observer,true,true),hor=A.Horizon(date,observer,eq.ra,eq.dec,'normal');
    const alt=hor.altitude*Math.PI/180,az=hor.azimuth*Math.PI/180,dir=new THREE.Vector3(Math.sin(az)*Math.cos(alt),Math.sin(alt),-Math.cos(az)*Math.cos(alt));
    const day=THREE.MathUtils.smoothstep(hor.altitude,-6,8),dusk=Math.max(0,1-Math.abs(hor.altitude-2)/10);
    this.skyUniforms.uSun.value.copy(dir);
    this.skyUniforms.uZenith.value.setRGB(.02+.14*day,.035+.31*day,.08+.58*day);
    this.skyUniforms.uHorizon.value.setRGB(.06+.66*day+.3*dusk,.08+.74*day+.1*dusk,.14+.78*day-.05*dusk);
    this.oceanFog.color.copy(this.skyUniforms.uHorizon.value);
    return {dir,day,altitude:hor.altitude};
  }
  setPlan(plan){
    this.plan=plan;this.cameraKey='';this.cameraTween=null;this.lastLocal=undefined;this.lastOcean=undefined;
    for(const line of this.pathLines||[]){this.world.remove(line);line.geometry.dispose();line.material.dispose();}
    this.pathLines=[plan.outboundPath,plan.inboundPath].map((points,i)=>{const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(space)),new THREE.LineBasicMaterial({color:i?0xd9d4ca:0xffffff,transparent:true,opacity:.62}));this.world.add(line);return line;});
    this.parkingLines=[plan.earthParking,plan.lunarParking,plan.lunarReturnParking].map((orbit,i)=>{
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(parkingPath(orbit).map(space)),new THREE.LineBasicMaterial({color:i===0?0xff5c9a:0xd9d4ca,transparent:true,opacity:.85}));
      this.world.add(line);this.pathLines.push(line);return line;
    });
    const orbit=Array.from({length:65},(_,i)=>space(moonPosition(new Date(plan.launch+(plan.returnAt-plan.launch)*i/64),window.Astronomy)));
    this.bounds=new THREE.Box3().setFromPoints([...plan.outboundPath.map(space),...plan.inboundPath.map(space),...orbit,new THREE.Vector3(-7,-7,-7),new THREE.Vector3(7,7,7)]).getBoundingSphere(new THREE.Sphere());
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbit),new THREE.LineDashedMaterial({color:0x77776f,dashSize:1,gapSize:1,transparent:true,opacity:.4}));line.computeLineDistances();this.world.add(line);this.pathLines.push(line);this.dirty=true;
  }
  setMode(mode){this.mode=mode;this.cameraKey='';if(this.sample)this.update(this.sample,this.conditions,true);}
  update(sample,conditions,reset=false){
    const previous=this.sample;this.sample=sample;this.conditions=conditions;
    const ocean=sample.ocean&&this.mode!=='overview',local=sample.local&&this.mode!=='overview'&&!ocean,world=!local&&!ocean;
    this.world.visible=world;this.local.visible=local;this.oceanGroup.visible=ocean;if(this.stars)this.stars.visible=world;
    this.scene.fog=ocean?this.oceanFog:null;
    if(ocean!==this.lastOcean&&this.lastOcean!==undefined)reset=true;
    const envName=ocean?'ocean':LUNAR_PHASES.has(sample.phase)?'moon':EARTH_PHASES.has(sample.phase)?'earth':'space';
    if(envName!==this.envName){this.envName=envName;this.materials.setEnvironment(this.envs[envName].texture);}
    this.moon.position.copy(space(sample.moon));
    this.parkingLines[1].position.copy(this.moon.position);this.parkingLines[2].position.copy(this.moon.position);
    this.parkingLines[1].visible=+sample.date<=this.plan.departure;this.parkingLines[2].visible=+sample.date>=this.plan.departure;
    const f=sample.frame,matrix=new THREE.Matrix4().makeBasis(v(f.x),v(f.z),v(f.y).negate());this.moon.quaternion.setFromRotationMatrix(matrix);
    // Greenwich faces the sidereal angle (precession ignored: visual only).
    this.earth.rotation.y=window.Astronomy.SiderealTime(sample.date)*Math.PI/12;
    // Vehicle: the stage, module or capsule flying at this moment of the Apollo profile.
    this.vehicle.set(sample.config);this.vehicle.engine(sample.throttle||0);this.vehicle.plasma(sample.plasma||0);
    this.vehicle.group.position.copy(space(sample.position));this.vehicle.group.quaternion.setFromUnitVectors(Y,v(sample.attitude||sample.direction).normalize());
    const localTarget=sample.localPosition?new THREE.Vector3(...sample.localPosition):new THREE.Vector3(0,sample.altitudeKm,0);
    localTarget.y+=this.groundY;
    const lv=this.localVehicle;lv.set(sample.config==='ascent'?'ascent':'lm');lv.engine(local?sample.throttle||0:0);
    lv.group.position.copy(localTarget);if(sample.config==='ascent')lv.group.position.y+=ASCENT_BASE;
    if(sample.localDirection)lv.group.quaternion.setFromUnitVectors(Y,new THREE.Vector3(...sample.localDirection).normalize());
    this.descentLeft.visible=sample.phase==='ascent'||sample.phase==='lunarReturnOrbit';
    // Engine-blown regolith below ~30 m on landing, and when the ascent engine fires on the descent stage.
    this.dustLevel=!local?0:sample.phase==='descent'&&sample.engine?Math.max(0,1-sample.altitudeKm/.03)*(.4+.6*(sample.throttle||0)):sample.phase==='ascent'?Math.max(0,1-sample.altitudeKm/.012)*.5:0;
    if(this.dustLevel<=.02)this.landing.dust.visible=false;
    let sky=null;
    if(ocean){
      sky=this.oceanSky(sample.date);const ov=this.oceanVehicle;ov.chutes(sample.chutes);
      ov.group.position.set(0,sample.altitudeKm,0);ov.group.rotation.set(0,.6,0);
      const near=Math.max(0,1-sample.altitudeKm/.004);this.foam.material.opacity=sample.altitudeKm<.0005?.85*(1-sample.altitudeKm/.0005):0;this.foam.scale.setScalar(1+near*.3);
    }
    // Light.
    const earthHelio=window.Astronomy.HelioVector(window.Astronomy.Body.Earth,sample.date);
    const sunWorld=v([earthHelio.x,earthHelio.y,earthHelio.z]).negate().normalize();this.sunWorld.copy(sunWorld);
    const sun=ocean?sky.dir.clone():local?new THREE.Vector3(...conditions.sun.direction):sunWorld.clone();
    this.sunlight.intensity=ocean?3*sky.day:local?2.7*conditions.sun.diskFraction:3.2;
    this.fill.intensity=ocean?.16+.3*sky.day:.03;this.fill.color.set(ocean?0xbcd2ea:0xa4c2df);
    const anchor=ocean?this.oceanVehicle.group.position:local?localTarget:this.moon.position.clone().multiplyScalar(.5);
    this.sunlight.target.position.copy(anchor);this.sunlight.position.copy(anchor).add(sun.multiplyScalar(local?200:ocean?40:1000));this.sunlight.castShadow=local;
    const dark=local&&conditions.sun.diskFraction===0;this.earthlight.intensity=dark?.7:0;
    if(local){this.earthlight.target.position.copy(localTarget);this.earthlight.position.copy(localTarget).add(new THREE.Vector3(...conditions.earth.direction).multiplyScalar(200));}
    if(local){Object.assign(this.sunlight.shadow.camera,{left:-.45,right:.45,top:.45,bottom:-.45,near:.01,far:500});this.sunlight.shadow.camera.updateProjectionMatrix();this.localEarth.position.copy(new THREE.Vector3(...conditions.earth.direction).multiplyScalar(350));this.localEarth.scale.setScalar(350*EARTH_RADIUS/conditions.earth.distanceKm);}
    this.renderer.toneMappingExposure=local?.92:1;
    // Camera.
    const orbit=this.orbitForPhase(sample),key=ocean?'ocean':local?'local':this.mode==='overview'?'overview':this.mode==='follow'?'follow':orbit?`orbit-${orbit===this.plan.lunarReturnParking?'return':orbit.body}`:sample.phase;
    const target=ocean?this.oceanVehicle.group.position.clone().add(new THREE.Vector3(0,.021,0)):local?lv.group.position.clone().add(new THREE.Vector3(0,.004,0)):null;
    if(reset||key!==this.cameraKey){
      const blend=!reset&&Boolean(this.cameraKey)&&!ocean,from={position:this.camera.position.clone(),target:this.controls.target.clone(),up:this.camera.up.clone()};
      if(blend&&!this.lastLocal&&this.lastPosition&&previous){const oldOrbit=this.orbitForPhase(previous),delta=oldOrbit?(oldOrbit.body==='Moon'?space(sample.moon.map((x,i)=>x-previous.moon[i])):new THREE.Vector3()):space(sample.position.map((x,i)=>x-previous.position[i]));from.position.add(delta);from.target.add(delta);}
      if(blend&&local!==this.lastLocal){from.position=this.convertView(from.position,sample,local);from.target=this.convertView(from.target,sample,local);from.up=this.convertView(from.up,sample,local,true).normalize();}
      this.cameraKey=key;this.setCamera(sample,local,ocean,target);
      this.manualCamera=false;this.cameraTween=null;
      if(blend){this.cameraTween={from,to:{position:this.camera.position.clone(),target:this.controls.target.clone(),up:this.camera.up.clone()},start:performance.now(),local,duration:1800};this.animateCamera(performance.now());}
    }
    else if(this.lastPosition){
      const follow=target||(this.mode==='overview'||['outbound','inbound'].includes(sample.phase)&&this.mode==='auto'?null:
        this.mode==='auto'&&this.orbitForPhase(sample)?(this.orbitForPhase(sample).body==='Earth'?new THREE.Vector3():this.moon.position):this.vehicle.group.position);
      if(follow){const delta=follow.clone().sub(this.lastPosition);this.camera.position.add(delta);this.controls.target.add(delta);if(this.cameraTween)for(const pose of [this.cameraTween.from,this.cameraTween.to]){pose.position.add(delta);pose.target.add(delta);}
        if(ocean&&this.camera.position.y<.003)this.camera.position.y=.003;this.controls.update();this.lastPosition=follow.clone();}
    }
    if(world&&this.mode==='auto'&&['descent','ascent'].includes(sample.phase)&&!this.manualCamera){
      const pose=this.flightCameraPose(sample);
      if(this.cameraTween)this.cameraTween.to=pose;
      else{this.camera.position.copy(pose.position);this.controls.target.copy(pose.target);this.camera.up.copy(pose.up);this.controls.update();}
    }
    this.lastLocal=local;this.lastOcean=ocean;
    this.trail.geometry.dispose();let points=sample.phase==='outbound'?this.plan.outboundPath.slice(0,Math.max(2,Math.ceil(sample.t*200))):sample.phase==='inbound'?this.plan.inboundPath.slice(0,Math.max(2,Math.ceil(sample.t*200))):[];
    if(sample.orbit){
      const orbit=sample.orbit,count=Math.max(2,Math.min(4000,Math.ceil(sample.t*192*orbit.turns)));
      points=Array.from({length:count},(_,i)=>{const relative=parkingState(orbit,orbit.start+(+sample.date-orbit.start)*i/(count-1)).relative;return orbit.body==='Earth'?relative:relative.map((x,k)=>x+sample.moon[k]);});
    }
    this.trail.geometry=new THREE.BufferGeometry().setFromPoints(points.map(space));this.trail.visible=points.length>1;
    // Away from the surfaces the vehicle is enlarged so it stays visible; near them it is true size.
    const close=['launch','arrival'].includes(sample.phase)||this.mode==='follow',flight=['descent','ascent'].includes(sample.phase),ref=this.vehicle.height;
    const size=this.camera.position.distanceTo(this.vehicle.group.position)*(sample.phase==='launch'?.085:sample.phase==='arrival'?.07:close?.055:.022)/ref;this.vehicle.group.scale.setScalar(Math.max((flight||this.cameraTween)?.001:4*.014/ref,size));this.dirty=true;
    this.camera.near=local||ocean?.0001:Math.max(1e-8,Math.min(.0005,this.camera.position.distanceTo(this.controls.target)*.02));this.camera.far=ocean?200:10000;this.camera.updateProjectionMatrix();
    const night=ocean&&sky.day<.15;
    document.getElementById('missionScale').textContent=(ocean?this.t('msc.ocean'):local?this.t(sample.config==='ascent'?'msc.localAscent':'msc.local'):flight?this.t('msc.approach'):sample.orbit?this.t('msc.orbit'):this.t('msc.space'))+(dark?` · ${this.t('light.reading')}`:'')+(night?` · ${this.t('msc.night')}`:'');
  }
  orbitForPhase(sample){
    if(['earthOrbit','tli'].includes(sample.phase))return this.plan.earthParking;
    if(['loi','lunarOrbit'].includes(sample.phase))return this.plan.lunarParking;
    if(['lunarReturnOrbit','tei'].includes(sample.phase))return this.plan.lunarReturnParking;
    return null;
  }
  convertView(point,sample,toLocal,direction=false){
    const basis=siteBasis(this.plan.site),ground=RADIUS_KM+this.plan.elevationKm-this.terrain.height(0,0);
    if(toLocal){
      const inertial=[point.x,-point.z,point.y].map(x=>x*(direction?1:1000));
      const body=sample.frame.transform(direction?inertial:inertial.map((x,i)=>x-sample.moon[i]));
      const dot=a=>body.reduce((sum,x,i)=>sum+x*a[i],0);
      return new THREE.Vector3(dot(basis.east),dot(basis.up)-(direction?0:ground),-dot(basis.north));
    }
    const body=basis.east.map((x,i)=>x*point.x+basis.up[i]*(point.y+(direction?0:ground))-basis.north[i]*point.z);
    const inertial=toInertial(body,sample.frame);return direction?v(inertial):space(inertial.map((x,i)=>x+sample.moon[i]));
  }
  flightCameraPose(sample){
    const view=this.conditions?sideLitView(this.conditions.sun.direction):LOCAL_VIEW;
    const target=this.vehicle.group.position.clone(),offset=this.convertView(view,sample,false,true).normalize().multiplyScalar((.055+sample.altitudeKm*.005)/1000);
    return {position:target.clone().add(offset),target,up:this.convertView(Y,sample,false,true).normalize()};
  }
  animateCamera(now){
    const tween=this.cameraTween;if(!tween)return;
    const t=THREE.MathUtils.clamp((now-tween.start)/tween.duration,0,1),u=t*t*(3-2*t),{from,to}=tween;
    const a=from.position.clone().sub(from.target),b=to.position.clone().sub(to.target),distance=Math.exp(THREE.MathUtils.lerp(Math.log(Math.max(a.length(),1e-8)),Math.log(Math.max(b.length(),1e-8)),u));
    const turn=new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(),b.clone().normalize());
    const offset=a.normalize().applyQuaternion(new THREE.Quaternion().slerp(turn,u)).multiplyScalar(distance);
    this.controls.target.copy(from.target).lerp(to.target,u);this.camera.position.copy(this.controls.target).add(offset);this.camera.up.copy(from.up).lerp(to.up,u).normalize();
    if(!tween.local){
      // Keep a blended camera outside both globes while zooming from the surface.
      for(const [center,radius] of [[new THREE.Vector3(),EARTH_RADIUS/1000],[this.moon.position,RADIUS_KM/1000]]){const relative=this.camera.position.clone().sub(center);if(relative.length()<radius+.000001)this.camera.position.copy(center).add(relative.setLength(radius+.000001));}
    }
    this.controls.maxDistance=Math.max(tween.local?40:1500,distance*1.1);this.camera.near=tween.local?.0001:Math.max(1e-8,Math.min(.0005,distance*.02));this.camera.updateProjectionMatrix();this.controls.update();this.dirty=true;
    if(t===1)this.cameraTween=null;
  }
  setCamera(sample,local,ocean=false,target=null){
    this.camera.up.copy(Y);this.camera.near=local||ocean?.0001:.0005;this.camera.far=ocean?200:10000;this.camera.updateProjectionMatrix();this.controls.minDistance=local||ocean?.012:['descent','ascent'].includes(sample.phase)?.000015:.02;this.controls.maxDistance=local?40:ocean?20:1500;this.controls.enablePan=true;this.controls.maxPolarAngle=local||ocean?Math.PI*.49:Math.PI-.01;
    if(ocean){const at=target||new THREE.Vector3();this.controls.target.copy(at);this.camera.position.copy(at).add(new THREE.Vector3(.064,-.007,.09));this.camera.position.y=Math.max(.003,this.camera.position.y);this.lastPosition=at.clone();}
    else if(local){const at=target||this.localVehicle.group.position.clone().add(new THREE.Vector3(0,.004,0));this.controls.target.copy(at);this.camera.position.copy(at).add(this.conditions?sideLitView(this.conditions.sun.direction):LOCAL_VIEW);this.lastPosition=at.clone();}
    else if(this.mode==='auto'&&this.orbitForPhase(sample)){
      const orbit=this.orbitForPhase(sample),center=orbit.body==='Earth'?new THREE.Vector3():this.moon.position.clone(),radius=orbit.radiusKm/1000;
      const offset=v(orbit.normal).multiplyScalar(2.8).add(v(orbit.p).multiplyScalar(1.2)).add(v(orbit.q).multiplyScalar(.5)).normalize();
      const distance=radius/Math.sin(THREE.MathUtils.degToRad(this.camera.fov/2))*1.25/Math.min(this.camera.aspect,1);
      this.controls.target.copy(center);this.camera.position.copy(center).add(offset.multiplyScalar(distance));this.lastPosition=center.clone();
    }
    else if(this.mode==='overview'||['outbound','inbound'].includes(sample.phase)&&this.mode==='auto'){
      const center=this.bounds.center,distance=this.bounds.radius/Math.sin(THREE.MathUtils.degToRad(this.camera.fov/2))*1.12/Math.min(this.camera.aspect,1),axis=space(this.plan.outboundCurve[3]).normalize();
      const offset=new THREE.Vector3().crossVectors(axis,Y);if(offset.length()<.1)offset.set(0,0,1);offset.normalize().add(new THREE.Vector3(0,.6,0)).normalize();
      this.controls.target.copy(center);this.camera.position.copy(center).add(offset.multiplyScalar(distance));this.lastPosition=null;
    }else if(this.mode==='auto'&&['descent','ascent'].includes(sample.phase)){
      const pose=this.flightCameraPose(sample);this.camera.position.copy(pose.position);this.controls.target.copy(pose.target);this.camera.up.copy(pose.up);this.lastPosition=pose.target.clone();
    }else{
      const target=this.vehicle.group.position.clone();
      if(sample.phase==='arrival'){
        // Beside the capsule, a little above it: the plasma trail and the curve of the Earth below.
        const radial=v(sample.position).normalize(),motion=v(sample.direction).normalize(),side=new THREE.Vector3().crossVectors(motion,radial).normalize(),d=1.1;
        this.controls.target.copy(target);this.camera.position.copy(target).addScaledVector(side,d).addScaledVector(radial,d*.32).addScaledVector(motion,-d*.25);this.camera.up.copy(radial);this.lastPosition=target.clone();
      }else{
        const up=v(sample.direction).normalize(),side=new THREE.Vector3().crossVectors(up,Y);if(side.length()<.01)side.set(1,0,0);side.normalize();const distance=sample.phase==='launch'?1.2:12;
        this.controls.target.copy(target);this.camera.position.copy(target).add(up.clone().multiplyScalar(distance*.45)).add(side.multiplyScalar(distance));this.lastPosition=target.clone();
      }
    }
    this.controls.update();this.dirty=true;
  }
  labels(){
    for(const [name,body] of [['Earth',this.earth],['Moon',this.moon]]){
      const label=document.getElementById(`mission${name}Label`),p=body.position.clone().project(this.camera),visible=this.world.visible&&p.z<1&&p.z>-1&&Math.abs(p.x)<.97&&Math.abs(p.y)<.92;
      label.style.display=visible?'block':'none';label.style.transform=`translate(${(p.x*.5+.5)*this.container.clientWidth+10}px,${(-p.y*.5+.5)*this.container.clientHeight}px)`;
    }
  }
  resize(){const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.cameraKey='';if(this.sample)this.update(this.sample,this.conditions,true);this.dirty=true;}
  dispose(){
    if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.canvas.removeEventListener('webglcontextlost',this.onContextLost);this.controls.dispose();
    this.scene.traverse(object=>{object.geometry?.dispose();if(object.material&&!object.isSprite){for(const mat of Array.isArray(object.material)?object.material:[object.material])mat.dispose();}});
    this.materials.dispose();for(const env of Object.values(this.envs))env.dispose();this.landing.dispose();this.water.material.normalMap.dispose();this.foamMap.dispose();
    this.moonTexture.dispose();this.earthTexture.dispose();this.earthExtras.forEach(x=>x.dispose());this.regolith?.dispose();this.renderer.dispose();this.renderer.forceContextLoss();
  }
}
