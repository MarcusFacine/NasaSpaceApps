import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rad, RADIUS_KM, siteBasis, unit } from './model.js';

const v3=a=>new THREE.Vector3(...a);
const bodyToScene=a=>new THREE.Vector3(a[0],a[2],-a[1]);

export class LunarScene {
  constructor(canvas,container,sites,onError) {
    this.container=container;this.sites=sites;this.view='terrain';this.dirty=true;this.disposed=false;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.65;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.setClearColor(0x030406);
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(48,1,.001,2000);
    this.controls=new OrbitControls(this.camera,canvas);
    this.controls.enableDamping=false;this.controls.addEventListener('change',()=>this.invalidate());
    this.controls.enablePan=true;this.controls.maxPolarAngle=Math.PI*.49;
    this.light=new THREE.DirectionalLight(0xfff7e7,3.2);this.light.castShadow=true;
    this.light.shadow.mapSize.set(2048,2048);
    Object.assign(this.light.shadow.camera,{left:-70,right:70,top:70,bottom:-70,near:.1,far:800});
    this.light.shadow.normalBias=.06;this.light.shadow.bias=-.00005;
    this.scene.add(this.light,this.light.target);
    // Display fill only: assists reading unlit topography, does not affect calculations.
    this.fill=new THREE.AmbientLight(0xb8c9de,.16);this.scene.add(this.fill);
    this.localGroup=new THREE.Group();this.globeGroup=new THREE.Group();this.scene.add(this.localGroup,this.globeGroup);
    this.globeGroup.visible=false;
    this.textureLoader=new THREE.TextureLoader();
    this.moonTexture=this.textureLoader.load('./assets/moon-color.jpg',()=>this.invalidate(),undefined,()=>onError('A textura lunar não carregou. O relevo continua disponível.'));
    this.moonTexture.colorSpace=THREE.SRGBColorSpace;this.moonTexture.wrapS=THREE.RepeatWrapping;
    this.moonTexture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();
    const earthTexture=this.textureLoader.load('./assets/earth-color.jpg',()=>this.invalidate(),undefined,()=>onError('A textura da Terra não carregou.'));
    earthTexture.colorSpace=THREE.SRGBColorSpace;
    this.earth=new THREE.Mesh(new THREE.SphereGeometry(1,48,32),new THREE.MeshStandardMaterial({map:earthTexture,roughness:1}));
    this.sun=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshBasicMaterial({color:0xfff3cb,toneMapped:false}));
    this.sunGlow=this.createGlow();this.sun.add(this.sunGlow);
    this.localGroup.add(this.earth,this.sun);
    this.moon=new THREE.Mesh(new THREE.SphereGeometry(12,160,96),new THREE.MeshStandardMaterial({map:this.moonTexture,roughness:1}));
    this.globeGroup.add(this.moon);
    this.globeMarkers=sites.map(site=>{
      const vector=bodyToScene(siteBasis(site).up);
      const marker=new THREE.Mesh(new THREE.SphereGeometry(.085,12,8),new THREE.MeshBasicMaterial({color:site.color}));
      marker.position.copy(vector.multiplyScalar(12.04));marker.userData.siteId=site.id;this.globeGroup.add(marker);return marker;
    });
    this.makeReference();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;onError('A visualização 3D perdeu o contexto gráfico. Recarregue a página; os cálculos permanecem disponíveis.');});
    canvas.addEventListener('webglcontextrestored',()=>{this.contextLost=false;this.invalidate();});
    canvas.addEventListener('keydown',e=>{
      if(!this.terrain)return;
      if(e.key==='Home'){this.resetCamera();e.preventDefault();}
      if(e.key.startsWith('Arrow')){
        const offset=this.camera.position.clone().sub(this.controls.target);
        const angle=e.key==='ArrowLeft'?.08:e.key==='ArrowRight'?-.08:0;
        if(angle)offset.applyAxisAngle(new THREE.Vector3(0,1,0),angle);
        else offset.multiplyScalar(e.key==='ArrowUp'?.9:1.1);
        this.camera.position.copy(this.controls.target).add(offset);this.controls.update();e.preventDefault();this.invalidate();
      }
    });
    this.render=()=>{if(this.disposed)return;if(this.dirty&&!document.hidden&&!this.contextLost){this.controls.update();this.renderer.render(this.scene,this.camera);this.updateLabels();this.dirty=false;}this.frame=requestAnimationFrame(this.render);};
    this.resize();this.render();
  }

  createGlow() {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const context=canvas.getContext('2d'),g=context.createRadialGradient(64,64,4,64,64,64);
    g.addColorStop(0,'rgba(255,241,190,.7)');g.addColorStop(.2,'rgba(255,224,140,.22)');g.addColorStop(1,'rgba(255,224,140,0)');
    context.fillStyle=g;context.fillRect(0,0,128,128);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
    sprite.scale.set(7,7,1);return sprite;
  }
  makeReference() {
    this.reference=new THREE.Group();
    const ring=new THREE.Mesh(new THREE.RingGeometry(.22,.27,64),new THREE.MeshBasicMaterial({color:0xe6ff57,side:THREE.DoubleSide,depthTest:true}));
    ring.rotation.x=-Math.PI/2;ring.position.y=.03;this.reference.add(ring);
    const pin=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,.8,8),new THREE.MeshBasicMaterial({color:0xe6ff57}));pin.position.y=.4;this.reference.add(pin);
    const tip=new THREE.Mesh(new THREE.OctahedronGeometry(.08),new THREE.MeshBasicMaterial({color:0xe6ff57}));tip.position.y=.85;this.reference.add(tip);
    this.localGroup.add(this.reference);
  }
  setTerrain(terrain) {
    if(this.terrain?.site.id===terrain.site.id)return;
    this.terrain=terrain;
    if(this.terrainMesh){this.localGroup.remove(this.terrainMesh);this.terrainMesh.geometry.dispose();this.terrainMesh.material.dispose();}
    const n=terrain.size,extent=terrain.extent;
    const geometry=new THREE.PlaneGeometry(extent,extent,n-1,n-1);
    const pos=geometry.attributes.position,uv=geometry.attributes.uv;
    const basis=siteBasis(terrain.site);
    const colors=new Float32Array(n*n*3);
    for(let row=0;row<n;row++)for(let col=0;col<n;col++){
      const i=row*n+col,x=(col/(n-1)-.5)*extent,z=(row/(n-1)-.5)*extent;
      pos.setXYZ(i,x,terrain.height(x,z),z);
      const body=basis.up.map((u,k)=>RADIUS_KM*u+x*basis.east[k]-z*basis.north[k]);
      const r=Math.hypot(...body),lat=Math.asin(body[2]/r),lon=Math.atan2(body[1],body[0]);
      uv.setXY(i,(lon/Math.PI+1)/2,(lat/Math.PI+.5));
      const grain=.85+.12*(Math.sin(x*17.7+z*31.3)*43758.5453%1);
      colors.set([grain,grain,grain],i*3);
    }
    // PlaneGeometry's top-to-bottom rows map to south (+Z); winding faces up.
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({map:this.moonTexture,color:0xd6d1c7,roughness:1,metalness:0,vertexColors:true});
    this.terrainMesh=new THREE.Mesh(geometry,material);this.terrainMesh.castShadow=true;this.terrainMesh.receiveShadow=true;
    this.localGroup.add(this.terrainMesh);this.resetCamera();this.invalidate();
  }
  update(result,date,heightM,selected) {
    this.result=result;this.heightM=heightM;this.date=date;
    this.earth.position.copy(v3(result.earth.direction).multiplyScalar(350));
    this.earth.scale.setScalar(350*6378.137/result.earth.distanceKm);
    this.sun.position.copy(v3(result.sun.direction).multiplyScalar(350));
    this.sun.scale.setScalar(350*695700/result.sun.distanceKm);
    this.sun.visible=result.sun.elevation>-10;
    // Earth's orientation is schematic; angular diameter and position are physical.
    this.earth.rotation.y=(date.getTime()/864e5)*Math.PI*2;
    if(this.view==='globe')this.light.position.copy(bodyToScene(unit(result.eph.sun)).multiplyScalar(300));
    else this.light.position.copy(v3(result.sun.direction).multiplyScalar(300));
    this.globeMarkers.forEach(marker=>{marker.visible=selected.includes(marker.userData.siteId);marker.scale.setScalar(marker.userData.siteId===result.siteId?1.7:1);});
    this.reference.visible=this.view==='terrain';
    this.light.shadow.needsUpdate=true;this.invalidate();
  }
  setView(view) {
    this.view=view;this.localGroup.visible=view!=='globe';this.globeGroup.visible=view==='globe';
    this.light.castShadow=view!=='globe';
    if(this.result)this.update(this.result,this.date,this.heightM,[]);
    this.resetCamera();
  }
  resetCamera() {
    if(!this.terrain)return;
    this.controls.enablePan=this.view==='terrain';
    this.controls.minDistance=this.view==='globe'?13:this.view==='surface'?.00005:4;
    this.controls.maxDistance=this.view==='globe'?60:this.view==='surface'?.0001:110;
    this.controls.minPolarAngle=this.view==='surface'?.08:0.02;
    this.controls.maxPolarAngle=this.view==='globe'?Math.PI-.005:this.view==='surface'?Math.PI-.08:Math.PI*.49;
    if(this.view==='globe'){
      this.controls.target.set(0,0,0);const u=bodyToScene(siteBasis(this.terrain.site).up);u.x+=.2;u.z+=.3;
      this.camera.position.copy(u.normalize().multiplyScalar(32));
      // Keep the controls' Y-up convention while allowing the camera below the equator.
      this.camera.up.set(0,1,0);this.camera.fov=48;
    }else if(this.view==='surface'){
      this.camera.up.set(0,1,0);this.camera.fov=55;
      const direction=this.result?.earth.direction||[0,.05,-1];
      // Tiny orbit radius gives a fixed observation point while drag rotates the view.
      this.controls.target.set(0,this.heightM/1000,0);
      this.camera.position.copy(this.controls.target).sub(v3(direction).multiplyScalar(.00008));
    }else{
      this.camera.up.set(0,1,0);this.camera.fov=55;
      const direction=this.result?.earth.direction||[.7,.05,.7];
      this.controls.target.set(0,-1,0);this.camera.position.set(-direction[0]*48,12,-direction[2]*48);
    }
    this.camera.updateProjectionMatrix();this.controls.update();this.invalidate();
  }
  focus(body) {
    if(!this.result)return;
    if(this.view==='globe')this.setView('terrain');
    const direction=v3(this.result[body].direction);
    if(this.view==='surface'){
      this.controls.target.set(0,this.heightM/1000,0);this.camera.position.copy(this.controls.target).sub(direction.multiplyScalar(.00008));
    }else{
      this.controls.target.set(0,this.heightM/1000,0);
      this.camera.position.copy(direction.multiplyScalar(-22));this.camera.position.y=Math.max(6,this.camera.position.y+7);
    }
    this.controls.update();this.invalidate();
  }
  resize() {
    const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.invalidate();
  }
  updateLabels() {
    for(const body of ['sun','earth']){
      const label=document.getElementById(`${body}Label`);
      if(this.view==='globe'||!this.result){label.style.opacity='0';continue;}
      const p=this[body].position.clone().project(this.camera),w=this.container.clientWidth,h=this.container.clientHeight;
      const visible=p.z<1&&p.z>-1&&Math.abs(p.x)<.95&&Math.abs(p.y)<.88;
      label.style.opacity=visible?'1':'0';label.style.transform=`translate(${(p.x*.5+.5)*w+12}px,${(-p.y*.5+.5)*h-12}px)`;
    }
  }
  invalidate(){this.dirty=true;}
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.renderer.dispose();}
}
