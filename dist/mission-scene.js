import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RADIUS_KM, siteBasis } from './model.js';
import { EARTH_RADIUS, APOLLO, moonPosition, parkingPath, parkingState, toInertial } from './mission-model.js';
import { lunarMaterial, regolithNormalMap, detailedTerrainGeometry, contextTerrainGeometry, innerTerrainGeometry, orbitalPatchGeometry } from './lunar-surface.js';
import { loadStarCatalog, createStarField, setRotationRows } from './stars.js';
import { Spacecraft, createMaterials, makeEnvironment, buildDescentStage, buildSpent, setLayer } from './spacecraft.js';
import { LandingSite } from './landing-site.js';
import { LaunchPad, PAD_DECK } from './launch-pad.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Last pass, in display space: a little lens (chromatic fringe towards the corners, vignette) and film grain.
const FILM={
  uniforms:{tDiffuse:{value:null},uTime:{value:0},uGrain:{value:.045},uVignette:{value:.34},uFringe:{value:.011}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:'uniform sampler2D tDiffuse;uniform float uTime,uGrain,uVignette,uFringe;varying vec2 vUv;float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}void main(){vec2 d=vUv-.5;float r2=dot(d,d);vec2 off=d*r2*uFringe;vec3 c=vec3(texture2D(tDiffuse,vUv+off).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-off).b);c*=1.-uVignette*smoothstep(.12,.62,r2);float n=hash(vUv*vec2(1733.,977.)+fract(uTime)*71.3)-.5;c+=n*uGrain*(1.-.6*dot(c,vec3(.299,.587,.114)));gl_FragColor=vec4(c,1.);}'
};

const asset=path=>new URL(path,import.meta.url).href;
const v=a=>new THREE.Vector3(a[0],a[2],-a[1]);
const space=a=>v(a).multiplyScalar(.001);
const Y=new THREE.Vector3(0,1,0);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const LUNAR_PHASES=new Set(['loi','lunarOrbit','descent','surface','ascent','lunarReturnOrbit','tei']);
const EARTH_PHASES=new Set(['liftoff','launch','earthOrbit','tli','arrival']);
// Stages where the automatic camera flies beside the spacecraft, at true scale, with the Earth or the Moon behind.
const CHASE_PHASES=new Set(['launch','earthOrbit','tli','loi','lunarOrbit','lunarReturnOrbit','tei','arrival']);
const LOCAL_VIEW=new THREE.Vector3(.032,.009,.044); // ~55 m from the lander, 13 m up: a photographer on the ground
// Same distance, placed so the Sun comes from the side and a little behind: shadows run across the picture.
function sideLitView(sun){const h=new THREE.Vector3(sun[0],0,sun[2]);if(h.lengthSq()<1e-8)return LOCAL_VIEW.clone();h.normalize().applyAxisAngle(Y,1.95);return h.multiplyScalar(.0545).setY(.009);}
const PAD_CAMERA=new THREE.Vector3(.31,.012,.27); // press site: ~410 m from the pad, on the ground
// What is dropped along the way: [model, stage, from, to, first gap (m), drift over the window (m)].
const SPENT=[['sic','launch',.23,.42,95,900],['sii','launch',.785,.97,60,700],['sivb','outbound',0,.12,45,520],['asc','lunarReturnOrbit',.36,.5,14,200],['sm','arrival',0,.2,18,420]];
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
// Tileable value noise (four octaves) for the fine structure of the clouds.
function noiseTexture(size=256){
  const hash=(x,y,s)=>{let n=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(s,982451653))|0;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;};
  const noise=(x,y,p,s)=>{const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,w=k=>((k%p)+p)%p,sx=xf*xf*(3-2*xf),sy=yf*yf*(3-2*yf);const a=hash(w(xi),w(yi),s),b=hash(w(xi+1),w(yi),s),c=hash(w(xi),w(yi+1),s),d=hash(w(xi+1),w(yi+1),s);return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;};
  const data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){let n=0,a=.5;for(let o=0;o<4;o++){const p=8<<o;n+=a*noise(x/size*p,y/size*p,p,o+3);a*=.5;}const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=clamp(n/.94)*255;data[i+3]=255;}
  const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.needsUpdate=true;return t;
}
function glowTexture(stops){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d'),gr=g.createRadialGradient(128,128,0,128,128,128);
  for(const [at,color] of stops)gr.addColorStop(at,color);g.fillStyle=gr;g.fillRect(0,0,256,256);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

export class MissionScene {
  constructor(canvas,container,terrain,onError,{t=k=>k,nasa=null}={}){
    this.t=t;this.nasa=nasa;this.container=container;this.terrain=terrain;this.mode='auto';this.dirty=true;this.disposed=false;this.cameraKey='';this.textures=[];
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;this.renderer.setClearColor(0x000000);this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    // Two passes when in space: the distant bodies first, then the spacecraft with its own depth range,
    // so a 20 m vehicle and a planet 200 km behind it can share a picture.
    this.renderer.autoClear=false;this.nearA=.0005;
    // Cinema pipeline: the scene is drawn in linear HDR (half float, 4× MSAA), bright sources bloom,
    // ACES tone mapping gives the exposure of film, then lens and grain.
    {
      const size=this.renderer.getDrawingBufferSize(new THREE.Vector2()),hdr=this.renderer.extensions.has('EXT_color_buffer_float')||this.renderer.extensions.has('EXT_color_buffer_half_float');
      this.composer=new EffectComposer(this.renderer,new THREE.WebGLRenderTarget(Math.max(1,size.x),Math.max(1,size.y),{type:hdr?THREE.HalfFloatType:THREE.UnsignedByteType,samples:4}));
      const stage=new Pass();stage.needsSwap=false;stage.render=(renderer,writeBuffer,readBuffer)=>{renderer.setRenderTarget(readBuffer);renderer.clear();this.draw();};
      this.bloom=new UnrealBloomPass(new THREE.Vector2(size.x/2,size.y/2),.5,.75,1);this.film=new ShaderPass(FILM);
      for(const pass of [stage,this.bloom,new OutputPass(),this.film])this.composer.addPass(pass);
    }
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(45,1,.001,10000);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=false;this.controls.addEventListener('change',()=>{this.dirty=true;});this.controls.addEventListener('start',()=>{this.cameraTween=null;this.manualCamera=true;});
    this.world=new THREE.Group();this.local=new THREE.Group();this.oceanGroup=new THREE.Group();this.scene.add(this.world,this.local,this.oceanGroup);
    this.sunlight=new THREE.DirectionalLight(0xfff6e4,3.2);this.sunlight.shadow.mapSize.set(4096,4096);this.sunlight.shadow.normalBias=.00004;this.sunlight.shadow.bias=-.00002;this.sunlight.layers.enableAll();this.scene.add(this.sunlight,this.sunlight.target);
    this.fill=new THREE.AmbientLight(0xa4c2df,.03);this.fill.layers.enableAll();this.scene.add(this.fill);
    // Reading light, only when the destination is in shadow; the scale label says so.
    this.earthlight=new THREE.DirectionalLight(0x9fc4ff,0);this.scene.add(this.earthlight,this.earthlight.target);
    // Light the sunlit ground below sends back up to the spacecraft (second pass only).
    this.shine=new THREE.DirectionalLight(0xffffff,0);this.shine.layers.set(1);this.scene.add(this.shine,this.shine.target);
    // Starlight and stray light: just enough to read the spacecraft inside a shadow.
    this.shade=new THREE.AmbientLight(0x93a8cc,.2);this.shade.layers.set(1);this.scene.add(this.shade);
    // What polished metal reflects: regolith near the Moon, oceans and clouds near the Earth, sky over the Pacific.
    this.envs={moon:makeEnvironment(this.renderer,{ground:[.34,.33,.31]}),earth:makeEnvironment(this.renderer,{ground:[.12,.2,.34],horizon:[.4,.52,.72]}),space:makeEnvironment(this.renderer,{sky:[.02,.02,.025],ground:[.07,.07,.075]}),ocean:makeEnvironment(this.renderer,{sky:[.28,.46,.75],ground:[.03,.09,.16],horizon:[.78,.86,.95]})};
    this.materials=createMaterials(this.envs.space.texture);this.envName='space';
    const loader=new THREE.TextureLoader(),anisotropy=this.renderer.capabilities.getMaxAnisotropy();
    const texture=(file,srgb,error)=>{const tex=loader.load(asset(`./assets/mission/${file}`),()=>this.dirty=true,undefined,error&&(()=>onError(t(error))));if(srgb)tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=anisotropy;this.textures.push(tex);return tex;};
    this.makeEarth(texture);
    // The Moon: LROC colour and a normal map computed from the LOLA elevation model, both 4096 px. Around
    // the destination a cap is cut out and the finer LOLA mesh takes its place.
    this.moonHole={dir:{value:new THREE.Vector3(0,-1,0)},cos:{value:Math.cos(140/RADIUS_KM)}};
    this.moon=mesh(new THREE.SphereGeometry(RADIUS_KM/1000,256,192),lunarMaterial({vertexColors:false,map:texture('moon-color.jpg',true,'error.moonTexture'),color:0xf2efe8,normalMap:texture('moon-normal.jpg',false),normalScale:1.25,normalY:1,hole:this.moonHole}),this.world);
    this.localEarth=mesh(new THREE.SphereGeometry(1,48,32),new THREE.MeshStandardMaterial({map:this.earthDay,roughness:.85}),this.local);
    this.vehicle=new Spacecraft(this.materials,nasa);setLayer(this.vehicle.group,1);this.world.add(this.vehicle.group);
    this.spent={};for(const [kind] of SPENT){const g=new THREE.Group(),body=new THREE.Group();body.scale.setScalar(.001);body.add(buildSpent(this.materials,kind,nasa));g.add(body);g.visible=false;setLayer(g,1);this.world.add(g);this.spent[kind]=g;}
    this.localVehicle=new Spacecraft(this.materials,nasa);this.local.add(this.localVehicle.group);
    this.descentLeft=new THREE.Group();this.descentLeft.scale.setScalar(.001);this.descentLeft.add(buildDescentStage(this.materials,nasa));this.descentLeft.visible=false;this.local.add(this.descentLeft);
    // The Sun itself: a small hot disc with glare, far behind everything.
    this.sunSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture([[0,'rgba(255,255,255,1)'],[.014,'rgba(255,252,240,1)'],[.03,'rgba(255,244,220,.55)'],[.09,'rgba(255,236,200,.16)'],[.3,'rgba(255,230,190,.045)'],[1,'rgba(255,230,190,0)']]),blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false,fog:false}));this.sunSprite.material.color.setRGB(14,13.4,12.4);this.sunSprite.scale.setScalar(1500);this.world.add(this.sunSprite);
    // The Milky Way (NASA SVS Deep Star Maps 2020), in celestial coordinates, behind the catalogue stars.
    this.milkyWay=new THREE.Mesh(new THREE.SphereGeometry(4800,48,32),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,uniforms:{uMap:{value:texture('milkyway.jpg',true)},uGain:{value:.62}},
      vertexShader:'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'uniform sampler2D uMap;uniform float uGain;varying vec3 vDir;void main(){vec3 w=normalize(vDir);vec3 j=vec3(w.x,-w.z,w.y);float ra=atan(j.y,j.x);float dec=asin(clamp(j.z,-1.,1.));vec2 uv=vec2(.5-ra/6.28318530718,.5+dec/3.14159265359);vec3 c=texture2D(uMap,uv).rgb;gl_FragColor=vec4(c*c*uGain,1.);}'}));
    this.milkyWay.material.uniforms.uMap.value.generateMipmaps=false;this.milkyWay.material.uniforms.uMap.value.minFilter=THREE.LinearFilter;
    this.milkyWay.renderOrder=-10;this.milkyWay.frustumCulled=false;this.world.add(this.milkyWay);
    // What the spacecraft reflects in space: the scene itself, captured around it now and then.
    this.cubeTarget=new THREE.WebGLCubeRenderTarget(128,{type:THREE.HalfFloatType});this.cubeCamera=new THREE.CubeCamera(.00001,10000,this.cubeTarget);this.cubeCamera.children.forEach(c=>c.layers.set(0));
    this.pmrem=new THREE.PMREMGenerator(this.renderer);this.reflection=null;this.reflectionAge=1e9;this.sunOnVehicle=1;
    this.makeTerrain(terrain);this.makeOcean();
    this.pad=new LaunchPad(this.water.material);this.pad.group.visible=false;this.scene.add(this.pad.group);
    this.padVehicle=new Spacecraft(this.materials);this.padVehicle.set('saturnV');this.pad.group.add(this.padVehicle.group);
    this.trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.8}));this.world.add(this.trail);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
    this.canvas=canvas;this.onContextLost=e=>{e.preventDefault();this.contextLost=true;if(!this.disposed)onError(t('error.contextLost'));};canvas.addEventListener('webglcontextlost',this.onContextLost);
    loadStarCatalog().then(data=>{if(!data||this.disposed)return;this.stars=createStarField(data,4000);this.stars.material.uniforms.uPixelRatio.value=this.renderer.getPixelRatio();setRotationRows(this.stars,[1,0,0],[0,0,1],[0,-1,0]);this.stars.material.uniforms.uOpacity.value=.6;this.stars.visible=this.world.visible;this.scene.add(this.stars);this.dirty=true;});
    this.render=now=>{
      if(this.disposed)return;now=now??performance.now();this.animateCamera(now);
      const world=this.world.visible,pad=this.pad.group.visible;
      // Moving dust, waves, smoke and burning engines keep drawing while they are on screen.
      if(this.dustLevel>.02&&this.local.visible){this.landing.updateDust(this.dustLevel,now/1000);this.dirty=true;}
      if(this.oceanGroup.visible||pad){this.water.material.normalMap.offset.set(now*.0000045,now*.0000031);this.dirty=true;}
      if(this.sample?.throttle>0&&(world||pad)){(pad?this.padVehicle:this.vehicle).engine(this.engineLevel??this.sample.throttle);this.dirty=true;}
      // The ground shakes the camera while the first stage burns close by.
      if(pad&&this.padTarget&&!this.manualCamera){const k=(this.engineLevel||0)*Math.max(0,1-this.sample.altitudeKm/1.2)*.0012,t=now/1000;this.controls.target.copy(this.padTarget).add(new THREE.Vector3(Math.sin(t*47)+Math.sin(t*83+1),Math.sin(t*59+2)+Math.sin(t*101),0).multiplyScalar(k));this.controls.update();}
      if(this.dirty&&!document.hidden&&!this.contextLost){
        const camera=this.camera;
        if(this.stars){this.stars.matrix.setPosition(camera.position);this.stars.matrixWorldNeedsUpdate=true;}
        this.milkyWay.position.copy(camera.position);this.sunSprite.position.copy(camera.position).addScaledVector(this.sunWorld,3000);
        camera.updateMatrixWorld();this.sunView.value.copy(this.sunWorld).transformDirection(camera.matrixWorldInverse);
        if(world&&++this.reflectionAge>40)this.captureReflection();
        this.film.uniforms.uTime.value=now/1000;this.composer.render();
        this.labels();this.dirty=false;
      }
      this.frame=requestAnimationFrame(this.render);
    };this.render();
  }
  // One frame into the current target. In space: the distant bodies first, then the spacecraft with its own
  // depth range, its own shadows and the sunlight it really gets (none inside the shadow of the Earth or the Moon).
  draw(){
    const r=this.renderer,camera=this.camera,sun=this.sunlight;camera.layers.set(0);
    if(!this.world.visible){camera.updateProjectionMatrix();r.render(this.scene,camera);return;}
    const at=this.vehicle.group.position,intensity=sun.intensity,position=sun.position.clone(),aim=sun.target.position.clone();
    camera.near=this.nearA;camera.far=10000;camera.updateProjectionMatrix();r.render(this.scene,camera);
    const d=camera.position.distanceTo(at),reach=Math.max(2e-5,this.vehicle.height*this.vehicle.group.scale.x*1.6),shadow=sun.shadow;
    sun.intensity=intensity*this.sunOnVehicle;sun.target.position.copy(at);sun.position.copy(at).addScaledVector(this.sunWorld,reach*6);sun.target.updateMatrixWorld();
    Object.assign(shadow.camera,{left:-reach,right:reach,top:reach,bottom:-reach,near:reach,far:reach*12});shadow.camera.updateProjectionMatrix();shadow.normalBias=reach*.004;shadow.bias=-.0006;
    r.clearDepth();camera.layers.set(1);camera.near=Math.max(1e-9,d*.04);camera.far=d*60+.002;camera.updateProjectionMatrix();r.render(this.scene,camera);camera.layers.set(0);
    sun.intensity=intensity;sun.position.copy(position);sun.target.position.copy(aim);shadow.normalBias=.00004;shadow.bias=-.00002;
  }
  // The Earth, the Moon, the Sun and the stars as the spacecraft sees them, filtered for reflections.
  captureReflection(){
    this.reflectionAge=0;const r=this.renderer,target=r.getRenderTarget();
    this.cubeCamera.position.copy(this.vehicle.group.position);this.cubeCamera.children.forEach(c=>{c.near=Math.max(1e-6,this.nearA);c.far=10000;c.updateProjectionMatrix();});
    this.cubeCamera.update(r,this.scene);
    this.reflection=this.pmrem.fromCubemap(this.cubeTarget.texture,this.reflection);r.setRenderTarget(target);
    if(this.envName==='space'||this.envName==='earth'||this.envName==='moon'){this.materials.setEnvironment(this.reflection.texture);this.envLive=true;}
  }
  makeEarth(texture){
    // Earth at 4096 px: day map, city lights only on the night side, the Sun's glint on the oceans,
    // clouds with fine structure and a thin blue limb. Visual only.
    const day=this.earthDay=texture('earth-day.jpg',true,'error.earthTexture'),night=texture('earth-night.jpg',true),brc=texture('earth-brc.jpg',false);
    this.sunWorld=new THREE.Vector3(1,0,0);this.sunView={value:new THREE.Vector3(0,0,1)};this.cloudNoise=noiseTexture();
    const material=new THREE.MeshStandardMaterial({map:day,roughnessMap:brc,roughness:1,metalness:0,emissive:0xffd29a,emissiveMap:night,emissiveIntensity:1.3});
    material.onBeforeCompile=shader=>{shader.uniforms.uSunView=this.sunView;shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 uSunView;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\nfloat sunSide = dot(normalize(vNormal), uSunView);\ntotalEmissiveRadiance *= smoothstep(.06, -.22, sunSide);\nfloat airRim = pow(1. - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.6);\ntotalEmissiveRadiance += vec3(.2, .4, .85) * airRim * smoothstep(-.15, .25, sunSide) * .45;');};
    const r=EARTH_RADIUS/1000;this.earth=mesh(new THREE.SphereGeometry(r,192,128),material,this.world);this.earth.castShadow=false;
    const clouds=new THREE.MeshStandardMaterial({color:0xffffff,map:brc,transparent:true,depthWrite:false,roughness:1});
    clouds.onBeforeCompile=shader=>{shader.uniforms.uNoise={value:this.cloudNoise};shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D uNoise;').replace('#include <map_fragment>','float cloud = texture2D( map, vMapUv ).b;\nfloat fine = texture2D( uNoise, vMapUv * vec2(56., 28.) ).r;\nfloat finer = texture2D( uNoise, vMapUv * vec2(190., 95.) ).r;\ncloud = smoothstep(.1, .78, cloud * (.5 + .7 * fine + .35 * finer));\ndiffuseColor.a *= cloud;');};
    clouds.customProgramCacheKey=()=>'earth-clouds-brc';
    this.earth.add(new THREE.Mesh(new THREE.SphereGeometry(r*1.0015,192,128),clouds));
    const limb=new THREE.Mesh(new THREE.SphereGeometry(r*1.022,96,64),new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.BackSide,uniforms:{uSunView:this.sunView},
      vertexShader:'varying vec3 vN;varying vec3 vV;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
      fragmentShader:'uniform vec3 uSunView;varying vec3 vN;varying vec3 vV;void main(){vec3 n=normalize(vN);float rim=pow(clamp(1.-abs(dot(n,normalize(vV))),0.,1.),2.2);float lit=smoothstep(-.35,.35,dot(-n,uSunView));gl_FragColor=vec4(vec3(.35,.6,1.)*rim*lit*.85,rim*lit);}'}));
    this.earth.add(limb);
  }
  makeTerrain(terrain){
    // Same LOLA relief as the explorer; around the destination, the landing site at lander scale.
    this.regolith=regolithNormalMap(512,11,{craters:0});
    this.landing=new LandingSite(terrain,{seed:[...terrain.site.id].reduce((s,c)=>s+c.charCodeAt(0),0)});this.local.add(this.landing.group);
    const detail=mesh(detailedTerrainGeometry(terrain),lunarMaterial({normalMap:this.regolith,normalScale:.3}),this.local);
    const innerGeometry=innerTerrainGeometry(terrain,{hole:this.landing.half}),inner=innerGeometry&&mesh(innerGeometry,lunarMaterial({normalMap:this.regolith,normalScale:.32}),this.local);
    const context=contextTerrainGeometry(terrain);if(context)mesh(context,lunarMaterial({normalMap:null}),this.local);
    this.groundY=this.landing.heightAt(0,0);this.descentLeft.position.set(0,this.groundY,0);
    // The same relief seen from orbit and on the way down, set into the globe at the destination.
    this.patch=new THREE.Group();this.patch.matrixAutoUpdate=false;this.world.add(this.patch);
    const orbital=orbitalPatchGeometry(terrain);if(orbital){const m=new THREE.Mesh(orbital,lunarMaterial({normalMap:null,transparent:true,color:0xdedbd4}));this.patch.add(m);}
    for(const source of [detail,inner,this.landing.mesh])if(source)this.patch.add(new THREE.Mesh(source.geometry,source.material));
  }
  makeOcean(){
    // Pacific recovery area: sky dome, sea with moving swell, the command module under its parachutes.
    const g=this.oceanGroup;g.visible=false;
    this.skyUniforms={uZenith:{value:new THREE.Color(.16,.34,.66)},uHorizon:{value:new THREE.Color(.72,.82,.92)},uSun:{value:new THREE.Vector3(0,1,0)},uGlow:{value:new THREE.Color(1,.92,.8)}};
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(90,48,24),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:this.skyUniforms,
      vertexShader:'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'uniform vec3 uZenith,uHorizon,uSun,uGlow;varying vec3 vDir;void main(){float y=max(vDir.y,0.);vec3 c=mix(uHorizon,uZenith,pow(y,.55));float s=max(dot(vDir,normalize(uSun)),0.);c+=uGlow*(pow(s,600.)*4.+pow(s,12.)*.25);if(vDir.y<0.)c=uHorizon*.55;gl_FragColor=vec4(pow(c,vec3(2.2)),1.);}'}));
    this.sky.visible=false;this.scene.add(this.sky);
    const water=new THREE.MeshStandardMaterial({color:0x14405f,roughness:.09,metalness:0,normalMap:waterNormalMap(),normalScale:new THREE.Vector2(.55,.55)});water.normalMap.repeat.set(1600,1600);
    this.water=new THREE.Mesh(new THREE.PlaneGeometry(160,160),water);this.water.rotation.x=-Math.PI/2;this.water.receiveShadow=true;g.add(this.water);
    this.oceanVehicle=new Spacecraft(this.materials,this.nasa);this.oceanVehicle.set('cmChutes');g.add(this.oceanVehicle.group);
    const c=document.createElement('canvas');c.width=c.height=128;const g2=c.getContext('2d'),gr=g2.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(.3,'rgba(255,255,255,.55)');gr.addColorStop(.45,'rgba(240,246,248,.25)');gr.addColorStop(1,'rgba(240,246,248,0)');g2.fillStyle=gr;g2.fillRect(0,0,128,128);
    this.foamMap=new THREE.CanvasTexture(c);this.foam=new THREE.Mesh(new THREE.PlaneGeometry(.016,.016),new THREE.MeshBasicMaterial({map:this.foamMap,transparent:true,opacity:0,depthWrite:false}));this.foam.rotation.x=-Math.PI/2;this.foam.position.y=.00005;g.add(this.foam);
    this.oceanFog=new THREE.Fog(0xb9cde0,4,70);
  }
  skyAt(site,date){
    // Real Sun over a point on Earth at that UTC time (day, twilight or night).
    const A=window.Astronomy,observer=new A.Observer(site.lat,site.lon,0);
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
    this.plan=plan;this.cameraKey='';this.cameraTween=null;this.lastLocal=undefined;this.lastScene=undefined;this.chaseD=0;
    const up=siteBasis(plan.site).up;this.moonHole.dir.value.set(up[0],up[2],-up[1]).normalize();
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
  // Beside the spacecraft in the automatic camera? Coasts open and close that way; their middle is the whole trajectory.
  chasing(sample){return this.mode==='auto'&&(CHASE_PHASES.has(sample.phase)||(['outbound','inbound'].includes(sample.phase)&&(sample.t<.14||sample.t>.86)));}
  // Between the chase and the whole trajectory, the automatic camera looks out of the spacecraft window through a long
  // lens: first the body left behind, shrinking, then the destination, growing. Both at their true angular size.
  coastShot(sample){if(this.mode!=='auto'||!['outbound','inbound'].includes(sample.phase))return null;const t=sample.t;return t>=.14&&t<.42?'back':t>=.62&&t<.86?'ahead':null;}
  coastPose(sample,shot){
    const moon=(sample.phase==='outbound')===(shot==='ahead'),centre=moon?space(sample.moon):new THREE.Vector3(),radius=(moon?RADIUS_KM:EARTH_RADIUS)/1000;
    const at=space(sample.position),distance=at.distanceTo(centre),u=clamp(shot==='back'?(sample.t-.14)/.28:(sample.t-.62)/.24);
    // The lens is chosen for the share of the frame height the disc fills, so the change in size reads as motion.
    const fill=shot==='back'?.72-.4*u:.3+.42*u,fov=clamp(THREE.MathUtils.radToDeg(2*Math.asin(Math.min(1,radius/distance)))/fill,.8,60);
    return {position:at,target:centre,up:Y.clone(),fov,distance,body:moon?'Moon':'Earth'};
  }
  nearEarth(sample){return EARTH_PHASES.has(sample.phase)||sample.phase==='splashdown'||(sample.phase==='outbound'&&sample.t<.5)||(sample.phase==='inbound'&&sample.t>=.5);}
  update(sample,conditions,reset=false){
    const previous=this.sample;this.sample=sample;this.conditions=conditions;
    const overview=this.mode==='overview',ocean=sample.ocean&&!overview,pad=Boolean(sample.pad)&&!overview,local=sample.local&&!overview&&!ocean,world=!local&&!ocean&&!pad;
    const flight=world&&['descent','ascent'].includes(sample.phase),chase=world&&this.chasing(sample),earthSide=this.nearEarth(sample);
    const coast=world?this.coastShot(sample):null;this.coastNow=coast?this.coastPose(sample,coast):null;
    // Trajectory lines belong to the diagrams, not to the views beside or from the spacecraft.
    const lines=!(flight||chase||coast);
    this.world.visible=world;this.local.visible=local;this.oceanGroup.visible=ocean;this.pad.group.visible=pad;this.sky.visible=ocean||pad;if(this.stars)this.stars.visible=world;
    this.scene.fog=ocean||pad?this.oceanFog:null;
    const sceneName=pad?'pad':ocean?'ocean':local?'local':'world';
    if(this.lastScene!==undefined&&sceneName!==this.lastScene&&(sceneName==='pad'||sceneName==='ocean'||this.lastScene==='pad'||this.lastScene==='ocean'))reset=true;
    const envName=ocean||pad?'ocean':LUNAR_PHASES.has(sample.phase)?'moon':EARTH_PHASES.has(sample.phase)?'earth':'space';
    if(envName!==this.envName||(!world&&this.envLive)){this.envName=envName;this.envLive=false;this.materials.setEnvironment(world&&this.reflection?this.reflection.texture:this.envs[envName].texture);this.envLive=world&&Boolean(this.reflection);if(world)this.reflectionAge=1e9;}
    this.moon.position.copy(space(sample.moon));
    this.parkingLines[1].position.copy(this.moon.position);this.parkingLines[2].position.copy(this.moon.position);
    for(const line of this.pathLines)line.visible=lines;
    this.parkingLines[1].visible=lines&&+sample.date<=this.plan.departure;this.parkingLines[2].visible=lines&&+sample.date>=this.plan.departure;
    const f=sample.frame,matrix=new THREE.Matrix4().makeBasis(v(f.x),v(f.z),v(f.y).negate());this.moon.quaternion.setFromRotationMatrix(matrix);
    // The LOLA mesh rides on the globe at the destination: local east, up and south become world axes.
    {
      const b=siteBasis(this.plan.site),up=toInertial(b.up,f),ground=RADIUS_KM+this.plan.elevationKm-this.terrain.height(0,0);
      this.patch.matrix.makeBasis(v(toInertial(b.east,f)),v(up),v(toInertial(b.north,f)).negate()).scale(new THREE.Vector3(.001,.001,.001)).setPosition(space(sample.moon.map((x,i)=>x+up[i]*ground)));this.patch.matrixWorldNeedsUpdate=true;
    }
    // Greenwich faces the sidereal angle (precession ignored: visual only).
    this.earth.rotation.y=window.Astronomy.SiderealTime(sample.date)*Math.PI/12;
    // Vehicle: the stage, module or capsule flying at this moment of the Apollo profile.
    this.vehicle.set(sample.config);this.engineLevel=sample.throttle||0;this.vehicle.engine(this.engineLevel);this.vehicle.plasma(sample.plasma||0);
    const attitude=v(sample.attitude||sample.direction).normalize();
    this.vehicle.group.position.copy(space(sample.position));this.vehicle.group.visible=!coast;
    {
      // Roll is held against the nearer body (local vertical), as a spacecraft holds attitude in orbit:
      // without it the model would turn about its own axis as the velocity vector sweeps around.
      const centre=earthSide?new THREE.Vector3():this.moon.position,out=this.vehicle.group.position.clone().sub(centre).normalize();
      let z=out.clone().addScaledVector(attitude,-out.dot(attitude));if(z.lengthSq()<1e-4)z=new THREE.Vector3().crossVectors(attitude,Math.abs(attitude.y)<.9?Y:new THREE.Vector3(1,0,0));z.normalize();
      this.vehicle.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(attitude,z),attitude,z));
    }
    const localTarget=sample.localPosition?new THREE.Vector3(...sample.localPosition):new THREE.Vector3(0,sample.altitudeKm,0);
    localTarget.y+=this.groundY;
    const lv=this.localVehicle;lv.set(sample.config==='ascent'?'ascent':'lm');lv.engine(local?sample.throttle||0:0);
    lv.group.position.copy(localTarget);if(sample.config==='ascent')lv.group.position.y+=lv.ascentBase;
    if(sample.localDirection)lv.group.quaternion.setFromUnitVectors(Y,new THREE.Vector3(...sample.localDirection).normalize());
    this.descentLeft.visible=sample.phase==='ascent'||sample.phase==='lunarReturnOrbit';
    // Engine-blown regolith below ~30 m on landing, and when the ascent engine fires on the descent stage.
    this.dustLevel=!local?0:sample.phase==='descent'&&sample.engine?Math.max(0,1-sample.altitudeKm/.03)*(.4+.6*(sample.throttle||0)):sample.phase==='ascent'?Math.max(0,1-sample.altitudeKm/.012)*.5:0;
    if(this.dustLevel<=.02)this.landing.dust.visible=false;
    let sky=null;
    if(ocean){
      sky=this.skyAt(this.plan.entry.to,sample.date);const ov=this.oceanVehicle;ov.chutes(sample.chutes);
      ov.group.position.set(0,sample.altitudeKm,0);ov.group.rotation.set(0,.6,0);
      const near=Math.max(0,1-sample.altitudeKm/.004);this.foam.material.opacity=sample.altitudeKm<.0005?.85*(1-sample.altitudeKm/.0005):0;this.foam.scale.setScalar(1+near*.3);
    }
    if(pad){
      // Launch Complex 39A: the Saturn V at true size, held down while the engines build up, then climbing.
      sky=this.skyAt(APOLLO.launchSite,sample.date);
      const altitude=k=>APOLLO.liftoffAltitudeKm*Math.pow(clamp((k-.15)/.85),2.2),pv=this.padVehicle;
      pv.group.position.set(0,PAD_DECK+sample.altitudeKm+.45*pv.height,0);pv.plumeLength=clamp((sample.altitudeKm*1000+10)/70,.14,1);
      this.engineLevel=Math.min(1,sample.ignition*1.25);pv.engine(this.engineLevel);
      this.pad.update(sample.t,altitude,sample.ignition,sky.day,this.renderer.domElement.height/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))));
    }
    // Light.
    const earthHelio=window.Astronomy.HelioVector(window.Astronomy.Body.Earth,sample.date);
    const sunWorld=v([earthHelio.x,earthHelio.y,earthHelio.z]).negate().normalize();this.sunWorld.copy(sunWorld);
    const sun=sky?sky.dir.clone():local?new THREE.Vector3(...conditions.sun.direction):sunWorld.clone();
    this.sunlight.intensity=sky?3*sky.day:local?2.7*conditions.sun.diskFraction:3.2;
    this.fill.intensity=sky?.16+.3*sky.day:.03;this.fill.color.set(sky?0xbcd2ea:0xa4c2df);
    const anchor=ocean?this.oceanVehicle.group.position:pad?new THREE.Vector3(0,.06,0):local?localTarget:this.moon.position.clone().multiplyScalar(.5);
    this.sunlight.target.position.copy(anchor);this.sunlight.position.copy(anchor).add(sun.multiplyScalar(local?200:sky?40:1000));this.sunlight.castShadow=!ocean;
    const dark=local&&conditions.sun.diskFraction===0;this.earthlight.intensity=dark?.7:0;
    if(local){this.earthlight.target.position.copy(localTarget);this.earthlight.position.copy(localTarget).add(new THREE.Vector3(...conditions.earth.direction).multiplyScalar(200));}
    if(local||pad){const s=local?.45:.3;Object.assign(this.sunlight.shadow.camera,{left:-s,right:s,top:s,bottom:-s,near:.01,far:500});this.sunlight.shadow.camera.updateProjectionMatrix();}
    if(local){this.localEarth.position.copy(new THREE.Vector3(...conditions.earth.direction).multiplyScalar(350));this.localEarth.scale.setScalar(350*EARTH_RADIUS/conditions.earth.distanceKm);}
    this.sunOnVehicle=1;
    if(world){
      // Inside the shadow of the nearer body the spacecraft gets no sunlight at all (umbra; no penumbra model).
      {
        const centre=earthSide?new THREE.Vector3():this.moon.position,radius=(earthSide?EARTH_RADIUS:RADIUS_KM)/1000,rel=this.vehicle.group.position.clone().sub(centre),along=rel.dot(sunWorld);
        if(along<0){const off=rel.addScaledVector(sunWorld,-along).length();this.sunOnVehicle=THREE.MathUtils.smoothstep(off,radius*.995,radius*1.012);}
      }
      // Earthshine or moonshine from the lit ground below, strongest in low orbit over the day side.
      const centre=earthSide?new THREE.Vector3():this.moon.position,radius=(earthSide?EARTH_RADIUS:RADIUS_KM)/1000,out=this.vehicle.group.position.clone().sub(centre),distance=out.length();out.normalize();
      this.shine.color.set(earthSide?0x9cc0ff:0xcfc8bc);this.shine.intensity=(earthSide?1.5:.55)*Math.max(0,out.dot(sunWorld))*Math.pow(radius/distance,2);
      this.shine.target.position.copy(this.vehicle.group.position);this.shine.position.copy(this.vehicle.group.position).addScaledVector(out,-1);
    }
    this.renderer.toneMappingExposure=local?.92:1;
    // Camera.
    const orbit=this.orbitForPhase(sample),key=pad?'pad':ocean?'ocean':local?'local':overview?'overview':this.mode==='follow'?'follow':coast?`coast-${coast}`:chase?'chase':sample.phase;
    const padTarget=pad?new THREE.Vector3(0,PAD_DECK+sample.altitudeKm+.055,0):null;this.padTarget=padTarget;
    const target=pad?padTarget:ocean?this.oceanVehicle.group.position.clone().add(new THREE.Vector3(0,.021,0)):local?lv.group.position.clone().add(new THREE.Vector3(0,.004,0)):null;
    if(reset||key!==this.cameraKey){
      if(reset)this.chaseD=0;
      // The window shots start and end on a cut, like a film.
      const blend=!reset&&Boolean(this.cameraKey)&&!ocean&&!pad&&!coast&&!this.cameraKey.startsWith('coast'),from={position:this.camera.position.clone(),target:this.controls.target.clone(),up:this.camera.up.clone()};
      if(blend&&!this.lastLocal&&this.lastPosition&&previous){const oldOrbit=this.orbitForPhase(previous),delta=oldOrbit&&this.lastFollow==='body'?(oldOrbit.body==='Moon'?space(sample.moon.map((x,i)=>x-previous.moon[i])):new THREE.Vector3()):space(sample.position.map((x,i)=>x-previous.position[i]));from.position.add(delta);from.target.add(delta);}
      if(blend&&local!==this.lastLocal){from.position=this.convertView(from.position,sample,local);from.target=this.convertView(from.target,sample,local);from.up=this.convertView(from.up,sample,local,true).normalize();}
      this.cameraKey=key;this.setCamera(sample,local,ocean,target,pad,chase,this.coastNow);
      this.manualCamera=false;this.cameraTween=null;
      if(blend){this.cameraTween={from,to:{position:this.camera.position.clone(),target:this.controls.target.clone(),up:this.camera.up.clone()},start:performance.now(),local,duration:1800};this.animateCamera(performance.now());}
    }
    else if(this.lastPosition){
      const follow=target||(overview||(['outbound','inbound'].includes(sample.phase)&&this.mode==='auto'&&!chase)?null:this.vehicle.group.position);
      if(follow){const delta=follow.clone().sub(this.lastPosition);if(!pad)this.camera.position.add(delta);this.controls.target.add(delta);if(this.cameraTween)for(const pose of [this.cameraTween.from,this.cameraTween.to]){pose.position.add(delta);pose.target.add(delta);}
        if(ocean&&this.camera.position.y<.003)this.camera.position.y=.003;this.controls.update();this.lastPosition=follow.clone();}
    }
    if(world&&this.mode==='auto'&&(flight||chase||coast)&&!this.manualCamera){
      const pose=flight?this.flightCameraPose(sample):coast?this.coastNow:this.chasePose(sample);
      if(this.cameraTween)this.cameraTween.to=pose;
      else{this.camera.position.copy(pose.position);this.controls.target.copy(pose.target);this.camera.up.copy(pose.up);this.controls.update();}
    }
    // On the pad the camera stays on the ground and follows the rocket with a longer and longer lens.
    const fov=pad&&!this.manualCamera?clamp(THREE.MathUtils.radToDeg(2*Math.atan(.27/this.camera.position.distanceTo(padTarget))),6,45):coast?this.coastNow.fov:45;
    if(Math.abs(this.camera.fov-fov)>.01)this.camera.fov=fov;
    this.lastLocal=local;this.lastScene=sceneName;this.closeView=flight||chase||Boolean(coast);
    this.trail.geometry.dispose();let points=sample.phase==='outbound'?this.plan.outboundPath.slice(0,Math.max(2,Math.ceil(sample.t*200))):sample.phase==='inbound'?this.plan.inboundPath.slice(0,Math.max(2,Math.ceil(sample.t*200))):[];
    if(sample.orbit){
      const orbit=sample.orbit,span=sample.orbitAt-sample.orbitFrom,count=Math.max(2,Math.min(600,Math.ceil(192*span/(orbit.periodSeconds*1000))));
      points=Array.from({length:count},(_,i)=>{const relative=parkingState(orbit,sample.orbitFrom+span*i/(count-1)).relative;return orbit.body==='Earth'?relative:relative.map((x,k)=>x+sample.moon[k]);});
    }
    this.trail.geometry=new THREE.BufferGeometry().setFromPoints(points.map(space));this.trail.visible=lines&&points.length>1;
    // Beside the spacecraft everything is true size; in the wide views the vehicle is enlarged to stay visible.
    const close=this.mode==='follow',ref=this.vehicle.height,trueSize=flight||chase||Boolean(this.cameraTween);
    const size=this.camera.position.distanceTo(this.vehicle.group.position)*(close?.055:.022)/ref,scale=Math.max(trueSize?.001:4*.014/ref,trueSize?0:size);this.vehicle.group.scale.setScalar(scale);
    // Spent stages fall behind, slowly tumbling.
    for(const [kind,phase,from,to,gap,drift] of SPENT){
      const g=this.spent[kind],on=world&&!coast&&sample.phase===phase&&sample.t>=from&&sample.t<=to;g.visible=on;if(!on)continue;
      const k=(sample.t-from)/(to-from),away=(gap+drift*k)*1e-6*(scale/.001);
      g.position.copy(this.vehicle.group.position).addScaledVector(attitude,-away);g.scale.setScalar(scale);
      g.quaternion.copy(this.vehicle.group.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(k*.9,k*.35,0)));
    }
    this.dirty=true;
    const height=Math.max(0,sample.altitudeKm)*.001;
    this.nearA=flight||chase?clamp(height*.25,1e-5,.02):coast?Math.max(.01,this.coastNow.distance*.02):Math.max(1e-8,Math.min(.0005,this.camera.position.distanceTo(this.controls.target)*.02));
    this.camera.near=local||ocean||pad?.0001:this.nearA;this.camera.far=ocean||pad?200:10000;this.camera.updateProjectionMatrix();
    const night=sky&&sky.day<.15;
    document.getElementById('missionScale').textContent=(pad?this.t('msc.pad'):ocean?this.t('msc.ocean'):local?this.t(sample.config==='ascent'?'msc.localAscent':'msc.local'):flight?this.t('msc.approach'):coast?this.t(`msc.${coast}${this.coastNow.body}`):chase?this.t(earthSide?'msc.chaseEarth':'msc.chaseMoon'):sample.orbit?this.t('msc.orbit'):this.t('msc.space'))+(dark?` · ${this.t('light.reading')}`:'')+(night?` · ${this.t('msc.night')}`:'');
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
    const view=(this.conditions?sideLitView(this.conditions.sun.direction):LOCAL_VIEW).clone();
    // High up, the camera rises above the lander and looks down, so the ground fills the background; the distance
    // stays short enough for a 7 m lander to read.
    const across=Math.hypot(view.x,view.z),elevation=THREE.MathUtils.degToRad(9.4+Math.min(30,sample.altitudeKm*3));view.y=across*Math.tan(elevation);
    const target=this.vehicle.group.position.clone(),offset=this.convertView(view,sample,false,true).normalize().multiplyScalar((.04+Math.min(.04,sample.altitudeKm*.004))/1000);
    return {position:target.clone().add(offset),target,up:this.convertView(Y,sample,false,true).normalize()};
  }
  // Beside and a little above the spacecraft, the horizon of the nearer body level behind it; drifts slowly around.
  chasePose(sample){
    const at=this.vehicle.group.position.clone(),centre=this.nearEarth(sample)?new THREE.Vector3():this.moon.position;
    const radial=at.clone().sub(centre).normalize(),motion=v(sample.direction).normalize();
    const side=new THREE.Vector3().crossVectors(motion,radial);if(side.lengthSq()<1e-4)side.crossVectors(radial,Math.abs(radial.y)<.9?Y:new THREE.Vector3(1,0,0));side.normalize();
    const forward=new THREE.Vector3().crossVectors(radial,side).normalize(),wanted=Math.max(.022,this.vehicle.height*3.1);
    this.chaseD=this.chaseD?this.chaseD+(wanted-this.chaseD)*.14:wanted;
    const entry=sample.phase==='arrival',swing=(sample.t-.5)*(entry?.5:1.1);
    const offset=forward.multiplyScalar(entry?-.2:-.5).addScaledVector(side,entry?1:.85).addScaledVector(radial,entry?.22:.3).normalize().applyAxisAngle(radial,swing).multiplyScalar(this.chaseD*.001);
    return {position:at.clone().add(offset),target:at,up:radial};
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
  setCamera(sample,local,ocean=false,target=null,pad=false,chase=false,coast=null){
    const ground=local||ocean||pad,flight=['descent','ascent'].includes(sample.phase);
    this.camera.up.copy(Y);this.camera.near=ground?.0001:.0005;this.camera.far=ocean||pad?200:10000;this.camera.updateProjectionMatrix();this.controls.minDistance=ground?.012:flight||chase?.000008:.02;this.controls.maxDistance=local?40:ocean||pad?20:1500;this.controls.enablePan=true;this.controls.maxPolarAngle=ground?Math.PI*.49:Math.PI-.01;
    if(pad){const at=target||new THREE.Vector3(0,PAD_DECK+.055,0);this.controls.target.copy(at);this.camera.position.copy(PAD_CAMERA);this.lastPosition=at.clone();}
    else if(ocean){const at=target||new THREE.Vector3();this.controls.target.copy(at);this.camera.position.copy(at).add(new THREE.Vector3(.064,-.007,.09));this.camera.position.y=Math.max(.003,this.camera.position.y);this.lastPosition=at.clone();}
    else if(local){const at=target||this.localVehicle.group.position.clone().add(new THREE.Vector3(0,.004,0));this.controls.target.copy(at);this.camera.position.copy(at).add(this.conditions?sideLitView(this.conditions.sun.direction):LOCAL_VIEW);this.lastPosition=at.clone();}
    else if(this.mode==='auto'&&coast){this.camera.position.copy(coast.position);this.controls.target.copy(coast.target);this.camera.up.copy(coast.up);this.lastPosition=null;}
    else if(this.mode==='auto'&&chase){
      this.chaseD=0;const pose=this.chasePose(sample);this.camera.position.copy(pose.position);this.controls.target.copy(pose.target);this.camera.up.copy(pose.up);this.lastPosition=pose.target.clone();
    }
    else if(this.mode==='overview'||['outbound','inbound'].includes(sample.phase)&&this.mode==='auto'){
      const center=this.bounds.center,distance=this.bounds.radius/Math.sin(THREE.MathUtils.degToRad(this.camera.fov/2))*1.12/Math.min(this.camera.aspect,1),axis=space(this.plan.outboundCurve[3]).normalize();
      const offset=new THREE.Vector3().crossVectors(axis,Y);if(offset.length()<.1)offset.set(0,0,1);offset.normalize().add(new THREE.Vector3(0,.6,0)).normalize();
      this.controls.target.copy(center);this.camera.position.copy(center).add(offset.multiplyScalar(distance));this.lastPosition=null;
    }else if(this.mode==='auto'&&flight){
      const pose=this.flightCameraPose(sample);this.camera.position.copy(pose.position);this.controls.target.copy(pose.target);this.camera.up.copy(pose.up);this.lastPosition=pose.target.clone();
    }else{
      const at=this.vehicle.group.position.clone(),up=v(sample.direction).normalize(),side=new THREE.Vector3().crossVectors(up,Y);if(side.length()<.01)side.set(1,0,0);side.normalize();const distance=12;
      this.controls.target.copy(at);this.camera.position.copy(at).add(up.clone().multiplyScalar(distance*.45)).add(side.multiplyScalar(distance));this.lastPosition=at.clone();
    }
    this.controls.update();this.dirty=true;
  }
  labels(){
    for(const [name,body] of [['Earth',this.earth],['Moon',this.moon]]){
      const label=document.getElementById(`mission${name}Label`),p=body.position.clone().project(this.camera),visible=this.world.visible&&!this.closeView&&p.z<1&&p.z>-1&&Math.abs(p.x)<.97&&Math.abs(p.y)<.92;
      label.style.display=visible?'block':'none';label.style.transform=`translate(${(p.x*.5+.5)*this.container.clientWidth+10}px,${(-p.y*.5+.5)*this.container.clientHeight}px)`;
    }
  }
  resize(){const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.composer.setSize(width,height);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.cameraKey='';if(this.sample)this.update(this.sample,this.conditions,true);this.dirty=true;}
  dispose(){
    if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.canvas.removeEventListener('webglcontextlost',this.onContextLost);this.controls.dispose();
    this.scene.traverse(object=>{object.geometry?.dispose();if(object.material){for(const mat of Array.isArray(object.material)?object.material:[object.material]){mat.map?.dispose?.();mat.dispose();}}});
    this.materials.dispose();for(const env of Object.values(this.envs))env.dispose();this.cubeTarget.dispose();this.reflection?.dispose();this.pmrem.dispose();this.composer.dispose();this.landing.dispose();this.water.material.normalMap.dispose();this.foamMap.dispose();this.cloudNoise.dispose();
    this.textures.forEach(tex=>tex.dispose());this.regolith?.dispose();this.renderer.dispose();this.renderer.forceContextLoss();
  }
}
