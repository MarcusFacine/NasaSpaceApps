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

export class Terrain {
  constructor(site,heights,metadata) {
    this.site=site;this.heights=heights;this.size=metadata.tileSize;this.extent=metadata.extentKm;
    this.elevationKm=metadata.sites[site.id].elevationKm;
    this.resolutionKm=metadata.sourceMeridionalSpacingKm;
    this.horizonCache=new Map();
  }
  height(x,z) {
    const fx=clamp((x/this.extent+.5)*(this.size-1),0,this.size-1.001);
    const fy=clamp((z/this.extent+.5)*(this.size-1),0,this.size-1.001);
    const col=Math.floor(fx),row=Math.floor(fy),tx=fx-col,ty=fy-row,n=this.size;
    const a=this.heights[row*n+col]*(1-tx)+this.heights[row*n+col+1]*tx;
    const b=this.heights[(row+1)*n+col]*(1-tx)+this.heights[(row+1)*n+col+1]*tx;
    const h=a*(1-ty)+b*ty;
    // Tangent-plane projection includes lunar curvature at true vertical scale.
    return (RADIUS_KM+h)*RADIUS_KM/Math.sqrt(RADIUS_KM**2+x*x+z*z)-(RADIUS_KM+this.elevationKm);
  }
  horizon(heightM=2) {
    if(this.horizonCache.has(heightM)) return this.horizonCache.get(heightM);
    const values=new Float32Array(720);
    for(let i=0;i<values.length;i++) {
      const az=rad(i/2),sx=Math.sin(az),nz=-Math.cos(az);
      let max=-90;
      for(let distance=.25;distance<=50;distance+=.25) {
        max=Math.max(max,deg(Math.atan2(this.height(sx*distance,nz*distance)-heightM/1000,distance)));
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

export function evaluate(site,date,terrain,astronomy,heightM=2,panel='tracking',cached=null) {
  const eph=cached||ephemeris(date,astronomy);
  const sun=horizontal(eph.sun,site,terrain.elevationKm,heightM);
  const earth=horizontal(eph.earth,site,terrain.elevationKm,heightM);
  sun.horizon=terrain.horizonAt(sun.azimuth,heightM);earth.horizon=terrain.horizonAt(earth.azimuth,heightM);
  sun.margin=sun.elevation-sun.horizon;earth.margin=earth.elevation-earth.horizon;
  // Fraction of solar disk above an approximately straight local horizon.
  const radius=deg(Math.asin(695700/sun.distanceKm)),q=clamp(sun.margin/radius,-1,1);
  sun.diskFraction=(Math.acos(-q)+q*Math.sqrt(1-q*q))/Math.PI;
  sun.available=sun.margin>0;earth.available=earth.margin>0;
  const incidence=panel==='horizontal'?Math.max(0,Math.sin(rad(sun.elevation))):1;
  const irradiance=1361/(sun.distanceKm/AU_KM)**2*sun.diskFraction*incidence;
  return {siteId:site.id,sun,earth,irradiance,eph};
}

export function longestRun(values) {
  let best={start:0,length:0},start=0,current=0;
  values.forEach((value,index)=>{if(value){if(!current)start=index;current++;if(current>best.length)best={start,length:current};}else current=0;});
  return best;
}
