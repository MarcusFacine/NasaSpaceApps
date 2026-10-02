// Optional independent reference check. JPL requests are deliberately sequential.
import * as Astronomy from 'astronomy-engine';
import { readFile } from 'node:fs/promises';
import { sites } from '../dist/sites.js';
import { ephemeris, horizontal } from '../dist/model.js';
const metadata=JSON.parse(await readFile('dist/data/metadata.json','utf8'));
const date=new Date('2026-10-02T12:00:00Z');
const eph=ephemeris(date,Astronomy);
const site=sites[0];
for(const [body,id] of [['sun','10'],['earth','399']]){
  const parameters={format:'json',COMMAND:`'${id}'`,EPHEM_TYPE:"'OBSERVER'",CENTER:"'coord@301'",COORD_TYPE:"'GEODETIC'",SITE_COORD:`'${site.lon},${site.lat},${metadata.sites[site.id].elevationKm+.002}'`,START_TIME:"'2026-10-02 12:00'",STOP_TIME:"'2026-10-02 13:00'",STEP_SIZE:"'1 h'",QUANTITIES:"'4'",APPARENT:"'AIRLESS'",CSV_FORMAT:"'YES'",EXTRA_PREC:"'YES'"};
  const url='https://ssd.jpl.nasa.gov/api/horizons.api?'+new URLSearchParams(parameters);
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('JPL HTTP '+response.status);
  const data=await response.json();
  if(data.error)throw new Error(data.error);
  const rows=data.result.match(/\$\$SOE([\s\S]*?)\$\$EOE/)?.[1]?.trim();
  console.log(JSON.stringify({body,site:site.id,date:date.toISOString(),jpl:rows,local:horizontal(eph[body],site,metadata.sites[site.id].elevationKm,2)},null,2));
}
