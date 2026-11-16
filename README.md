# Horisite · lunar landing site navigator

Explorador do polo sul lunar, em português e inglês. Site estático com Three.js 0.186.1, efemérides do Astronomy Engine 2.1.19 e relevo real do LRO/LOLA, sem chamadas de API para os cálculos. Antes se chamava Lunar Horizon 3D.

- `dist/index.html`: apresentação (landing), com a Lua ao vivo iluminada pela posição real do Sol.
- `dist/app/`: o explorador.
- `dist/tutorial.html`: guia ilustrado com exemplos que dá para repetir.
- `deck/`: apresentação do hackathon, 7 slides em inglês. Abra `deck/index.html` no navegador ou use o PDF ao lado (`horisite-space-apps-2026.pdf`). Ela fica fora do `dist`, então não é publicada com o site.

## Executar

No Windows, dê dois cliques em **Iniciar Lunar Horizon.cmd** ou rode `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1`. Abra `http://localhost:4173/` (apresentação) ou `http://localhost:4173/app/` (explorador). O inicializador serve só em `127.0.0.1` e `::1`, não cria serviço nem tarefa agendada e registra em `artifacts/localhost-server.log`.

Em um terminal que ficará aberto: `npm start` (Node.js) ou `python -m http.server 4173 --bind 127.0.0.1 --directory dist`. Tudo o que o site usa já está em `dist`: não é preciso instalar dependências para rodar.

## Dados e regeneração

Instale as versões fixadas com `pnpm install`.

- `node scripts/prepare-data.mjs` copia as bibliotecas, baixa as texturas e chama `prepare-terrain.mjs`.
- `node scripts/prepare-terrain.mjs` lê, por HTTP Range, só as janelas de cada local nos DEMs LOLA do polo sul do NASA GSFC PGDA ([produto 90](https://pgda.gsfc.nasa.gov/products/90), Cloud-Optimized GeoTIFF). Grava, por local:
  - `<local>.bin`: 100 × 100 km, 769 × 769 pontos (~130 m), da versão de 80 m do `LDEM_80S_20MPP_ADJ`;
  - `<local>-inner.bin`: 20 × 20 km no centro, 513 × 513 pontos (~39 m), da versão de 40 m;
  - `<local>-wide.bin`: 400 × 400 km, 257 × 257 pontos (~1,56 km), do `LDEM_60S_240MPP_ADJ`, para o horizonte distante;
  - `<local>-psr.bin`: fração de sombra eterna (0–255) do mapa `LPSR_80S_20MPP_ADJ`.

  Antes de gravar, o script compara o recorte com os arquivos existentes e interrompe se a projeção não conferir. A comparação com o DEM SVS de 474 m usado antes deu diferença média de 7,6 a 8,6 m e correlação ≥ 0,99994 nos cinco locais (registrada em `dist/data/metadata.json`).
- `node scripts/prepare-stars.mjs` gera `dist/data/stars.json` do catálogo HYG v4.1 (magnitude ≤ 6).
- `node scripts/prepare-mission-assets.mjs` baixa e prepara as texturas de 4096 px usadas só na missão (Terra do three.js; cor LROC e mapa de normais calculado do LOLA `ldem_16`, do NASA SVS CGI Moon Kit). Precisa de rede e de `ffmpeg`.
- Os modelos das naves em `dist/assets/mission/models/` são os GLB oficiais do repositório `nasa/NASA-3D-Resources` ("Apollo Lunar Module" e "Apollo Soyuz", do qual só a nave Apollo é usada), copiados como publicados. Os carregadores e o pós-processamento do Three.js ficam em `dist/vendor/addons/` (copiados por `prepare-data.mjs`).
- `pnpm check` verifica a geometria, um caso de referência do JPL Horizons e a missão. `node scripts/tutorial-examples.mjs` recalcula os números do tutorial.

## Recursos

- Relevo 3D em três camadas reais (40 m no centro, ~130 m em 100 km, ~1,56 km em 400 km), sombreamento de regolito (lunar-Lambert), sombras do Sol, céu com as estrelas do HYG e a Terra orientada pelo tempo sideral, com fase real, nuvens e luzes noturnas.
- Raios do observador até o Sol e até a Terra, com o ponto onde o relevo bloqueia; caminho do Sol e da Terra nas próximas 24 horas; linha do horizonte calculado na vista de superfície; lente (teleobjetiva) para olhar a Terra.
- Camada de sombra eterna (regiões permanentemente sombreadas, PGDA).
- Comparação de até três locais, gráfico do horizonte em 360°, células de 24 horas (Sol em cima, Terra embaixo, hachura quando atrás do relevo) e busca da maior janela comum em 30 dias.
- Simulação Terra–Lua–Terra em 13 etapas, com órbitas de estacionamento circulares (μ do JPL DE440) e transferências ilustrativas.
- Ferramentas WebMCP: `configure_lunar_comparison` e `read_lunar_visibility`.

## Dados e limitações

O horizonte é amostrado a cada 0,5° de direção, com o relevo até ~195 km (detalhado até 50 km). A Lua não tem atmosfera, então não há refração. Visibilidade da Terra é linha de visada para o centro dela, não um enlace. A irradiância é a luz incidente (1361 W/m² a 1 UA vezes a fração do disco solar à vista); não é potência elétrica.

O micro-relevo abaixo da malha e as variações de brilho do solo são sintéticos e só visuais; a luz de leitura é opcional e não física. Os pontos são referências regionais, não locais de pouso certificados. Uso educativo e exploratório.

Créditos: relevo e sombra eterna NASA GSFC PGDA (Barker et al. 2023, *Planetary Science Journal* 4:183); textura da Lua NASA SVS/LROC; estrelas HYG v4.1 (CC BY-SA 4.0); texturas da Terra dos exemplos do Three.js; bibliotecas MIT, licenças em `dist/vendor`.

Veja [EVALUATION.md](EVALUATION.md) para as avaliações, mudanças e limites medidos.
