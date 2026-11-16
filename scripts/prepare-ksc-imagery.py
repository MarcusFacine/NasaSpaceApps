# Kennedy Space Center ground for the mission's liftoff (dist/launch-pad.js): USDA NAIP aerial imagery via the USGS
# National Map ImageServer (public domain), two squares centred on Launch Complex 39A (28.6083 N, 80.6041 W), north up,
# EPSG:4326 windows sized in km. Pure black in the 40 km square is "no data" (open Atlantic): the pad scene draws its
# own sea there. Downloads once into media/realism/ksc/ (outside git), writes web-sized JPEGs into dist/assets/mission/.
import math, os, urllib.request
from PIL import Image
LAT, LON = 28.6083, -80.6041
SRC = 'media/realism/ksc'
def fetch(name, km, px=4000):
    path = os.path.join(SRC, name)
    if os.path.exists(path): return path
    os.makedirs(SRC, exist_ok=True)
    dlat = km / 2 / 110.574; dlon = km / 2 / (111.320 * math.cos(math.radians(LAT)))
    url = ('https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?'
           f'bbox={LON-dlon:.6f},{LAT-dlat:.6f},{LON+dlon:.6f},{LAT+dlat:.6f}&bboxSR=4326&imageSR=4326&size={px},{px}&format=jpg&compressionQuality=90&f=image')
    open(path, 'wb').write(urllib.request.urlopen(url, timeout=240).read()); return path
for name, km, size in [('ksc-near-6km.jpg', 6, 3072), ('ksc-mid-40km.jpg', 40, 2048), ('ksc-far-120km.jpg', 120, 2048)]:
    im = Image.open(fetch(name, km)).convert('RGB').resize((size, size), Image.LANCZOS)
    out = f'dist/assets/mission/{name.split("-")[0]}-{name.split("-")[1]}.jpg'
    im.save(out, quality=82, optimize=True, progressive=True); print(out, size, os.path.getsize(out) // 1024, 'KB')
