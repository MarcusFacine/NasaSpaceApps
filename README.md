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
- Missão Terra–Lua–Terra: botão **Simular missão**, com lançamento, viagem, pouso no relevo LOLA, permanência, decolagem e retorno. Usa o local em foco e a janela calculada pela comparação, ou uma janela manual iniciada na data escolhida.
- Controles de reprodução, velocidade, etapas e câmera; seleção e janela lembradas apenas neste navegador.

## Simulação de missão

Escolha os locais, clique em **Melhor janela**, coloque em foco um dos locais dessa comparação e abra **Simular missão**. O pouso ocorre no início da janela. O lançamento é antecipado pela duração da ida, e a decolagem acontece após a permanência informada, que precisa caber na janela. Sem busca, a data selecionada inicia uma janela manual de 24 h, ajustável na simulação. Valores iniciais de 72 h de ida, até 24 h de permanência e 72 h de volta são hipóteses educativas, não parâmetros de um veículo.

As posições geocêntricas da Lua e sua orientação são recalculadas pela efeméride. As curvas cúbicas visuais miram a posição lunar na chegada e partem da posição na saída. A saída/chegada terrestres usam o vetor EQJ de um observador em 28,5°N, 80,6°W (referência no Cabo Canaveral). A atitude da textura terrestre permanece ilustrativa. As curvas são cinemáticas: **não** há integração gravitacional, solução de Lambert, orçamento de delta-v, propulsão, estágios, manobras orbitais, atmosfera ou certificação de lançamento. A viagem não é uma previsão de voo. Uma janela de iluminação e visada **não é** uma janela orbital.

Distâncias e raios planetários são proporcionais na visão espacial; o veículo é ampliado para leitura. Nas etapas locais, a malha usa quilômetros e o veículo genérico mede ~14 m. O grão de rególito é apenas um efeito de material, não geometria medida. O DEM de ~474 m não resolve a área de contato das pernas. A altitude e o caminho do veículo são ilustrativos. As condições são avaliadas **no destino lunar**, incluindo amostras horárias durante a permanência, não como cobertura de comunicação durante o voo. O relógio UTC permanece cronológico, mas a animação comprime o tempo separadamente por etapa.

`node scripts/check-mission.mjs` verifica cronograma, continuidade das etapas, pouso no ponto escolhido, chegada terrestre e rejeição de durações inválidas. Fundamentos de trajetórias: [NASA Basics of Space Flight](https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/).

## Dados e limitações

O DEM vem do [CGI Moon Kit da NASA SVS](https://svs.gsfc.nasa.gov/4720/), produto `ldem_64_uint.tif`. Os valores são alturas em meios metros acrescidas de 10 km, relativas ao raio lunar 1737,4 km. A distância meridional entre amostras é ~474 m. A grade entregue interpola esse produto; não melhora sua resolução original.

O cálculo usa vetores geométricos EQJ e a orientação IAU_MOON do [Astronomy Engine](https://github.com/cosinekitty/astronomy), equivalente à aproximação trigonométrica documentada no [NAIF PCK00011](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc). A posição do observador é subtraída para incluir paralaxe. A Lua é esférica com relevo, sem atmosfera. O horizonte é amostrado em raios de 50 km, em incrementos de 250 m e direções de 0,5°.

Visibilidade da Terra significa linha de visada para seu centro; não confirma um enlace nem uma estação terrestre específica. A irradiância usa a distância ao Sol, a fração do disco acima do horizonte e a orientação ideal do painel. Não é potência elétrica e não inclui eficiência, temperatura ou armazenamento. A sombra do renderizador é uma aproximação visual; os indicadores usam o perfil numérico. A cena inclui uma luz de leitura fraca. A rotação da textura terrestre é ilustrativa. O globo usa textura global, sem relevo global deslocado; o relevo regional é reconstruído do DEM.

Os pontos são referências regionais, não locais de pouso certificados. Gerlache e Haworth não são apresentados como cumes: a altitude do ponto selecionado no DEM é baixa. Foi corrigida a referência de Shackleton de 89,90°S para 89,66°S, para explorar um ponto de borda elevado; essa escolha está explicitamente visível na interface.

Uso educativo e exploratório. Estudos de missão precisam de DEM polar mais fino, kernels binários de orientação SPICE e validação de enlace. Textura lunar: NASA SVS/LROC; textura terrestre: exemplo de planetas do Three.js. Bibliotecas: MIT, licenças em `dist/vendor`.

## Avaliação e validação

Veja [EVALUATION.md](EVALUATION.md) para os problemas da versão inicial, mudanças e limites medidos.
