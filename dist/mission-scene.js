import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AU_KM, RADIUS_KM, siteBasis } from './model.js';
import { EARTH_RADIUS, moonPosition } from './mission-model.js';

const v=a=>new THREE.Vector3(a[0],a[2],-a[1]);
const space=a=>v(a).multiplyScalar(.001);
const Y=new THREE.Vector3(0,1,0);
function mesh(geometry,material,parent,position){const m=new THREE.Mesh(geometry,material);if(position)m.position.set(...position);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function rocket(){
  // Generic 14 m vehicle. Metres are represented as 0.001 local scene units.
  const group=new THREE.Group(),white=new THREE.MeshStandardMaterial({color:0xd9dfdf,roughness:.48,metalness:.3}),dark=new THREE.MeshStandardMaterial({color:0x26313b,roughness:.4,metalness:.7}),accent=new THREE.MeshStandardMaterial({color:0xf08c41,roughness:.65});
  mesh(new THREE.CylinderGeometry(.002,.0026,.009,24),white,group,[0,.007,0]);
  mesh(new THREE.ConeGeometry(.002,.003,24),white,group,[0,.013,0]);
  mesh(new THREE.CylinderGeometry(.00208,.00208,.0008,24),accent,group,[0,.01,0]);
  mesh(new THREE.CylinderGeometry(.0012,.0018,.002,16),dark,group,[0,.002,0]);
  mesh(new THREE.SphereGeometry(.0008,16,12),new THREE.MeshStandardMaterial({color:0x33607c,roughness:.12,metalness:.6}),group,[0,.009,.0017]);
  for(let i=0;i<4;i++){
    const angle=i*Math.PI/2+Math.PI/4,a=new THREE.Vector3(Math.cos(angle)*.002,.004,Math.sin(angle)*.002),b=new THREE.Vector3(Math.cos(angle)*.005,0,Math.sin(angle)*.005),delta=b.clone().sub(a);
    const leg=mesh(new THREE.CylinderGeometry(.00018,.00018,delta.length(),8),dark,group);leg.position.copy(a).add(b).multiplyScalar(.5);leg.quaternion.setFromUnitVectors(Y,delta.normalize());
    mesh(new THREE.CylinderGeometry(.0007,.0007,.00015,12),dark,group,[b.x,.00008,b.z]);
  }
  const plume=mesh(new THREE.ConeGeometry(.0011,.008,20),new THREE.MeshBasicMaterial({color:0xffc06f,transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),group,[0,-.0035,0]);plume.rotation.z=Math.PI;
  const core=mesh(new THREE.ConeGeometry(.0005,.005,16),new THREE.MeshBasicMaterial({color:0xbadfff,transparent:true,opacity:.9,depthWrite:false,toneMapped:false}),group,[0,-.002,0]);core.rotation.z=Math.PI;
  group.userData.plumes=[plume,core];return group;
}

export class MissionScene {
  constructor(canvas,container,terrain,onError){
    this.container=container;this.terrain=terrain;this.mode='auto';this.dirty=true;this.disposed=false;this.cameraKey='';
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.35;this.renderer.setClearColor(0x02050a);this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(45,1,.001,10000);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=false;this.controls.addEventListener('change',()=>{this.dirty=true;});
    this.world=new THREE.Group();this.local=new THREE.Group();this.scene.add(this.world,this.local);
    this.sunlight=new THREE.DirectionalLight(0xfff6e4,3.2);this.sunlight.shadow.mapSize.set(2048,2048);this.sunlight.shadow.normalBias=.00012;this.sunlight.shadow.bias=-.00001;this.scene.add(this.sunlight,this.sunlight.target);this.fill=new THREE.AmbientLight(0xa4c2df,.19);this.scene.add(this.fill);
    const loader=new THREE.TextureLoader();this.moonTexture=loader.load('./assets/moon-color.jpg',()=>this.dirty=true,undefined,()=>onError('Textura lunar indisponível. A geometria continua visível.'));this.moonTexture.colorSpace=THREE.SRGBColorSpace;this.moonTexture.wrapS=THREE.RepeatWrapping;
    this.earthTexture=loader.load('./assets/earth-color.jpg',()=>this.dirty=true,undefined,()=>onError('Textura terrestre indisponível.'));this.earthTexture.colorSpace=THREE.SRGBColorSpace;
    this.earth=mesh(new THREE.SphereGeometry(EARTH_RADIUS/1000,64,48),new THREE.MeshStandardMaterial({map:this.earthTexture,roughness:1}),this.world);
    this.moon=mesh(new THREE.SphereGeometry(RADIUS_KM/1000,64,48),new THREE.MeshStandardMaterial({map:this.moonTexture,roughness:1}),this.world);
    this.localEarth=mesh(new THREE.SphereGeometry(1,32,24),new THREE.MeshStandardMaterial({map:this.earthTexture,roughness:1}),this.local);
    this.marker=mesh(new THREE.SphereGeometry(.0015,12,8),new THREE.MeshBasicMaterial({color:0xe6ff57}),this.local,[0,.0008,0]);
    this.vehicle=rocket();this.world.add(this.vehicle);this.localVehicle=rocket();this.local.add(this.localVehicle);this.makeTerrain(terrain);
    this.trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.8}));this.world.add(this.trail);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;if(!this.disposed)onError('O contexto 3D foi perdido. Feche e reabra a simulação.');});
    this.render=()=>{if(this.disposed)return;if(this.dirty&&!document.hidden&&!this.contextLost){this.renderer.render(this.scene,this.camera);this.labels();this.dirty=false;}this.frame=requestAnimationFrame(this.render);};this.render();
  }
  makeTerrain(terrain){
    const n=terrain.size,extent=terrain.extent,g=new THREE.PlaneGeometry(extent,extent,n-1,n-1),pos=g.attributes.position,uv=g.attributes.uv,basis=siteBasis(terrain.site);
    for(let row=0;row<n;row++)for(let col=0;col<n;col++){
      const i=row*n+col,x=(col/(n-1)-.5)*extent,z=(row/(n-1)-.5)*extent;pos.setXYZ(i,x,terrain.height(x,z),z);
      const body=basis.up.map((u,k)=>RADIUS_KM*u+x*basis.east[k]-z*basis.north[k]);uv.setXY(i,(Math.atan2(body[1],body[0])/Math.PI+1)/2,Math.asin(body[2]/Math.hypot(...body))/Math.PI+.5);
    }
    g.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({map:this.moonTexture,color:0xbebbb4,roughness:1});
    // Visual regolith grain only; does not displace or improve the measured DEM.
    material.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 regolithPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nregolithPosition = position;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 regolithPosition;').replace('#include <map_fragment>','#include <map_fragment>\nfloat grain = fract(sin(dot(floor(regolithPosition.xz * 22000.0), vec2(12.9898,78.233))) * 43758.5453);\ndiffuseColor.rgb *= 0.78 + grain * 0.32;');
    };
    mesh(g,material,this.local);
    const ring=mesh(new THREE.RingGeometry(.007,.0074,64),new THREE.MeshBasicMaterial({color:0xe6ff57,side:THREE.DoubleSide,transparent:true,opacity:.7}),this.local,[0,.0003,0]);ring.rotation.x=-Math.PI/2;
  }
  setPlan(plan){
    this.plan=plan;this.cameraKey='';
    for(const line of this.pathLines||[]){this.world.remove(line);line.geometry.dispose();line.material.dispose();}
    this.pathLines=[plan.outboundPath,plan.inboundPath].map((points,i)=>{const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(space)),new THREE.LineBasicMaterial({color:i?0x6dd9ff:0xe6ff57,transparent:true,opacity:.38}));this.world.add(line);return line;});
    const orbit=Array.from({length:65},(_,i)=>space(moonPosition(new Date(plan.launch+(plan.returnAt-plan.launch)*i/64),window.Astronomy)));
    this.bounds=new THREE.Box3().setFromPoints([...plan.outboundPath.map(space),...plan.inboundPath.map(space),...orbit,new THREE.Vector3(-7,-7,-7),new THREE.Vector3(7,7,7)]).getBoundingSphere(new THREE.Sphere());
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbit),new THREE.LineDashedMaterial({color:0x7a8896,dashSize:1,gapSize:1,transparent:true,opacity:.32}));line.computeLineDistances();this.world.add(line);this.pathLines.push(line);this.dirty=true;
  }
  setMode(mode){this.mode=mode;this.cameraKey='';if(this.sample)this.update(this.sample,this.conditions,true);}
  update(sample,conditions,reset=false){
    this.sample=sample;this.conditions=conditions;const local=sample.local&&this.mode!=='overview';this.world.visible=!local;this.local.visible=local;
    this.moon.position.copy(space(sample.moon));
    const f=sample.frame,matrix=new THREE.Matrix4().makeBasis(v(f.x),v(f.z),v(f.y).negate());this.moon.quaternion.setFromRotationMatrix(matrix);
    // The Earth texture is visual, not a precise Earth-fixed attitude model.
    this.earth.rotation.y=window.Astronomy.SiderealTime(sample.date)*Math.PI/12;
    this.vehicle.position.copy(space(sample.position));this.vehicle.quaternion.setFromUnitVectors(Y,v(sample.direction).normalize());
    this.localVehicle.position.set(0,this.terrain.height(0,0)+sample.altitudeKm,0);
    this.localVehicle.userData.plumes.forEach(p=>p.visible=sample.engine);this.vehicle.userData.plumes.forEach(p=>p.visible=sample.engine);
    this.marker.visible=sample.phase==='surface';
    const earthHelio=window.Astronomy.HelioVector(window.Astronomy.Body.Earth,sample.date);
    const sun=local?new THREE.Vector3(...conditions.sun.direction):v([earthHelio.x,earthHelio.y,earthHelio.z]).negate().normalize();
    this.sunlight.intensity=local?3.2*conditions.sun.diskFraction:3.2;
    this.sunlight.target.position.copy(local?new THREE.Vector3(0,sample.altitudeKm,0):this.moon.position.clone().multiplyScalar(.5));this.sunlight.position.copy(this.sunlight.target.position).add(sun.multiplyScalar(local?200:1000));this.sunlight.castShadow=local;
    if(local){Object.assign(this.sunlight.shadow.camera,{left:-.6,right:.6,top:.6,bottom:-.6,near:.01,far:500});this.sunlight.shadow.camera.updateProjectionMatrix();this.localEarth.position.copy(new THREE.Vector3(...conditions.earth.direction).multiplyScalar(350));this.localEarth.scale.setScalar(350*EARTH_RADIUS/conditions.earth.distanceKm);}
    const key=local?'local':this.mode==='overview'?'overview':this.mode==='follow'?'follow':sample.phase;
    if(reset||key!==this.cameraKey){this.cameraKey=key;this.setCamera(sample,local);}
    else if(this.lastPosition){
      const target=local?new THREE.Vector3(0,sample.altitudeKm+.007,0):this.mode==='overview'||['outbound','inbound'].includes(sample.phase)&&this.mode==='auto'?null:this.vehicle.position;
      if(target){const delta=target.clone().sub(this.lastPosition);this.camera.position.add(delta);this.controls.target.add(delta);this.controls.update();this.lastPosition=target.clone();}
    }
    this.trail.geometry.dispose();const points=sample.phase==='outbound'?this.plan.outboundPath.slice(0,Math.max(2,Math.ceil(sample.t*200))):sample.phase==='inbound'?this.plan.inboundPath.slice(0,Math.max(2,Math.ceil(sample.t*200))):[];this.trail.geometry=new THREE.BufferGeometry().setFromPoints(points.map(space));this.trail.visible=points.length>1;
    const close=['launch','arrival'].includes(sample.phase)||this.mode==='follow';
    const size=this.camera.position.distanceTo(this.vehicle.position)*(close?.055:.022)/.014;this.vehicle.scale.setScalar(Math.max(4,size));this.dirty=true;
    document.getElementById('missionScale').textContent=local?'RELEVO LOLA 1× · VEÍCULO ~14 m':'DISTÂNCIAS REAIS · VEÍCULO AMPLIADO';
  }
  setCamera(sample,local){
    this.camera.up.copy(Y);this.camera.near=local?.0001:.0005;this.camera.far=10000;this.camera.updateProjectionMatrix();this.controls.minDistance=local?.015:.02;this.controls.maxDistance=local?40:1500;this.controls.enablePan=true;this.controls.maxPolarAngle=local?Math.PI*.49:Math.PI-.01;
    if(local){const target=new THREE.Vector3(0,sample.altitudeKm+.007,0);this.controls.target.copy(target);this.camera.position.copy(target).add(new THREE.Vector3(.08,.024,.11));this.lastPosition=target.clone();}
    else if(this.mode==='overview'||['outbound','inbound'].includes(sample.phase)&&this.mode==='auto'){
      const center=this.bounds.center,distance=this.bounds.radius/Math.sin(THREE.MathUtils.degToRad(this.camera.fov/2))*1.12/Math.min(this.camera.aspect,1),axis=space(this.plan.outboundCurve[3]).normalize();
      const offset=new THREE.Vector3().crossVectors(axis,Y);if(offset.length()<.1)offset.set(0,0,1);offset.normalize().add(new THREE.Vector3(0,.6,0)).normalize();
      this.controls.target.copy(center);this.camera.position.copy(center).add(offset.multiplyScalar(distance));this.lastPosition=null;
    }else{
      const target=this.vehicle.position.clone(),up=v(sample.direction).normalize(),side=new THREE.Vector3().crossVectors(up,Y);if(side.length()<.01)side.set(1,0,0);side.normalize();const distance=['launch','arrival'].includes(sample.phase)?3:12;
      this.controls.target.copy(target);this.camera.position.copy(target).add(up.clone().multiplyScalar(distance*.45)).add(side.multiplyScalar(distance));this.lastPosition=target.clone();
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
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.scene.traverse(object=>{object.geometry?.dispose();if(object.material){for(const mat of Array.isArray(object.material)?object.material:[object.material])mat.dispose();}});this.moonTexture.dispose();this.earthTexture.dispose();this.renderer.dispose();this.renderer.forceContextLoss();}
}
