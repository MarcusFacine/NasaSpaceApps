export const RADIUS_KM = 1737.4;
export const AU_KM = 149597870.7;
export const rad = value => value * Math.PI / 180;
export const deg = value => value * 180 / Math.PI;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const length = v => Math.hypot(...v);
export const unit = v => v.map(x=>x/length(v));
export const subtract = (a,b) => a.map((x,i)=>x-b[i]);

export function siteBasis(site) {
  const lat=rad(site.lat), lon=rad(site.lon);
  return {
    up: [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)],
    east: [-Math.sin(lon),Math.cos(lon),0],
    north: [-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)]
  };
}

// IAU_MOON / Mean Earth orientation. Astronomy Engine returns alpha in hours.
export function lunarFrame(date, astronomy) {
  const axis=astronomy.RotationAxis(astronomy.Body.Moon,date);
  const a=rad(axis.ra*15), d=rad(axis.dec), w=rad(axis.spin%360);
  const pole=[Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d)];
  const node=[-Math.sin(a),Math.cos(a),0];
  const side=[-Math.sin(d)*Math.cos(a),-Math.sin(d)*Math.sin(a),Math.cos(d)];
  const prime=node.map((x,i)=>x*Math.cos(w)+side[i]*Math.sin(w));
  const y=node.map((x,i)=>-x*Math.sin(w)+side[i]*Math.cos(w));
  return { x:prime,y,z:pole,transform:v=>[dot(v,prime),dot(v,y),dot(v,pole)] };
}

export function ephemeris(date, astronomy) {
  const frame=lunarFrame(date,astronomy);
  const moon=astronomy.GeoMoon(date);
  const earthHelio=astronomy.HelioVector(astronomy.Body.Earth,date);
  const m=[moon.x,moon.y,moon.z], e=[earthHelio.x,earthHelio.y,earthHelio.z];
  // Geometric vectors at the same epoch; no terrestrial refraction or aberration.
  return {
    earth:frame.transform(m.map(v=>-v*AU_KM)),
    sun:frame.transform(m.map((v,i)=>(-e[i]-v)*AU_KM)),
    frame
  };
}

export function horizontal(vector,site,elevationKm=0,heightM=2) {
  const basis=siteBasis(site);
  const observer=basis.up.map(v=>v*(RADIUS_KM+elevationKm+heightM/1000));
  const topocentric=subtract(vector,observer);
  const e=dot(topocentric,basis.east), n=dot(topocentric,basis.north), u=dot(topocentric,basis.up);
  const distance=length(topocentric);
  return {azimuth:(deg(Math.atan2(e,n))+360)%360,elevation:deg(Math.atan2(u,Math.hypot(e,n))),distanceKm:distance,direction:[e/distance,u/distance,-n/distance]};
}

// Bilinear sample of a square tangent-plane grid (rows run north to south, +z).
function gridSample(heights,size,extent,x,z) {
  const fx=clamp((x/extent+.5)*(size-1),0,size-1.001);
  const fy=clamp((z/extent+.5)*(size-1),0,size-1.001);
  const col=Math.floor(fx),row=Math.floor(fy),tx=fx-col,ty=fy-row,n=size;
  const a=heights[row*n+col]*(1-tx)+heights[row*n+col+1]*tx;
  const b=heights[(row+1)*n+col]*(1-tx)+heights[(row+1)*n+col+1]*tx;
  return a*(1-ty)+b*ty;
}

export class Terrain {
  // heights: detailed tile; wideHeights (optional): wider, coarser context tile of the same DEM family.
  // innerHeights (optional): finer tile at the centre; psr (optional): Uint8 shadow fraction, 255 = permanently shadowed.
  constructor(site,heights,metadata,wideHeights=null,innerHeights=null,psr=null) {
    this.site=site;this.heights=heights;this.size=metadata.tileSize;this.extent=metadata.extentKm;
    this.inner=innerHeights&&metadata.inner?{heights:innerHeights,size:metadata.inner.tileSize,extent:metadata.inner.extentKm}:null;
    this.psr=psr&&metadata.psr?{values:psr,size:metadata.psr.tileSize,extent:metadata.psr.extentKm}:null;
    // With a finer centre, the observer stands on the finer surface.
    this.elevationKm=this.inner?innerHeights[(innerHeights.length-1)/2]:metadata.sites[site.id].elevationKm;
    this.resolutionKm=metadata.sourceMeridionalSpacingKm;
    this.wide=wideHeights&&metadata.wide?{heights:wideHeights,size:metadata.wide.tileSize,extent:metadata.wide.extentKm}:null;
    this.horizonCache=new Map();
  }
  // Tangent-plane projection includes lunar curvature at true vertical scale.
  curvature(h,x,z){return (RADIUS_KM+h)*RADIUS_KM/Math.sqrt(RADIUS_KM**2+x*x+z*z)-(RADIUS_KM+this.elevationKm);}
  // Finer centre where it exists, blended over its last kilometre into the detailed tile.
  rawHeight(x,z) {
    const coarse=gridSample(this.heights,this.size,this.extent,x,z);
    if(!this.inner)return coarse;
    const half=this.inner.extent/2,edge=Math.max(Math.abs(x),Math.abs(z));
    if(edge>=half)return coarse;
    const fine=gridSample(this.inner.heights,this.inner.size,this.inner.extent,x,z),w=clamp((half-edge)/1,0,1);
    return coarse+(fine-coarse)*w;
  }
  height(x,z) {return this.curvature(this.rawHeight(x,z),x,z);}
  psrAt(x,z) {return this.psr?gridSample(this.psr.values,this.psr.size,this.psr.extent,x,z)/255:0;}
  // Detailed tile where it exists, otherwise the context tile.
  heightAt(x,z) {
    const half=this.extent/2;
    if(!this.wide||(Math.abs(x)<=half&&Math.abs(z)<=half))return this.height(x,z);
    return this.curvature(gridSample(this.wide.heights,this.wide.size,this.wide.extent,x,z),x,z);
  }
  // Highest terrain elevation angle per half degree of azimuth: detailed tile to 50 km,
  // then the context tile out to just inside its edge.
  horizon(heightM=2) {
    if(this.horizonCache.has(heightM)) return this.horizonCache.get(heightM);
    const values=new Float32Array(720),reach=this.wide?this.wide.extent/2-5:50;
    for(let i=0;i<values.length;i++) {
      const az=rad(i/2),sx=Math.sin(az),nz=-Math.cos(az);
      let max=-90;
      for(let distance=.25;distance<=50;distance+=.25) {
        max=Math.max(max,deg(Math.atan2(this.height(sx*distance,nz*distance)-heightM/1000,distance)));
      }
      for(let distance=51;distance<=reach;distance+=1) {
        max=Math.max(max,deg(Math.atan2(this.heightAt(sx*distance,nz*distance)-heightM/1000,distance)));
      }
      values[i]=max;
    }
    this.horizonCache.set(heightM,values);return values;
  }
  horizonAt(azimuth,heightM=2) {
    const values=this.horizon(heightM),index=((azimuth%360)+360)%360*2;
    const i=Math.floor(index),t=index-i;
    return values[i]*(1-t)+values[(i+1)%values.length]*t;
  }
}

// Area shared by two discs of radii a and b whose centres are d apart (small angles: plane geometry).
export function discOverlap(a,b,d) {
  if(d>=a+b)return 0;
  if(d<=Math.abs(a-b))return Math.PI*Math.min(a,b)**2;
  const x=clamp((d*d+a*a-b*b)/(2*d*a),-1,1),y=clamp((d*d+b*b-a*a)/(2*d*b),-1,1);
  return a*a*Math.acos(x)+b*b*Math.acos(y)-.5*Math.sqrt(Math.max(0,(-d+a+b)*(d+a-b)*(d-a+b)*(d+a+b)));
}
export function evaluate(site,date,terrain,astronomy,heightM=2,panel='tracking',cached=null) {
  const eph=cached||ephemeris(date,astronomy);
  const sun=horizontal(eph.sun,site,terrain.elevationKm,heightM);
  const earth=horizontal(eph.earth,site,terrain.elevationKm,heightM);
  sun.horizon=terrain.horizonAt(sun.azimuth,heightM);earth.horizon=terrain.horizonAt(earth.azimuth,heightM);
  sun.margin=sun.elevation-sun.horizon;earth.margin=earth.elevation-earth.horizon;
  // Fraction of solar disk above an approximately straight local horizon.
  const radius=deg(Math.asin(695700/sun.distanceKm)),q=clamp(sun.margin/radius,-1,1);
  sun.diskFraction=(Math.acos(-q)+q*Math.sqrt(1-q*q))/Math.PI;sun.terrainFraction=sun.diskFraction;
  // Eclipse: the Earth in front of the Sun, seen from the site (a lunar eclipse seen from the Earth). The share of the
  // solar disc behind the Earth's disc comes from their angular radii and separation; the Earth's radius is enlarged
  // by 1/85 for its atmosphere (Danjon's rule for lunar eclipse shadows). The faint red light refracted by the
  // atmosphere is not modelled: in a total eclipse there is no direct light.
  const rs=Math.asin(695700/sun.distanceKm),re=Math.asin(6378.137*(1+1/85)/earth.distanceKm);
  const separation=Math.acos(clamp(sun.direction.reduce((v,x,i)=>v+x*earth.direction[i],0),-1,1));
  sun.eclipse=discOverlap(rs,re,separation)/(Math.PI*rs*rs);sun.eclipse=sun.eclipse>1-1e-9?1:sun.eclipse;
  sun.diskFraction*=1-sun.eclipse;
  sun.available=sun.margin>0&&sun.eclipse<1;earth.available=earth.margin>0;
  const incidence=panel==='horizontal'?Math.max(0,Math.sin(rad(sun.elevation))):1;
  const irradiance=1361/(sun.distanceKm/AU_KM)**2*sun.diskFraction*incidence;
  return {siteId:site.id,sun,earth,irradiance,eph};
}

export function longestRun(values) {
  let best={start:0,length:0},start=0,current=0;
  values.forEach((value,index)=>{if(value){if(!current)start=index;current++;if(current>best.length)best={start,length:current};}else current=0;});
  return best;
}
