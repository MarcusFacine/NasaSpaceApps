# Lunar Horizon 3D

Explorador do polo sul lunar em português. Site estático com Three.js 0.186.1, efemérides do Astronomy Engine 2.1.19 e terreno real do LRO/LOLA, sem dependência de APIs no navegador para os cálculos.

## Executar

Na pasta do projeto, execute `python -m http.server 4173 --directory dist` e abra `http://localhost:4173/`. Os arquivos de bibliotecas, texturas e terreno necessários já estão em `dist`. Não é necessário instalar dependências para executar a versão entregue.

Para desenvolvimento e reprodução dos dados: instale as versões fixadas com `pnpm install`. `pnpm prepare:data` obtém as linhas polares do DEM NASA por HTTP Range, gera as cinco malhas binárias e copia as bibliotecas locais. `pnpm check` verifica a geometria e um caso de referência JPL. A regeneração dos dados precisa de rede; o servidor estático e os cálculos não.

## Experiência

- Câmeras de relevo orbital, superfície e globo lunar; interação por mouse, toque e teclado (setas / Home).
- Terreno regional de 100 × 100 km, amostrado em 257 × 257 pontos, com curvatura lunar e escala vertical 1×.
- Efemérides e luz solar sincronizadas à data UTC; tamanho angular do Sol e da Terra baseado na distância.
- Horizonte local em 360°, comparação de até três locais e cronograma das próximas 24 horas.
- Irradiância incidente para painel rastreado ou horizontal, altura do observador de 2–20 m e animação temporal.
- Busca do maior intervalo contínuo de Sol e centro da Terra visíveis em todos os locais selecionados nos próximos 30 dias (passo de 1 hora).
- WebMCP: `configure_lunar_comparison` e `read_lunar_visibility`, com parâmetros validados antes de qualquer mudança de estado.

## Dados e limitações

O DEM vem do [CGI Moon Kit da NASA SVS](https://svs.gsfc.nasa.gov/4720/), produto `ldem_64_uint.tif`. Os valores são alturas em meios metros acrescidas de 10 km, relativas ao raio lunar 1737,4 km. A distância meridional entre amostras é ~474 m. A grade entregue interpola esse produto; não melhora sua resolução original.

O cálculo usa vetores geométricos EQJ e a orientação IAU_MOON do [Astronomy Engine](https://github.com/cosinekitty/astronomy), equivalente à aproximação trigonométrica documentada no [NAIF PCK00011](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc). A posição do observador é subtraída para incluir paralaxe. A Lua é esférica com relevo, sem atmosfera. O horizonte é amostrado em raios de 50 km, em incrementos de 250 m e direções de 0,5°.

Visibilidade da Terra significa linha de visada para seu centro; não confirma um enlace nem uma estação terrestre específica. A irradiância usa a distância ao Sol, a fração do disco acima do horizonte e a orientação ideal do painel. Não é potência elétrica e não inclui eficiência, temperatura ou armazenamento. A sombra do renderizador é uma aproximação visual; os indicadores usam o perfil numérico. A cena inclui uma luz de leitura fraca. A rotação da textura terrestre é ilustrativa. O globo usa textura global, sem relevo global deslocado; o relevo regional é reconstruído do DEM.

Os pontos são referências regionais, não locais de pouso certificados. Gerlache e Haworth não são apresentados como cumes: a altitude do ponto selecionado no DEM é baixa. Foi corrigida a referência de Shackleton de 89,90°S para 89,66°S, para explorar um ponto de borda elevado; essa escolha está explicitamente visível na interface.

Uso educativo e exploratório. Estudos de missão precisam de DEM polar mais fino, kernels binários de orientação SPICE e validação de enlace. Textura lunar: NASA SVS/LROC; textura terrestre: exemplo de planetas do Three.js. Bibliotecas: MIT, licenças em `dist/vendor`.

## Avaliação e validação

Veja [EVALUATION.md](EVALUATION.md) para os problemas da versão inicial, mudanças e limites medidos.
